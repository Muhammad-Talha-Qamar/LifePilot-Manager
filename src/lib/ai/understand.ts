/**
 * Free-form understanding for everyday language.
 * Turns chatty, incomplete, or slangy input into a clear command,
 * a friendly reply, or a pass-through for the existing local agent.
 *
 * This is the offline/local path used when no cloud model is configured.
 * With OPENAI_API_KEY, the model agent handles open-ended understanding instead.
 */

import { rewriteIntent } from "./intent";

export type Understood =
  | { kind: "command"; text: string }
  | { kind: "reply"; message: string }
  | { kind: "pass" };

const GREETING =
  /^(?:hey|hi|hello|yo|hiya|howdy|good\s+(?:morning|afternoon|evening)|sup|what's up|whats up)(?:\s*[!?.]*)?$/i;

const THANKS =
  /^(?:thanks|thank you|thx|ty|appreciate it|cheers)(?:\s*[!?.]*)?$/i;

const HOW_ARE_YOU =
  /^(?:how are you(?: doing)?|how's it going|how r u|you good)(?:\s*[!?.]*)?$/i;

const HELP =
  /^(?:help(?: me)?|what can you do|what do you do|how (?:do|can) (?:i|you) (?:use|work)|capabilities|commands?)(?:\s*[!?.]*)?$/i;

const WHO =
  /^(?:who are you|what are you|your name)(?:\s*[!?.]*)?$/i;

function stripNoise(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function softCreate(text: string): string | null {
  // Imperative without "add/create": "buy milk tomorrow", already handled in rewriteBareTask.
  // Soft obligation / planning talk that still means "save a task".
  const soft = text.match(
    /^(?:i(?:'m| am)\s+)?(?:gonna|going to|planning to|trying to|hoping to|meant to)\s+(.+)$/i
  );
  if (soft) return `add ${soft[1]}`;

  const gotta = text.match(/^(?:gotta|lemme|let me)\s+(.+)$/i);
  if (gotta) return `add ${gotta[1]}`;

  // "can you remind me …" / "could you jot down …"
  const jot = text.match(
    /^(?:can you|could you|would you|will you)?\s*(?:please\s+)?(?:jot(?:\s+down)?|note(?:\s+down)?|write(?:\s+down)?|save|log)\s+(.+)$/i
  );
  if (jot) return `add ${jot[1]}`;

  // "keep track of …" / "track …"
  const track = text.match(/^(?:keep track of|track)\s+(.+)$/i);
  if (track) return `add ${track[1]}`;

  return null;
}

function softComplete(text: string): string | null {
  // "the essay is done" / "maths homework is finished"
  const isDone = text.match(
    /^(.+?)\s+(?:is|are)\s+(?:done|finished|complete|completed|over)(?:\s+now)?$/i
  );
  if (isDone && !/^(?:add|create|what|show|list|plan)\b/i.test(isDone[1])) {
    return `mark ${isDone[1]} complete`;
  }

  // "just finished X" / "just completed X"
  const just = text.match(/^just\s+(?:finished|completed|done(?:\s+with)?)\s+(.+)$/i);
  if (just) return `mark ${just[1]} complete`;

  // "X — done" / "X ✓"
  const trailing = text.match(/^(.+?)\s*(?:—|-|–)\s*(?:done|finished|complete)$/i);
  if (trailing) return `mark ${trailing[1]} complete`;

  return null;
}

function softQuery(text: string): string | null {
  // "what's left" / "what's pending" / "what do i still need to do"
  if (
    /^(?:what(?:'s| is|s)?\s+)?(?:left|pending|remaining|open|outstanding)(?:\s+(?:for\s+)?(?:today|tomorrow|this week))?/i.test(
      text
    ) ||
    /what do i still (?:need|have) to (?:do|finish)/i.test(text) ||
    /catch me up|bring me up to speed|status(?:\s+update)?|overview/i.test(text)
  ) {
    if (/\btomorrow\b/i.test(text)) return "show my tasks for tomorrow";
    if (/\bthis week\b/i.test(text)) return "show my tasks for this week";
    if (/\bnext week\b/i.test(text)) return "show my tasks for next week";
    return "show my tasks for today";
  }

  // "am i free tomorrow" / "do i have room today"
  if (/\b(?:am i free|do i have (?:room|time|space)|is (?:my day|today) clear)\b/i.test(text)) {
    if (/\btomorrow\b/i.test(text)) return "show my tasks for tomorrow";
    return "show my tasks for today";
  }

  // "give me a rundown of the week"
  if (/\b(?:rundown|recap|summary|brief(?:ing)?)\b/i.test(text)) {
    if (/\bweek\b/i.test(text)) return "how much work this week";
    return "show my tasks for today";
  }

  return null;
}

function softChecklist(text: string): string | null {
  // "shopping list: milk, eggs, bread"
  const labeled = text.match(
    /^(?:(?:make|create|start|new)\s+)?(?:a\s+)?(?:shopping|grocery|groceries|packing|todo)?\s*list\s*[:\-]\s*(.+)$/i
  );
  if (labeled) {
    const kind = text.match(/\b(shopping|grocery|groceries|packing)\b/i)?.[1] ?? "checklist";
    const title =
      /grocery|groceries|shopping/i.test(kind)
        ? "Groceries"
        : /packing/i.test(kind)
          ? "Packing"
          : "Checklist";
    return `create checklist for ${title} with ${labeled[1]}`;
  }

  // "make a list of X, Y, and Z" / "checklist: …"
  const makeList = text.match(
    /^(?:make|create|start)\s+(?:a\s+)?(?:new\s+)?(?:checklist|list)\s+(?:of|with|:)\s+(.+)$/i
  );
  if (makeList) return `create checklist for Checklist with ${makeList[1]}`;

  const bareList = text.match(/^checklist\s*[:\-]\s*(.+)$/i);
  if (bareList) return `create checklist for Checklist with ${bareList[1]}`;

  return null;
}

function softPlan(text: string): string | null {
  if (
    /^(?:help me )?(?:plan|organize|structure|schedule)\s+(?:my\s+)?(?:day|today|morning|afternoon)/i.test(
      text
    ) ||
    /what should i (?:do|focus on|work on|prioriti[sz]e)(?:\s+today)?/i.test(text) ||
    /what(?:'s| is) the best (?:use of|way to spend) (?:my )?time/i.test(text)
  ) {
    return "plan my day";
  }
  if (/plan\s+(?:out\s+)?(?:my\s+)?next month/i.test(text)) return "plan my next month";
  return null;
}

function conversationalReply(text: string): string | null {
  if (GREETING.test(text)) {
    return "Hey — I'm here. Tell me what you want to get done, check, or plan, in whatever words feel natural.";
  }
  if (HOW_ARE_YOU.test(text)) {
    return "Doing well, thanks. Want me to check today's list, add something, or plan your day?";
  }
  if (THANKS.test(text)) {
    return "Anytime. Say the word if you need another change.";
  }
  if (WHO.test(text)) {
    return "I'm LifePilot — your productivity teammate. I keep your tasks, checklists, and calendar in sync when you ask in plain language.";
  }
  if (HELP.test(text)) {
    return [
      "Talk to me like a friend who helps you stay organized. For example:",
      "• “Remind me to call mom tomorrow”",
      "• “Done with the essay”",
      "• “What's left today?”",
      "• “Make a groceries list with milk and eggs”",
      "• “Plan my day”",
      "Typos and incomplete sentences are fine — I'll figure out what you mean when I can.",
    ].join("\n");
  }
  return null;
}

/**
 * Understand everyday user text before the local command matcher runs.
 */
export function understandInput(raw: string): Understood {
  const text = stripNoise(raw);
  if (!text) return { kind: "pass" };

  const chat = conversationalReply(text);
  if (chat) return { kind: "reply", message: chat };

  // Soft transforms that go beyond rewriteIntent.
  const soft =
    softPlan(text) ||
    softChecklist(text) ||
    softQuery(text) ||
    softComplete(text) ||
    softCreate(text);

  const candidate = soft ?? text;
  const rewritten = rewriteIntent(candidate);

  if (rewritten !== text.trim() || soft) {
    return { kind: "command", text: rewritten };
  }

  // If rewriteIntent left it unchanged but it still looks actionable, pass through
  // so the local agent's own matchers (including bare-task fallback) can try.
  return { kind: "pass" };
}
