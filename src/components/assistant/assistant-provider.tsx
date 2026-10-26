"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "@/lib/client-api";
import { DATA_CHANGED_EVENT, notifyDataChanged } from "@/lib/data-events";
import { isOverdue } from "@/lib/utils/dates";
import type { AssistantBlock, ConversationContext } from "@/lib/ai/types";
import { emptyContext } from "@/lib/ai/types";
import {
  friendlyRequestError,
  interruptedMessage,
} from "@/lib/ai/user-messages";
import { prefersReducedMotion, revealText } from "@/lib/ai/typing";
import type { Checklist, ChecklistItem, Project, Task } from "@/types";

const STORAGE_KEY = "lifepilot-assistant-v1";
const WRITE_TOOLS = new Set([
  "create_task",
  "update_task",
  "complete_task",
  "delete_task",
  "create_checklist",
  "update_checklist",
  "manage_checklist_items",
  "add_checklist_items",
  "complete_checklist_items",
  "delete_checklist",
  "create_project",
  "update_project",
  "delete_project",
  "move_tasks_to_project",
  "create_event",
  "update_event",
  "delete_event",
  "undo_last_change",
]);

export interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  blocks?: AssistantBlock[];
  createdAt: string;
  /** True while tokens are still arriving or typing out. */
  streaming?: boolean;
}

interface ChatResponse {
  message: string;
  blocks: AssistantBlock[];
  context: ConversationContext;
  toolCalls: { name: string; success: boolean }[];
  mode: "model" | "local";
  openaiConfigured: boolean;
  error?: string;
}

interface AssistantApi {
  messages: AssistantMessage[];
  draft: string;
  setDraft: (value: string) => void;
  busy: boolean;
  /** True while waiting for the first visible reply text. */
  thinking: boolean;
  openaiConfigured: boolean | null;
  mode: "model" | "local" | null;
  send: (text?: string) => Promise<void>;
  stop: () => void;
  clearChat: () => void;
  confirm: (action: { tool: string; args: Record<string, unknown> }) => Promise<void>;
  dismissPending: () => Promise<void>;
  patchTask: (id: string, patch: Partial<AssistantMessage["blocks"]>) => void;
  refreshRecords: () => Promise<void>;
}

const AssistantContext = createContext<AssistantApi | null>(null);

function newId() {
  return crypto.randomUUID();
}

type ChecklistRow = Checklist & { items: ChecklistItem[] };
type ProjectRow = Project & { progress?: { percent: number } };

async function readSseChat(
  body: Record<string, unknown>,
  handlers: {
    onStatus?: (status: string) => void;
    onDelta?: (text: string) => void;
    onDone?: (data: ChatResponse) => void;
    onError?: (message: string) => void;
  },
  signal: AbortSignal
): Promise<"streamed" | "json"> {
  const res = await fetch("/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  });

  const contentType = res.headers.get("content-type") || "";
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const json = (await res.json()) as { error?: string };
      if (json.error) message = json.error;
    } catch {
      // Keep status-based message.
    }
    throw new Error(message);
  }

  if (!contentType.includes("text/event-stream") || !res.body) {
    const json = (await res.json()) as { ok?: boolean; data?: ChatResponse; error?: string };
    if (!json.ok || !json.data) {
      throw new Error(json.error || "I couldn't complete that request.");
    }
    handlers.onDone?.(json.data);
    return "json";
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "message";

  const dispatch = (rawEvent: string, rawData: string) => {
    if (!rawData.trim()) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawData);
    } catch {
      return;
    }
    const name = rawEvent || "message";
    if (name === "status" && parsed && typeof parsed === "object" && "status" in parsed) {
      handlers.onStatus?.(String((parsed as { status: string }).status));
    } else if (name === "delta" && parsed && typeof parsed === "object" && "text" in parsed) {
      handlers.onDelta?.(String((parsed as { text: string }).text));
    } else if (name === "done") {
      handlers.onDone?.(parsed as ChatResponse);
    } else if (name === "error" && parsed && typeof parsed === "object" && "message" in parsed) {
      handlers.onError?.(String((parsed as { message: string }).message));
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";
    let dataLines: string[] = [];

    for (const line of parts) {
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      } else if (line === "") {
        if (dataLines.length) {
          dispatch(eventName, dataLines.join("\n"));
        }
        eventName = "message";
        dataLines = [];
      }
    }
  }

  if (buffer.trim()) {
    // Flush a trailing event without a final blank line.
    const trailing = buffer.split("\n");
    const dataLines: string[] = [];
    let trailingEvent = eventName;
    for (const line of trailing) {
      if (line.startsWith("event:")) trailingEvent = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    if (dataLines.length) dispatch(trailingEvent, dataLines.join("\n"));
  }

  return "streamed";
}

