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
import {
  type AgentMode,
  parseSlashCommand,
  SLASH_HELP,
} from "@/lib/ai/agent-mode";
import type { AgentStep, AssistantBlock, ConversationContext } from "@/lib/ai/types";
import { emptyContext } from "@/lib/ai/types";
import {
  friendlyRequestError,
  interruptedMessage,
} from "@/lib/ai/user-messages";
import { prefersReducedMotion, revealText } from "@/lib/ai/typing";
import type { Checklist, ChecklistItem, Task } from "@/types";

const STORAGE_KEY = "lifepilot-assistant-v1";
const INSTRUCTIONS_KEY = "lifepilot-agent-instructions";
/** Client abort if the stream stalls longer than the server agent budget. */
const CLIENT_TIMEOUT_MS = 55_000;
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
  agentMode?: AgentMode;
  followUps?: string[];
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
  /** Short live status for the thinking/working indicator. */
  statusLabel: string | null;
  activity: AgentStep[];
  queueLength: number;
  openaiConfigured: boolean | null;
  mode: "model" | "local" | null;
  agentMode: AgentMode;
  setAgentMode: (mode: AgentMode) => void;
  customInstructions: string;
  setCustomInstructions: (value: string) => void;
  /** Ambiguous date options awaiting a tap or typed answer. */
  pendingClarification: ConversationContext["pendingClarification"];
  /** Spelling/intent confirm awaiting yes/no. */
  pendingInterpretation: ConversationContext["pendingInterpretation"];
  send: (text?: string) => Promise<void>;
  regenerate: () => Promise<void>;
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

