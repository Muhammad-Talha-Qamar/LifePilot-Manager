"use client";

import { useEffect, useRef } from "react";
import { ArrowUp, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LifePilotLogo } from "@/components/motion/animate";
import { cn } from "@/lib/utils";
import { MessageBlocks } from "./message-blocks";
import { useAssistant } from "./assistant-provider";

const PROMPTS = [
  "What should I finish today?",
  "Remind me to call mom tomorrow",
  "Plan my day",
  "Create a project called _________",
  "Create a checklist for groceries with milk and eggs",
];

function AssistantText({
  content,
  streaming,
}: {
  content: string;
  streaming?: boolean;
}) {
  return (
    <div className="relative min-w-0">
      <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[14px] leading-relaxed text-foreground/95 sm:text-[15px]">
        {content}
      </p>
      {streaming && content.length > 0 && (
        <span
          className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[0.12em] align-baseline animate-pulse bg-gradient-to-b from-violet-500 to-cyan-400"
          aria-hidden
        />
      )}
    </div>
  );
}

export function AssistantWorkspace() {
  const {
    messages,
    draft,
    setDraft,
    busy,
    thinking,
    openaiConfigured,
    mode,
    send,
    stop,
  } = useAssistant();
  const scroller = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);
  const empty = messages.length === 0;
  const streamingMessage = [...messages].reverse().find((message) => message.streaming);
  const showThinking = thinking && (!streamingMessage || !streamingMessage.content);

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
  }, [messages, busy, thinking, empty]);

  useEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [draft]);

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !draft.trim()) return;
    void send();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!busy && draft.trim()) void send();
    }
  }

  return (
    <div className="ai-workspace relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden">
      {openaiConfigured === false && (
        <div
          role="status"
          className="ai-banner animate-fade shrink-0 px-3 py-2 text-center text-[12px] leading-snug text-muted-foreground sm:px-4 sm:py-2.5 sm:text-sm md:px-8"
        >
          Full conversational AI is not connected yet. Clear requests still work for tasks,
          checklists, projects, and dates.
        </div>
      )}

      <div ref={scroller} className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
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
                Tell me what you need to do. I&apos;ll help you organize your tasks, projects,
                checklists, and important dates.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-1.5 sm:mt-6 sm:gap-2">
                {PROMPTS.map((prompt, index) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => {
                      if (prompt.includes("_________")) {
                        setDraft(prompt);
                        field.current?.focus();
                        return;
                      }
                      void send(prompt);
                    }}
                    disabled={busy}
                    className="ai-suggestion animate-fade-up max-w-full text-[12px] sm:text-sm"
                    style={{ animationDelay: `${80 + index * 60}ms` }}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </section>
          )}

          {messages.map((message, index) => (
            <article
              key={message.id}
              className={cn(
                "animate-message-in w-full min-w-0 text-[14px] leading-relaxed sm:text-[15px]",
                message.role === "user" ? "flex justify-end" : "flex justify-start"
              )}
              style={{ animationDelay: index === messages.length - 1 ? "0ms" : undefined }}
              aria-busy={message.streaming || undefined}
            >
              {message.role === "user" ? (
                <div className="ai-message-user max-w-[min(100%,22rem)] rounded-2xl rounded-br-lg px-3 py-2 sm:max-w-[85%] sm:rounded-3xl sm:rounded-br-xl sm:px-4 sm:py-2.5 md:max-w-[75%]">
                  <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                    {message.content}
                  </p>
                </div>
              ) : (
                <div className="ai-message-assistant w-full min-w-0 max-w-full space-y-2 sm:space-y-2.5">
                  {(message.content || message.streaming) && (
                    <div className="ai-reply-text min-w-0">
                      <AssistantText content={message.content} streaming={message.streaming} />
                    </div>
                  )}
                  {message.blocks && message.blocks.length > 0 && !message.streaming && (
                    <MessageBlocks blocks={message.blocks} />
                  )}
                </div>
              )}
            </article>
          ))}

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
              Thinking…
            </div>
          )}
        </div>
      </div>

      <div className="ai-composer-dock relative z-10 shrink-0 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:px-4 sm:pt-2.5 md:px-6 md:pb-6">
        <form onSubmit={onSubmit} className="mx-auto w-full min-w-0 max-w-[42rem]">
          {!empty && (
            <div className="mb-2 flex max-w-full gap-1.5 overflow-x-auto overscroll-x-contain pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] sm:mb-2.5 sm:gap-2 [&::-webkit-scrollbar]:hidden">
              {PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => {
                    setDraft(prompt);
                    field.current?.focus();
                  }}
                  disabled={busy}
                  className="ai-suggestion shrink-0 !rounded-lg !px-2.5 !py-1 text-[11px] sm:!rounded-xl sm:!px-3 sm:!py-1.5 sm:text-xs disabled:opacity-50"
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
              disabled={busy}
              placeholder="Ask LifePilot to organize your day..."
              style={{ border: "none", outline: "none", boxShadow: "none" }}
              className="max-h-36 min-h-[44px] min-w-0 flex-1 resize-none border-0 bg-transparent px-2.5 py-2.5 text-[14px] leading-relaxed text-foreground shadow-none outline-none ring-0 focus:border-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 placeholder:truncate placeholder:text-muted-foreground disabled:cursor-not-allowed sm:min-h-[48px] sm:px-3 sm:py-3 sm:text-[15px]"
            />
            {busy ? (
              <Button
                type="button"
                size="icon"
                variant="secondary"
                className="mb-0.5 h-10 w-10 shrink-0 rounded-full sm:h-11 sm:w-11"
                onClick={stop}
                aria-label="Stop generating"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon"
                className="ai-send-btn mb-0.5 h-10 w-10 shrink-0 rounded-full sm:h-11 sm:w-11"
                disabled={!draft.trim()}
                aria-label="Send message"
              >
                <ArrowUp className="h-4 w-4 sm:h-5 sm:w-5" />
              </Button>
            )}
          </div>

          <p className="mt-1.5 px-1 text-center text-[10px] leading-snug text-muted-foreground sm:mt-2 sm:text-[11px]">
            {busy
              ? "Generating a reply · tap stop to cancel"
              : openaiConfigured
                ? "Enter to send · Shift+Enter for a new line"
                : mode === "local"
                  ? "only use the options that are given for prompts"
                  : "Enter to send · Shift+Enter for a new line"}
          </p>
        </form>
      </div>
    </div>
  );
}