export function AssistantProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [context, setContext] = useState<ConversationContext>(emptyContext());
  const [busy, setBusy] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [openaiConfigured, setOpenaiConfigured] = useState<boolean | null>(null);
  const [mode, setMode] = useState<"model" | "local" | null>(null);
  const contextRef = useRef(context);
  const messagesRef = useRef(messages);
  const abortRef = useRef<AbortController | null>(null);
  const activeAssistantIdRef = useRef<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    contextRef.current = context;
  }, [context]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as {
          messages?: AssistantMessage[];
          draft?: string;
          context?: ConversationContext;
        };
        if (saved.messages) {
          setMessages(
            saved.messages.slice(-40).map((message) => ({
              ...message,
              streaming: false,
            }))
          );
        }
        if (typeof saved.draft === "string") setDraft(saved.draft);
        if (saved.context) setContext({ ...emptyContext(), ...saved.context });
      }
    } catch {
      sessionStorage.removeItem(STORAGE_KEY);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        messages: messages
          .filter((message) => !message.streaming)
          .slice(-40)
          .map(({ id, role, content, blocks, createdAt }) => ({
            id,
            role,
            content,
            blocks,
            createdAt,
          })),
        draft,
        context,
      })
    );
  }, [ready, messages, draft, context]);

  useEffect(() => {
    void api<{ openai: boolean }>("/api/health")
      .then((health) => setOpenaiConfigured(health.openai))
      .catch(() => setOpenaiConfigured(null));
  }, []);

  const refreshRecords = useCallback(async () => {
    try {
      const [tasks, checklists, projects] = await Promise.all([
        api<Task[]>("/api/tasks"),
        api<ChecklistRow[]>("/api/checklists"),
        api<ProjectRow[]>("/api/projects"),
      ]);
      const projectName = new Map(projects.map((project) => [project.id, project.name]));
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Karachi";
      setMessages((current) =>
        current.map((message) => ({
          ...message,
          blocks: message.blocks?.map((block) => {
            if (block.type === "tasks") {
              return {
                ...block,
                tasks: block.tasks.map((card) => {
                  const fresh = tasks.find((task) => task.id === card.id);
                  if (!fresh) return card;
                  return {
                    ...card,
                    title: fresh.title,
                    priority: fresh.priority,
                    due_date: fresh.due_date,
                    due_time: fresh.due_time,
                    status: fresh.status,
                    project_id: fresh.project_id,
                    project_name: fresh.project_id
                      ? projectName.get(fresh.project_id) ?? card.project_name
                      : null,
                    estimated_minutes: fresh.estimated_minutes,
                    overdue: isOverdue(fresh.due_date, fresh.due_time, timezone, fresh.status),
                  };
                }),
              };
            }
            if (block.type === "checklists") {
              return {
                ...block,
                checklists: block.checklists.map((card) => {
                  const fresh = checklists.find((checklist) => checklist.id === card.id);
                  if (!fresh) return card;
                  return {
                    ...card,
                    title: fresh.title,
                    project_id: fresh.project_id,
                    project_name: fresh.project_id
                      ? projectName.get(fresh.project_id) ?? null
                      : null,
                    items: [...fresh.items]
                      .sort((a, b) => a.position - b.position)
                      .map((item) => ({
                        id: item.id,
                        title: item.title,
                        is_completed: item.is_completed,
                        position: item.position,
                      })),
                  };
                }),
              };
            }
            if (block.type === "projects") {
              return {
                ...block,
                projects: block.projects.map((card) => {
                  const fresh = projects.find((project) => project.id === card.id);
                  if (!fresh) return card;
                  return {
                    ...card,
                    name: fresh.name,
                    description: fresh.description,
                    status: fresh.status,
                    priority: fresh.priority,
                    deadline: fresh.deadline,
                    progress_percent: fresh.progress?.percent ?? card.progress_percent,
                    tasks: tasks
                      .filter((task) => task.project_id === fresh.id)
                      .slice(0, 8)
                      .map((task) => ({
                        id: task.id,
                        title: task.title,
                        status: task.status,
                        due_date: task.due_date,
                      })),
                  };
                }),
              };
            }
            return block;
          }),
        }))
      );
    } catch {
      // Keep the conversation cards if a refresh fails.
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    void refreshRecords();
  }, [ready, refreshRecords]);

  useEffect(() => {
    const onChange = () => {
      void refreshRecords();
    };
    window.addEventListener(DATA_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(DATA_CHANGED_EVENT, onChange);
  }, [refreshRecords]);

  const patchAssistant = useCallback((id: string, patch: Partial<AssistantMessage>) => {
    setMessages((current) =>
      current.map((message) => (message.id === id ? { ...message, ...patch } : message))
    );
  }, []);

  const applyChatResult = useCallback(
    async (
      assistantId: string,
      response: ChatResponse,
      options?: { clearConfirms?: boolean; alreadyStreamedText?: boolean; signal?: AbortSignal }
    ) => {
      setContext(response.context ?? emptyContext());
      setMode(response.mode);
      setOpenaiConfigured(response.openaiConfigured);

      if (options?.clearConfirms) {
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId
              ? message
              : {
                  ...message,
                  blocks: message.blocks?.filter((block) => block.type !== "confirm"),
                }
          )
        );
      }

      const fullText = response.message ?? "";
      const useReveal =
        !options?.alreadyStreamedText && fullText.length > 0 && !prefersReducedMotion();

      setThinking(false);

      if (useReveal) {
        const outcome = await revealText(
          fullText,
          (partial) => {
            patchAssistant(assistantId, {
              content: partial,
              streaming: true,
              blocks: [],
            });
          },
          { signal: options?.signal }
        );
        if (outcome === "aborted") {
          setMessages((current) =>
            current.map((message) => {
              if (message.id !== assistantId) return message;
              const hadText = Boolean(message.content.trim());
              return {
                ...message,
                content: hadText
                  ? `${message.content.trimEnd()}${interruptedMessage(true)}`
                  : interruptedMessage(false),
                blocks: hadText ? response.blocks ?? [] : [],
                streaming: false,
              };
            })
          );
        } else {
          patchAssistant(assistantId, {
            content: fullText,
            blocks: response.blocks ?? [],
            streaming: false,
          });
        }
      } else {
        // Live stream already showed the text (or reduced motion / empty). Attach final content + cards.
        patchAssistant(assistantId, {
          content: fullText,
          blocks: response.blocks ?? [],
          streaming: false,
        });
      }

      if (response.toolCalls?.some((call) => call.success && WRITE_TOOLS.has(call.name))) {
        notifyDataChanged();
      }
    },
    [patchAssistant]
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    const id = activeAssistantIdRef.current;
    if (id) {
      setMessages((current) =>
        current.map((message) => {
          if (message.id !== id) return message;
          const hadText = Boolean(message.content.trim());
          return {
            ...message,
            content: hadText
              ? `${message.content.trimEnd()}${interruptedMessage(true)}`
              : interruptedMessage(false),
            streaming: false,
          };
        })
      );
    }
    activeAssistantIdRef.current = null;
    setThinking(false);
    setBusy(false);
  }, []);

  const runChat = useCallback(
    async (payload: Record<string, unknown>, options?: { clearConfirms?: boolean }) => {
      const assistantId = newId();
      activeAssistantIdRef.current = assistantId;
      setMessages((current) => [
        ...current,
        {
          id: assistantId,
          role: "assistant",
          content: "",
          blocks: [],
          createdAt: new Date().toISOString(),
          streaming: true,
        },
      ]);
      setBusy(true);
      setThinking(true);

      const controller = new AbortController();
      abortRef.current = controller;
      let receivedDelta = false;
      let donePromise: Promise<void> | null = null;
      let sawTerminalEvent = false;

      try {
        await readSseChat(
          payload,
          {
            onStatus: () => {
              if (!receivedDelta) setThinking(true);
            },
            onDelta: (text) => {
              if (!text) return;
              receivedDelta = true;
              setThinking(false);
              setMessages((current) =>
                current.map((message) =>
                  message.id === assistantId
                    ? {
                        ...message,
                        content: `${message.content}${text}`,
                        streaming: true,
                      }
                    : message
                )
              );
            },
            onDone: (data) => {
              sawTerminalEvent = true;
              const clearConfirms =
                options?.clearConfirms === true
                  ? true
                  : options?.clearConfirms === false
                    ? false
                    : !data.context?.pending;
              donePromise = applyChatResult(assistantId, data, {
                clearConfirms,
                alreadyStreamedText: receivedDelta,
                signal: controller.signal,
              });
            },
            onError: (message) => {
              sawTerminalEvent = true;
              setThinking(false);
              patchAssistant(assistantId, {
                content: friendlyRequestError(new Error(message)),
                streaming: false,
                blocks: [],
              });
            },
          },
          controller.signal
        );

        if (donePromise) {
          await donePromise;
        } else if (!sawTerminalEvent && !controller.signal.aborted) {
          // Stream ended without a done event — leave whatever text we have.
          setThinking(false);
          patchAssistant(assistantId, { streaming: false });
        }
      } catch (error) {
        if (controller.signal.aborted) {
          setMessages((current) =>
            current.map((message) => {
              if (message.id !== assistantId) return message;
              if (message.content.includes("stopped here") || message.content.includes("stopped before")) {
                return { ...message, streaming: false };
              }
              const hadText = Boolean(message.content.trim());
              return {
                ...message,
                content: hadText
                  ? `${message.content.trimEnd()}${interruptedMessage(true)}`
                  : interruptedMessage(false),
                streaming: false,
              };
            })
          );
        } else {
          setThinking(false);
          patchAssistant(assistantId, {
            content: friendlyRequestError(error),
            streaming: false,
            blocks: [],
          });
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        if (activeAssistantIdRef.current === assistantId) activeAssistantIdRef.current = null;
        setThinking(false);
        setBusy(false);
      }
    },
    [applyChatResult, patchAssistant]
  );

  const send = useCallback(
    async (text?: string) => {
      const content = (text ?? draft).trim();
      if (!content || busy) return;
      const userMessage: AssistantMessage = {
        id: newId(),
        role: "user",
        content,
        createdAt: new Date().toISOString(),
      };
      const history = [...messagesRef.current, userMessage].slice(-20).map((message) => ({
        role: message.role,
        content: message.content,
      }));
      setMessages((current) => [...current, userMessage]);
      setDraft("");
      await runChat({ messages: history, context: contextRef.current });
    },
    [busy, draft, runChat]
  );

  const confirm = useCallback(
    async (action: { tool: string; args: Record<string, unknown> }) => {
      if (busy) return;
      setMessages((current) => [
        ...current,
        {
          id: newId(),
          role: "user",
          content: "Yes, go ahead and delete it.",
          createdAt: new Date().toISOString(),
        },
      ]);
      await runChat(
        { confirm: action, context: contextRef.current },
        { clearConfirms: true }
      );
    },
    [busy, runChat]
  );

  const dismissPending = useCallback(async () => {
    if (busy) return;
    await runChat(
      { dismissPending: true, context: contextRef.current },
      { clearConfirms: true }
    );
  }, [busy, runChat]);

  const clearChat = useCallback(() => {
    if (busy) {
      stop();
    }
    setMessages([]);
    setDraft("");
    setContext(emptyContext());
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage failures.
    }
  }, [busy, stop]);

  const value = useMemo<AssistantApi>(
    () => ({
      messages,
      draft,
      setDraft,
      busy,
      thinking,
      openaiConfigured,
      mode,
      send,
      stop,
      clearChat,
      confirm,
      dismissPending,
      patchTask: () => undefined,
      refreshRecords,
    }),
    [
      messages,
      draft,
      busy,
      thinking,
      openaiConfigured,
      mode,
      send,
      stop,
      clearChat,
      confirm,
      dismissPending,
      refreshRecords,
    ]
  );

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}

export function useAssistant() {
  const value = useContext(AssistantContext);
  if (!value) throw new Error("useAssistant must be used within AssistantProvider");
  return value;
}