async function readSseChat(
  body: Record<string, unknown>,
  handlers: {
    onStatus?: (status: string) => void;
    onDelta?: (text: string) => void;
    onTool?: (step: AgentStep) => void;
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
    } else if (name === "tool" && parsed && typeof parsed === "object") {
      const tool = parsed as { name?: string; label?: string; status?: string };
      if (tool.name && tool.label && tool.status) {
        handlers.onTool?.({
          name: tool.name,
          label: tool.label,
          status: tool.status as AgentStep["status"],
        });
      }
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
  const [statusLabel, setStatusLabel] = useState<string | null>(null);
  const [activity, setActivity] = useState<AgentStep[]>([]);
  const [queue, setQueue] = useState<string[]>([]);
  const [openaiConfigured, setOpenaiConfigured] = useState<boolean | null>(null);
  const [mode, setMode] = useState<"model" | "local" | null>(null);
  const [agentMode, setAgentMode] = useState<AgentMode>("agent");
  const [customInstructions, setCustomInstructionsState] = useState("");
  const contextRef = useRef(context);
  const messagesRef = useRef(messages);
  const busyRef = useRef(false);
  const agentModeRef = useRef<AgentMode>("agent");
  const instructionsRef = useRef("");
  const queueRef = useRef<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const abortReasonRef = useRef<"user" | "timeout" | null>(null);
  const activeAssistantIdRef = useRef<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    contextRef.current = context;
  }, [context]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);
  useEffect(() => {
    agentModeRef.current = agentMode;
  }, [agentMode]);
  useEffect(() => {
    instructionsRef.current = customInstructions;
  }, [customInstructions]);
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as {
          messages?: AssistantMessage[];
          draft?: string;
          context?: ConversationContext;
          agentMode?: AgentMode;
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
        if (saved.agentMode === "agent" || saved.agentMode === "plan" || saved.agentMode === "ask") {
          setAgentMode(saved.agentMode);
        }
      }
      const instructions = sessionStorage.getItem(INSTRUCTIONS_KEY);
      if (instructions) setCustomInstructionsState(instructions);
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
        agentMode,
      })
    );
  }, [ready, messages, draft, context, agentMode]);

  const setCustomInstructions = useCallback((value: string) => {
    setCustomInstructionsState(value);
    try {
      sessionStorage.setItem(INSTRUCTIONS_KEY, value);
    } catch {
      // Ignore storage failures.
    }
  }, []);

  useEffect(() => {
    void api<{ openai: boolean }>("/api/health")
      .then((health) => setOpenaiConfigured(health.openai))
      .catch(() => setOpenaiConfigured(null));
  }, []);

  const refreshRecords = useCallback(async () => {
    try {
      const [tasks, checklists] = await Promise.all([
        api<Task[]>("/api/tasks"),
        api<ChecklistRow[]>("/api/checklists"),
      ]);
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Karachi";
      setMessages((current) =>
        current.map((message) => ({
          ...message,
          blocks: message.blocks
            ?.filter((block) => block.type !== "projects")
            .map((block) => {
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
                      project_id: null,
                      project_name: null,
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
                      project_id: null,
                      project_name: null,
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
      const allBlocks = response.blocks ?? [];
      // Surface interpretation chips immediately; keep interactive cards until text settles.
      const earlyBlocks = allBlocks.filter((block) => block.type === "interpretation");
      const useReveal =
        !options?.alreadyStreamedText && fullText.length > 0 && !prefersReducedMotion();

      setThinking(false);
      setStatusLabel(null);

      if (useReveal) {
        const outcome = await revealText(
          fullText,
          (partial) => {
            patchAssistant(assistantId, {
              content: partial,
              streaming: true,
              blocks: earlyBlocks,
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
                // Only attach result cards when some reply text was already visible.
                blocks: hadText ? allBlocks : earlyBlocks,
                streaming: false,
              };
            })
          );
        } else {
          patchAssistant(assistantId, {
            content: fullText,
            blocks: allBlocks,
            streaming: false,
          });
        }
      } else {
        // Live stream already showed the text (or reduced motion / empty). Attach final content + cards.
        patchAssistant(assistantId, {
          content: fullText,
          blocks: allBlocks,
          streaming: false,
        });
      }

      const writes = response.toolCalls?.filter((call) => WRITE_TOOLS.has(call.name)) ?? [];
      if (writes.some((call) => call.success)) {
        notifyDataChanged();
      }
    },
    [patchAssistant]
  );

  const stop = useCallback(() => {
    abortReasonRef.current = "user";
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
    setStatusLabel(null);
    setBusy(false);
    setActivity([]);
  }, []);

  const drainQueue = useCallback(async () => {
    const next = queueRef.current[0];
    if (!next || busyRef.current) return;
    setQueue((current) => current.slice(1));
    // Deferred so busyRef clears before send.
    await Promise.resolve();
    // send is defined below; call through a microtask after state updates.
    queueMicrotask(() => {
      void sendRef.current?.(next);
    });
  }, []);

  const sendRef = useRef<((text?: string) => Promise<void>) | null>(null);

  const runChat = useCallback(
    async (payload: Record<string, unknown>, options?: { clearConfirms?: boolean }) => {
      const assistantId = newId();
      activeAssistantIdRef.current = assistantId;
      abortReasonRef.current = null;
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
      setStatusLabel("Thinking…");
      setActivity([]);

      const controller = new AbortController();
      abortRef.current = controller;
      let receivedDelta = false;
      let donePromise: Promise<void> | null = null;
      let sawTerminalEvent = false;
      let timedOut = false;

      const timeoutId = window.setTimeout(() => {
        if (abortRef.current !== controller) return;
        timedOut = true;
        abortReasonRef.current = "timeout";
        controller.abort();
      }, CLIENT_TIMEOUT_MS);

      const enriched = {
        ...payload,
        agentMode: agentModeRef.current,
        customInstructions: instructionsRef.current || undefined,
      };

      try {
        await readSseChat(
          enriched,
          {
            onStatus: (status) => {
              if (receivedDelta) return;
              setThinking(true);
              setStatusLabel(status === "working" ? "Working…" : "Thinking…");
            },
            onDelta: (text) => {
              if (!text) return;
              receivedDelta = true;
              setThinking(false);
              setStatusLabel(null);
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
            onTool: (step) => {
              setThinking(false);
              setStatusLabel(
                step.status === "running"
                  ? step.label
                  : step.status === "error"
                    ? "Something failed"
                    : null
              );
              setActivity((current) => {
                const index = current.findIndex(
                  (item) => item.name === step.name && item.status === "running"
                );
                if (index >= 0) {
                  const copy = [...current];
                  copy[index] = step;
                  return copy;
                }
                return [...current, step];
              });
            },
            onDone: (data) => {
              sawTerminalEvent = true;
              // Tools are finished — drop the live ops list so typewriter/stream settle doesn't look stuck.
              setActivity([]);
              setStatusLabel(receivedDelta ? null : "Writing…");
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
              setStatusLabel(null);
              patchAssistant(assistantId, {
                content: friendlyRequestError(new Error(message)),
                streaming: false,
                blocks: [
                  {
                    type: "notice",
                    tone: "error",
                    text: "That request did not complete. Nothing new was saved.",
                  },
                ],
              });
            },
          },
          controller.signal
        );

        if (donePromise) {
          await donePromise;
        } else if (!sawTerminalEvent && !controller.signal.aborted) {
          setThinking(false);
          setStatusLabel(null);
          patchAssistant(assistantId, {
            content: friendlyRequestError(new Error("The reply ended early.")),
            streaming: false,
            blocks: [
              {
                type: "notice",
                tone: "error",
                text: "The connection closed before a full answer arrived. Nothing new was saved.",
              },
            ],
          });
        }
      } catch (error) {
        if (controller.signal.aborted) {
          const reason = abortReasonRef.current;
          if (reason === "timeout" || timedOut) {
            setThinking(false);
            setStatusLabel(null);
            patchAssistant(assistantId, {
              content: friendlyRequestError(
                new Error("That took too long, so I stopped waiting.")
              ),
              streaming: false,
              blocks: [
                {
                  type: "notice",
                  tone: "error",
                  text: "Timed out before finishing. Nothing new was saved from this reply.",
                },
              ],
            });
          } else {
            setMessages((current) =>
              current.map((message) => {
                if (message.id !== assistantId) return message;
                if (
                  message.content.includes("stopped here") ||
                  message.content.includes("stopped before")
                ) {
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
          }
        } else {
          setThinking(false);
          setStatusLabel(null);
          patchAssistant(assistantId, {
            content: friendlyRequestError(error),
            streaming: false,
            blocks: [
              {
                type: "notice",
                tone: "error",
                text: "That request failed. Nothing new was saved.",
              },
            ],
          });
        }
      } finally {
        window.clearTimeout(timeoutId);
        if (abortRef.current === controller) abortRef.current = null;
        if (activeAssistantIdRef.current === assistantId) activeAssistantIdRef.current = null;
        abortReasonRef.current = null;
        setThinking(false);
        setStatusLabel(null);
        setBusy(false);
        setActivity([]);
        queueMicrotask(() => {
          void drainQueue();
        });
      }
    },
    [applyChatResult, drainQueue, patchAssistant]
  );

  const send = useCallback(
    async (text?: string) => {
      const raw = (text ?? draft).trim();
      if (!raw) return;

      if (busyRef.current) {
        // Queue follow-ups, but skip an identical consecutive duplicate to avoid double-runs.
        setQueue((current) => {
          if (current[current.length - 1] === raw) return current;
          return [...current, raw].slice(-8);
        });
        if (!text) setDraft("");
        return;
      }

      const parsed = parseSlashCommand(raw);

      if (parsed.builtin === "clear") {
        if (!text) setDraft("");
        setMessages([]);
        setContext(emptyContext());
        setActivity([]);
        setQueue([]);
        try {
          sessionStorage.removeItem(STORAGE_KEY);
        } catch {
          // ignore
        }
        return;
      }

      if (parsed.builtin === "help") {
        if (!text) setDraft("");
        setMessages((current) => [
          ...current,
          {
            id: newId(),
            role: "user",
            content: raw,
            createdAt: new Date().toISOString(),
          },
          {
            id: newId(),
            role: "assistant",
            content: SLASH_HELP,
            createdAt: new Date().toISOString(),
          },
        ]);
        return;
      }

      if (parsed.builtin === "regenerate") {
        if (!text) setDraft("");
        const history = [...messagesRef.current];
        while (history.length && history[history.length - 1]?.role === "assistant") {
          history.pop();
        }
        if (!history.some((message) => message.role === "user")) return;
        setMessages(history);
        messagesRef.current = history;
        await runChat({
          messages: history
            .slice(-20)
            .map((message) => ({ role: message.role, content: message.content })),
          context: contextRef.current,
        });
        return;
      }

      if (parsed.mode) {
        setAgentMode(parsed.mode);
        agentModeRef.current = parsed.mode;
      }

      const content =
        parsed.builtin === "undo" ? "undo" : parsed.text || (parsed.mode ? `Switched to ${parsed.mode} mode.` : raw);

      if (!content.trim()) return;

      const userMessage: AssistantMessage = {
        id: newId(),
        role: "user",
        content: parsed.mode && parsed.text ? raw : content,
        createdAt: new Date().toISOString(),
      };
      const history = [...messagesRef.current, userMessage].slice(-20).map((message) => ({
        role: message.role,
        content: message.content,
      }));
      setMessages((current) => [...current, userMessage]);
      if (!text) setDraft("");
      await runChat({ messages: history, context: contextRef.current });
    },
    [draft, runChat]
  );

  sendRef.current = send;

  const regenerate = useCallback(async () => {
    await send("/retry");
  }, [send]);

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
      statusLabel,
      activity,
      queueLength: queue.length,
      openaiConfigured,
      mode,
      agentMode,
      setAgentMode,
      customInstructions,
      setCustomInstructions,
      pendingClarification: context.pendingClarification ?? null,
      pendingInterpretation: context.pendingInterpretation ?? null,
      send,
      regenerate,
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
      statusLabel,
      activity,
      queue.length,
      openaiConfigured,
      mode,
      agentMode,
      customInstructions,
      setCustomInstructions,
      context.pendingClarification,
      context.pendingInterpretation,
      send,
      regenerate,
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
