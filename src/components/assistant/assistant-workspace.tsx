"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Loader2, RotateCcw, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LifePilotLogo } from "@/components/motion/animate";
import type { AgentMode } from "@/lib/ai/agent-mode";
import { cn } from "@/lib/utils";
import { FormattedReply } from "./formatted-reply";
import { MessageBlocks } from "./message-blocks";
import { useAssistant } from "./assistant-provider";

const PROMPTS = [
  "What's left today?",
  "Remind me to call mom tomorrow",
  "The essay is done",
  "Shopping list: milk, eggs, bread",
  "Plan my day",
  "/plan organize my week",
];

const MODES: { id: AgentMode; label: string; hint: string }[] = [
  { id: "agent", label: "Agent", hint: "Read + write" },
  { id: "plan", label: "Plan", hint: "Steps only" },
  { id: "ask", label: "Ask", hint: "Read-only" },
];

export function AssistantWorkspace() {
  const {
    messages,
    draft,
    setDraft,
    busy,
    thinking,
    statusLabel,
    activity,
    queueLength,
    openaiConfigured,
    agentMode,
    setAgentMode,
    customInstructions,
    setCustomInstructions,
    pendingClarification,
    pendingInterpretation,
    send,
    regenerate,
    stop,
  } = useAssistant();
  const scroller = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);
  const [showInstructions, setShowInstructions] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const empty = messages.length === 0;
  const streamingMessage = [...messages].reverse().find((message) => message.streaming);
  const showThinking =
    thinking && activity.length === 0 && (!streamingMessage || !streamingMessage.content);
  const showPendingActions =
    !busy &&
    Boolean(
      pendingClarification?.options?.length || pendingInterpretation?.question
    );

  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const onScroll = () => {
      const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
      stickToBottom.current = distance < 96;
    };
    node.addEventListener("scroll", onScroll, { passive: true });
    return () => node.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const node = scroller.current;
    if (!node || empty || !stickToBottom.current) return;
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.scrollTo({ top: node.scrollHeight, behavior: reduceMotion ? "auto" : "smooth" });
  }, [messages, busy, thinking, activity, statusLabel, empty]);

  useEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [draft]);

  // Keep the composer above the on-screen keyboard on mobile browsers.
  useEffect(() => {
    const visual = window.visualViewport;
    if (!visual) return;

    const sync = () => {
      const inset = Math.max(0, window.innerHeight - visual.height - visual.offsetTop);
      setKeyboardInset(inset > 48 ? inset : 0);
    };

    sync();
    visual.addEventListener("resize", sync);
    visual.addEventListener("scroll", sync);
    return () => {
      visual.removeEventListener("resize", sync);
      visual.removeEventListener("scroll", sync);
    };
  }, []);

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    // While busy, send() queues the follow-up instead of starting a parallel request.
    if (!draft.trim()) return;
    void send();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (draft.trim()) void send();
    }
  }

  return (
    <div className="ai-workspace relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden">
      {openaiConfigured === false && (
        <div
          role="status"
          className="ai-banner animate-fade shrink-0 px-3 py-2 text-center text-[12px] leading-snug text-muted-foreground sm:px-4 sm:py-2.5 sm:text-sm md:px-8"
        >
          Full cloud AI is not connected yet. Local agent modes still work — add an OpenAI key
          for deeper Cursor-style reasoning.
        </div>
      )}

      <div className="shrink-0 border-b border-border/50 px-3 py-2 sm:px-4 md:px-6">
        <div className="mx-auto flex w-full max-w-[42rem] flex-wrap items-center justify-between gap-2">
          <div
            className="inline-flex rounded-full border border-border/70 bg-surface-soft/80 p-0.5"
            role="tablist"
            aria-label="Assistant mode"
          >
            {MODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                role="tab"
                aria-selected={agentMode === mode.id}
                title={mode.hint}
                onClick={() => setAgentMode(mode.id)}
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-3 sm:text-xs",
                  agentMode === mode.id
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {mode.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowInstructions((value) => !value)}
              className="rounded-lg px-2 py-1 text-[11px] text-muted-foreground hover:bg-surface-soft hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-xs"
              aria-expanded={showInstructions}
              aria-controls="agent-rules"
            >
              Rules
            </button>
            <button
              type="button"
              onClick={() => void regenerate()}
              disabled={busy || empty}
              className="inline-flex min-h-8 items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-muted-foreground hover:bg-surface-soft hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 sm:text-xs"
              title="Regenerate last reply"
            >
              <RotateCcw className="h-3 w-3" aria-hidden />
              Retry
            </button>
          </div>
        </div>
        {showInstructions && (
          <div className="mx-auto mt-2 w-full max-w-[42rem]">
            <label htmlFor="agent-rules" className="sr-only">
              Custom agent instructions
            </label>
            <textarea
              id="agent-rules"
              value={customInstructions}
              onChange={(event) => setCustomInstructions(event.target.value)}
              rows={3}
              placeholder="Custom instructions (like Cursor rules) — e.g. prefer checklists for shopping, keep replies short…"
              className="w-full resize-y rounded-xl border border-border/70 bg-background/80 px-3 py-2 text-[12px] leading-relaxed text-foreground outline-none ring-0 placeholder:text-muted-foreground focus-visible:border-foreground/30 focus-visible:ring-2 focus-visible:ring-ring sm:text-[13px]"
            />
          </div>
        )}
      </div>

      <div
        ref={scroller}
        className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto"
        aria-live="polite"
        aria-relevant="additions text"
      >
        <div
          className={cn(
            "mx-auto flex w-full max-w-[42rem] min-w-0 flex-col px-3 sm:px-4 md:px-6",
            empty ? "min-h-full py-4 sm:py-6" : "gap-4 py-5 pb-3 sm:gap-6 sm:py-8 sm:pb-4"
          )}
        >
          {empty && (
            <section className="animate-message-in mx-auto my-auto flex w-full max-w-lg min-w-0 flex-col justify-center py-3 text-center sm:py-4">
              <div className="ai-logo-wrap mx-auto mb-3 sm:mb-5">
                <span className="ai-logo-glow" aria-hidden />
                <span className="ai-logo-mark" aria-hidden>
                  <LifePilotLogo size={22} />
                </span>
              </div>
              <h1 className="font-display text-balance text-[1.25rem] font-semibold tracking-tight text-foreground sm:text-[1.65rem] md:text-[1.75rem]">
                Hello, what would you like to get organized today?
              </h1>
              <p className="mx-auto mt-2 max-w-md text-pretty text-[13px] leading-relaxed text-muted-foreground sm:mt-3 sm:text-[15px]">
                Cursor-style agent for your life: Agent writes, Plan outlines, Ask only reads.
                Try /plan, /ask, /undo, or /help.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-1.5 sm:mt-6 sm:gap-2">
                {PROMPTS.map((prompt, index) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => void send(prompt)}
                    disabled={busy}
                    className="ai-suggestion animate-fade-up max-w-full text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
                    style={{ animationDelay: `${80 + index * 60}ms` }}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </section>
          )}

          {messages.map((message, index) => {
            const isLatest = index === messages.length - 1;
            return (
              <article
                key={message.id}
                className={cn(
                  "w-full min-w-0 text-[14px] leading-relaxed sm:text-[15px]",
                  isLatest && "animate-message-in",
                  message.role === "user" ? "flex justify-end" : "flex justify-start"
                )}
                aria-busy={message.streaming || undefined}
                aria-label={message.role === "user" ? "Your message" : "LifePilot reply"}
              >
                {message.role === "user" ? (
                  <div className="ai-message-user max-w-[min(100%,22rem)] rounded-2xl rounded-br-lg px-3 py-2 sm:max-w-[85%] sm:rounded-3xl sm:rounded-br-xl sm:px-4 sm:py-2.5 md:max-w-[75%]">
                    <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                      {message.content}
                    </p>
                  </div>
                ) : (
                  <div className="ai-message-assistant w-full min-w-0 max-w-full space-y-2 sm:space-y-2.5">
                    {message.blocks &&
                      message.blocks.some((block) => block.type === "interpretation") && (
                        <MessageBlocks
                          blocks={message.blocks.filter(
                            (block) => block.type === "interpretation"
                          )}
                        />
                      )}
                    {(message.content || message.streaming) && (
                      <div className="ai-reply-text min-w-0">
                        <FormattedReply
                          content={message.content}
                          streaming={message.streaming}
                        />
                      </div>
                    )}
                    {message.blocks &&
                      message.blocks.some((block) => block.type !== "interpretation") &&
                      !message.streaming && (
                        <MessageBlocks
                          blocks={message.blocks.filter(
                            (block) => block.type !== "interpretation"
                          )}
                        />
                      )}
                  </div>
                )}
              </article>
            );
          })}

          {activity.length > 0 && (
            <div
              className="ai-activity animate-message-in rounded-xl border border-border/60 bg-surface-soft/70 px-3 py-2.5 text-[12px] text-muted-foreground"
              role="status"
              aria-live="polite"
            >
              <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                Task operations
              </p>
              <ul className="mt-1.5 space-y-1.5">
                {activity.map((step, index) => (
                  <li
                    key={`${step.name}-${index}`}
                    className={cn(
                      "flex items-center gap-2",
                      step.status === "error" && "text-rose-600 dark:text-rose-400",
                      step.status === "done" && "text-emerald-700 dark:text-emerald-400"
                    )}
                  >
                    <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden>
                      {step.status === "done" ? (
                        "✓"
                      ) : step.status === "error" ? (
                        "!"
                      ) : (
                        <span className="ai-thinking-dot h-1.5 w-1.5 rounded-full" />
                      )}
                    </span>
                    <span>{step.label}</span>
                    <span className="sr-only">
                      {step.status === "done"
                        ? "succeeded"
                        : step.status === "error"
                          ? "failed"
                          : "in progress"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {showThinking && (
            <div
              className="animate-message-in flex items-center gap-2 text-sm text-muted-foreground"
              role="status"
              aria-live="polite"
            >
              <span className="flex items-center gap-1.5" aria-hidden>
                <span className="ai-thinking-dot h-1.5 w-1.5 rounded-full" />
                <span className="ai-thinking-dot h-1.5 w-1.5 rounded-full [animation-delay:150ms]" />
                <span className="ai-thinking-dot h-1.5 w-1.5 rounded-full [animation-delay:300ms]" />
              </span>
              {statusLabel || "Thinking…"}
            </div>
          )}

          {showPendingActions && (
            <div
              className="animate-message-in space-y-2"
              role="group"
              aria-label="Clarify your request"
            >
              {pendingInterpretation?.question && (
                <div className="ai-clarify-bar">
                  <p className="text-[12px] text-muted-foreground sm:text-[13px]">
                    {pendingInterpretation.question}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      className="ai-suggestion !rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => void send("yes")}
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      className="ai-suggestion !rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => void send("no")}
                    >
                      No
                    </button>
                  </div>
                </div>
              )}
              {pendingClarification?.options?.length ? (
                <div className="ai-clarify-bar">
                  <p className="text-[12px] text-muted-foreground sm:text-[13px]">
                    {pendingClarification.question}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {pendingClarification.options.map((option) => (
                      <button
                        key={`${option.label}-${option.date}`}
                        type="button"
                        className="ai-suggestion !rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => void send(option.label)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <div
        className="ai-composer-dock relative z-10 shrink-0 px-3 pt-2 sm:px-4 sm:pt-2.5 md:px-6"
        style={{
          paddingBottom: `max(0.75rem, calc(env(safe-area-inset-bottom) + ${keyboardInset}px))`,
        }}
      >
        <form onSubmit={onSubmit} className="mx-auto w-full min-w-0 max-w-[42rem]">
          {!empty && (
            <div className="mb-2 flex max-w-full gap-1.5 overflow-x-auto overscroll-x-contain pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] sm:mb-2.5 sm:gap-2 [&::-webkit-scrollbar]:hidden">
              {PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setDraft(prompt);
                    field.current?.focus();
                  }}
                  className="ai-suggestion shrink-0 !rounded-lg !px-2.5 !py-1 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:!rounded-xl sm:!px-3 sm:!py-1.5 sm:text-xs"
                >
                  {prompt}
                </button>
              ))}
            </div>
          )}

          <div
            className={cn(
              "ai-composer flex min-w-0 items-end gap-1.5 border-0 p-1.5 shadow-none outline-none ring-0 sm:gap-2 sm:p-2",
              busy && "opacity-95"
            )}
            style={{ border: "none", outline: "none" }}
          >
            <label htmlFor="assistant-composer" className="sr-only">
              Message LifePilot
            </label>
            <textarea
              id="assistant-composer"
              ref={field}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              enterKeyHint="send"
              aria-busy={busy || undefined}
              placeholder={
                agentMode === "plan"
                  ? "Plan mode — outline steps without changing data…"
                  : agentMode === "ask"
                    ? "Ask mode — questions only, no writes…"
                    : "Agent mode — say anything, or /plan /ask /undo /help…"
              }
              style={{ border: "none", outline: "none", boxShadow: "none" }}
              className="max-h-36 min-h-[44px] min-w-0 flex-1 resize-none border-0 bg-transparent px-2.5 py-2.5 text-[16px] leading-relaxed text-foreground shadow-none outline-none ring-0 focus:border-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 placeholder:truncate placeholder:text-muted-foreground sm:min-h-[48px] sm:px-3 sm:py-3 sm:text-[15px]"
            />
            {busy ? (
              <Button
                type="button"
                size="icon"
                variant="secondary"
                className="mb-0.5 h-11 w-11 shrink-0 rounded-full focus-visible:ring-2 focus-visible:ring-ring sm:h-11 sm:w-11"
                onClick={stop}
                aria-label="Stop generating"
              >
                <Square className="h-3.5 w-3.5 fill-current" aria-hidden />
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon"
                className="ai-send-btn mb-0.5 h-11 w-11 shrink-0 rounded-full focus-visible:ring-2 focus-visible:ring-ring sm:h-11 sm:w-11"
                disabled={!draft.trim()}
                aria-label="Send message"
              >
                <ArrowUp className="h-4 w-4 sm:h-5 sm:w-5" aria-hidden />
              </Button>
            )}
          </div>

          <p
            className="mt-1.5 px-1 text-center text-[10px] leading-snug text-muted-foreground sm:mt-2 sm:text-[11px]"
            role="status"
            aria-live="polite"
          >
            {busy
              ? queueLength > 0
                ? `${statusLabel || "Working"} · ${queueLength} queued · tap stop to cancel`
                : `${statusLabel || "Working"} · tap stop to cancel`
              : `${agentMode === "agent" ? "Agent" : agentMode === "plan" ? "Plan" : "Ask"} mode · /help for commands`}
          </p>
        </form>
      </div>
    </div>
  );
}
