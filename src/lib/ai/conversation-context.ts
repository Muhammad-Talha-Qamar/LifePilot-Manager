/**
 * Conversation-context helpers for LifePilot.
 *
 * Keeps multi-turn meaning (focus, last tasks, pending asks, last turn)
 * without shipping unbounded chat history to the model.
 */

import type { Board, ConversationContext, LastTurn, PendingRequest } from "./types";
import { emptyContext } from "./types";
import { normalizeCommand, cleanPhrase, titleCase } from "./match";

export type HistoryMessage = { role: "user" | "assistant" | "system"; content: string };

const DATE_HINT =
  /(?:today|tonight|tomorrow|yesterday|this\s+\w+|next\s+\w+|(?:mon|tues|wednes|thurs|fri|satur|sun)day|\d{4}-\d{2}-\d{2}|(?:\d{1,2}\s+)?(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+\d{1,2}(?:,?\s*\d{4})?)?)/i;

const CATEGORY_WORDS =
  /\b(assignment|homework|task|project|essay|exam|quiz|lab|reading|report|presentation|meeting|appointment|chore|errand)\b/i;

/** Max user/assistant turns sent to the cloud model (plus system). */
export const MODEL_HISTORY_LIMIT = 12;

/** Soft cap for stored assistant transcript on the client. */
export const CLIENT_HISTORY_LIMIT = 20;

export function pruneContext(context: ConversationContext): ConversationContext {
  return {
    ...emptyContext(),
    ...context,
    lastTasks: (context.lastTasks ?? []).slice(0, 20),
    lastItems: (context.lastItems ?? []).slice(0, 40),
    undo: (context.undo ?? []).slice(0, 8),
    focus: context.focus ?? null,
    lastProject: context.lastProject ?? null,
    lastChecklist: context.lastChecklist ?? null,
    pending: context.pending ?? null,
    pendingClarification: context.pendingClarification ?? null,
    pendingInterpretation: context.pendingInterpretation ?? null,
    pendingRequest: context.pendingRequest ?? null,
    lastTurn: context.lastTurn ?? null,
    lastPlan: context.lastPlan
      ? {
          ...context.lastPlan,
          slots: (context.lastPlan.slots ?? []).slice(0, 24),
        }
      : null,
  };
}

/** Keep recent turns; always retain the latest user message. */
export function trimMessagesForModel(
  messages: HistoryMessage[],
  limit = MODEL_HISTORY_LIMIT
): HistoryMessage[] {
  if (messages.length <= limit) return messages;
  return messages.slice(-limit);
}

export function inferCategoryHint(title: string): string | null {
  const match = title.match(CATEGORY_WORDS);
  return match ? match[1].toLowerCase() : null;
}

export function recordCreateTurn(
  context: ConversationContext,
  title: string,
  dueDate: string | null
): void {
  context.lastTurn = {
    action: "create_task",
    title,
    dueDate,
    categoryHint: inferCategoryHint(title),
    replay: {
      tool: "create_task",
      templateArgs: { due_date: dueDate, priority: "medium" },
      label: `create similar to “${title}”`,
    },
  };
}

export function recordUpdateTurn(
  context: ConversationContext,
  label: string,
  templateArgs: Record<string, unknown>
): void {
  context.lastTurn = {
    action: "update_task",
    title: context.focus?.label,
    dueDate: typeof templateArgs.due_date === "string" ? templateArgs.due_date : null,
    categoryHint: context.focus?.label ? inferCategoryHint(context.focus.label) : null,
    replay: {
      tool: "update_task",
      templateArgs,
      label,
    },
  };
}

/** Strip continuation glue: "and …", "also …", "plus …". */
export function stripContinuationPrefix(text: string): string {
  return text
    .replace(/^(?:and|also|plus|then)\s+/i, "")
    .replace(/^(?:and|also)\s+(?:then\s+)?/i, "")
    .trim();
}

/**
 * Expand elliptical creates using the previous create turn.
 * "And English for Friday" after "science assignment for tomorrow"
 * → "add English assignment for Friday"
 */
export function expandEllipticalCreate(
  raw: string,
  context: ConversationContext
): string | null {
  const last = context.lastTurn;
  if (!last || last.action !== "create_task") return null;

  const trimmed = raw.replace(/[.!?…]+$/g, "").trim();
  // Never treat corrections / questions / deletes as elliptical creates.
  if (
    /^(?:actually|wait|sorry|no|nope|instead|i meant|what|which|who|why|when|where|how|delete|remove|undo|show|list|move|mark|complete|finish|change|update|make it|do the same)\b/i.test(
      trimmed
    ) ||
    /\binstead\b/i.test(trimmed) ||
    /\bi meant\b/i.test(trimmed)
  ) {
    return null;
  }

  const continuation = /^(?:and|also|plus)\b/i.test(trimmed);
  const bareLikeCreate =
    !/^(?:add|create|make|new|move|mark|delete|complete|finish|show|list|what|plan|undo|schedule|set|remove|change|update)\b/i.test(
      trimmed
    ) &&
    DATE_HINT.test(trimmed) &&
    // Require a title-ish fragment before the date ("English for Friday"), not bare "Friday".
    !new RegExp(`^(?:${DATE_HINT.source})$`, "i").test(stripContinuationPrefix(trimmed));

  if (!continuation && !bareLikeCreate) return null;
  if (!continuation && bareLikeCreate && /^(?:add|create)\b/i.test(trimmed)) return null;

  let body = stripContinuationPrefix(trimmed);
  // "do the same for English" handled elsewhere.
  if (/^do the same\b/i.test(body)) return null;

  const withDue = body.match(
    new RegExp(`^(.+?)\\s+(?:for|due|by|on|before)\\s+(${DATE_HINT.source})$`, "i")
  );
  const trailing = body.match(new RegExp(`^(.+?)\\s+(${DATE_HINT.source})$`, "i"));
  let titlePart = cleanPhrase(withDue?.[1] ?? trailing?.[1] ?? body);
  const when = withDue?.[2] ?? trailing?.[2] ?? null;
  if (!titlePart || titlePart.length < 2) return null;

  // If the fragment is only a subject word, attach prior category ("assignment").
  const category = last.categoryHint;
  if (category && !new RegExp(`\\b${category}\\b`, "i").test(titlePart)) {
    const priorSubject = (last.title ?? "")
      .replace(new RegExp(`\\b${category}\\b`, "i"), "")
      .trim();
    // Avoid duplicating full prior title; only add category noun.
    if (titlePart.split(/\s+/).length <= 3) {
      titlePart = `${titlePart} ${category}`;
    } else if (priorSubject && !titlePart.toLowerCase().includes(priorSubject.toLowerCase())) {
      titlePart = `${titlePart} ${category}`;
    }
  }

  titlePart = titleCase(cleanPhrase(titlePart));
  if (when) return `add ${titlePart} for ${when}`;
  if (last.dueDate) return `add ${titlePart} for ${last.dueDate}`;
  return `add ${titlePart}`;
}

/** "Actually Friday" / "Actually, next Monday" → correction phrase. */
export function expandBareCorrection(raw: string): string | null {
  const text = raw.replace(/[.!?…]+$/g, "").trim();

  // Already a canonical correction — leave for the matcher.
  if (/^(?:no|nope|wait|actually|sorry)[, ]+i meant\b/i.test(text) || /^i meant\b/i.test(text)) {
    return null;
  }

  const match = text.match(
    /^(?:actually|wait|sorry|no|nope)[, ]+(?:make it\s+|change it(?:\s+to)?\s+|it(?:'s| is)\s+|that(?:'s| is)\s+)?(.+)$/i
  );
  if (!match) return null;
  let rest = match[1].trim();
  // Strip a nested "i meant" if present.
  rest = rest.replace(/^i meant\s+/i, "").trim();
  if (!rest) return null;
  // Priority correction
  if (/^(?:more\s+)?(?:urgent|high priority|low priority|medium)$/i.test(rest)) {
    return `i meant ${rest}`;
  }
  if (
    DATE_HINT.test(rest) ||
    /^(?:today|tonight|tomorrow|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i.test(
      rest
    )
  ) {
    return `i meant ${rest}`;
  }
  // "actually homework" → rename
  return `i meant ${rest}`;
}

/** Detect answers to "which task?" style asks. */
export function looksLikeEntityAnswer(raw: string): boolean {
  const norm = normalizeCommand(raw);
  if (!norm || norm.length > 80) return false;
  if (
    /^(?:add|create|make|new|move|mark|delete|complete|finish|show|list|what|plan|undo|schedule|set|remove|change|update|yes|no|nope|cancel)\b/.test(
      norm
    )
  ) {
    return false;
  }
  // "the science assignment" / "science" / "the second one"
  return /^(?:the\s+)?(?:first|second|third|other|last)\b/.test(norm) ||
    /^(?:the\s+)?[\w][\w\s'-]{0,60}$/.test(norm);
}

export function otherDiscussedTaskId(context: ConversationContext): string | null {
  const focusId = context.focus?.kind === "task" ? context.focus.id : null;
  const others = (context.lastTasks ?? []).filter((item) => item.id !== focusId);
  if (others.length === 1) return others[0].id;
  if (others.length > 1) return others[0].id;
  return null;
}

/** Verify a task id still exists on the user's board before mutating. */
export function verifyTaskId(
  id: string | undefined | null,
  board: Board
): { ok: true; task: Board["tasks"][number] } | { ok: false; reason: string } {
  if (!id) return { ok: false, reason: "I don't know which task you mean." };
  const task = board.tasks.find((item) => item.id === id);
  if (!task) {
    return {
      ok: false,
      reason: "I couldn't verify that task on your list, so I left everything unchanged.",
    };
  }
  if (task.status === "cancelled") {
    return {
      ok: false,
      reason: "That task is no longer active, so I didn't change it.",
    };
  }
  return { ok: true, task };
}

export function shortenTitle(title: string): string {
  let t = title
    .replace(/^(?:please\s+)?(?:finish|complete|do|submit|write|prepare|review|revise)\s+/i, "")
    .replace(/\s+\((?:urgent|asap|todo)\)\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length <= 3) return titleCase(t);
  // Keep first 3 content words after stripping light articles.
  const kept = words.filter((w) => !/^(?:a|an|the|my|our)$/i.test(w)).slice(0, 3);
  return titleCase(kept.join(" ") || t);
}

export function pendingRequestSummary(pending: PendingRequest | null | undefined): string {
  if (!pending) return "none";
  const bits = [pending.kind, pending.when ? `when=${pending.when}` : null, pending.priority ? `priority=${pending.priority}` : null]
    .filter(Boolean)
    .join(", ");
  return `${bits} — ${pending.question}`;
}

export function lastTurnSummary(last: LastTurn | null | undefined): string {
  if (!last) return "none";
  return `${last.action}${last.title ? ` “${last.title}”` : ""}${last.dueDate ? ` due ${last.dueDate}` : ""}${last.categoryHint ? ` (${last.categoryHint})` : ""}`;
}
