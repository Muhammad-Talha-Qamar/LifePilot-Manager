/**
 * Free-form understanding for everyday language.
 * Turns chatty, incomplete, or slangy input into a clear command,
 * a friendly reply, or a pass-through for the existing local agent.
 *
 * This is the offline/local path used when no cloud model is configured.
 * With OPENAI_API_KEY, the model agent still receives a local paraphrase hint.
 */

import { matchConversation } from "./conversation";
import { interpretUtterance } from "./interpret";
import { rewriteIntent } from "./intent";
import { normalizeInput } from "./normalize-input";
import {
  detectPlanningCommand,
  planningCommandToText,
} from "./planning";
import {
  blocksCreateRewrite,
  detectStance,
  extractFinishSubject,
} from "./stance";

export type Understood =
  | { kind: "command"; text: string }
  | { kind: "reply"; message: string }
  | { kind: "pass" };

function softCreate(text: string): string | null {
  // Soft obligation / planning talk that still means "save a task".
  const soft = text.match(
    /^(?:i(?:'m| am)\s+)?(?:gonna|going to|planning to|trying to|hoping to|meant to|about to|supposed to)\s+(.+)$/i
  );
  if (soft) return `add ${soft[1]}`;

  const gotta = text.match(/^(?:gotta|lemme|let me|let us)\s+(.+)$/i);
  if (gotta) return `add ${gotta[1]}`;

  // "can you remind me …" / "could you jot down …" / "pencil in …"
  const jot = text.match(
    /^(?:can you|could you|would you|will you|i(?:'d| would) appreciate(?: it)? if you could)?\s*(?:please\s+)?(?:jot(?:\s+down)?|pencil(?:\s+in)?|note(?:\s+down)?|write(?:\s+down)?|save|log|capture|park)\s+(.+)$/i
  );
  if (jot) return `add ${jot[1]}`;

  // Slang: "dump/chuck/slap X on my plate/backlog"
  const slangDump = text.match(
    /^(?:yo[,!]?\s+)?(?:dump|chuck|slap|throw)\s+(.+?)\s+(?:on|onto|to)\s+(?:my\s+)?(?:plate|backlog|list|todo|tasks?)(?:\s+for\s+(.+))?$/i
  );
  if (slangDump) {
    const title = slangDump[1].replace(/^['"]|['"]$/g, "").trim();
    return slangDump[2] ? `add ${title} for ${slangDump[2]}` : `add ${title}`;
  }

  // "book the dentist" / "book a haircut friday"
  const book = text.match(/^(?:book|block)\s+(?:time\s+)?(?:for\s+|a\s+|an\s+|the\s+)?(.+)$/i);
  if (book && !/^(?:day|week|month)\b/i.test(book[1])) {
    return `add ${book[1]}`;
  }

  // "keep track of …" / "track …"
  const track = text.match(/^(?:keep track of|track|remember that)\s+(.+)$/i);
  if (track) return `add ${track[1]}`;

  // "I should probably …"
  const probably = text.match(
    /^(?:i\s+)?(?:should|need to|have to|gotta)\s+probably\s+(.+)$/i
  );
  if (probably) return `add ${probably[1]}`;

  // "make sure I don't forget / remember to …" / "make sure I …"
  const makeSure = text.match(
    /^(?:make sure(?: that)? i|ensure i)\s+(?:(?:don'?t\s+forget|do not forget|remember)(?:\s+to)?\s+)?(.+)$/i
  );
  if (makeSure && !/\bdon'?t\s+add\b/i.test(makeSure[1])) {
    return `add ${makeSure[1]}`;
  }

  // "don't let me forget …"
  const dontForget = text.match(
    /^(?:don'?t let me forget(?: to)?|never let me forget(?: to)?)\s+(.+)$/i
  );
  if (dontForget) return `add ${dontForget[1]}`;

  // "put this down for tomorrow" / "put X down"
  const putDown = text.match(
    /^(?:can you|could you|would you|will you)?\s*(?:please\s+)?(?:put|write|note)\s+(.+?)\s+down(?:\s+(?:for|on)\s+(.+))?$/i
  );
  if (putDown) {
    return putDown[2] ? `add ${putDown[1]} for ${putDown[2]}` : `add ${putDown[1]}`;
  }

  // "include X in my schedule/workload"
  const include = text.match(
    /^(?:include|add)\s+(.+?)\s+(?:in|on|to)\s+(?:my\s+)?(?:schedule|workload|agenda|list|tasks?)(?:\s+for\s+(.+))?$/i
  );
  if (include) {
    return include[2] ? `add ${include[1]} for ${include[2]}` : `add ${include[1]}`;
  }

  return null;
}

function softComplete(text: string): string | null {
  // "the essay is done" / "maths homework is finished"
  const isDone = text.match(
    /^(.+?)\s+(?:is|are)\s+(?:done|finished|complete|completed|over|sorted)(?:\s+now)?$/i
  );
  if (isDone && !/^(?:add|create|what|show|list|plan|how|who|where)\b/i.test(isDone[1])) {
    return `mark ${isDone[1]} complete`;
  }

  // "just finished X" / "just completed X"
  const just = text.match(
    /^just\s+(?:finished|completed|done(?:\s+with)?|wrapped(?:\s+up)?)\s+(.+)$/i
  );
  if (just) return `mark ${just[1]} complete`;

  // "X — done" / "X ✓"
  const trailing = text.match(/^(.+?)\s*(?:—|-|–|:)\s*(?:done|finished|complete)$/i);
  if (trailing) return `mark ${trailing[1]} complete`;

  // "finally done with X"
  const finallyDone = text.match(/^finally\s+(?:done with|finished)\s+(.+)$/i);
  if (finallyDone) return `mark ${finallyDone[1]} complete`;

  // "crossed X off"
  const crossed = text.match(/^crossed\s+(.+?)\s+off$/i);
  if (crossed) return `mark ${crossed[1]} complete`;

  return null;
}

function softQuery(text: string): string | null {
  // Strip casual hedges before matching ("idk what's on my plate")
  const q = text.replace(/^(?:idk|ngl|tbh|imo|fyi|uh+|um+)\s+/i, "").trim();

  // "what's left" / "what's pending" / "what do i still need to do"
  if (
    /^(?:what(?:'s| is|s)?\s+)?(?:left|pending|remaining|open|outstanding)(?:\s+(?:for\s+)?(?:today|tomorrow|this week))?/i.test(
      q
    ) ||
    /what do i still (?:need|have) to (?:do|finish)/i.test(q) ||
    /catch me up|bring me up to speed|status(?:\s+update)?|overview|sitrep/i.test(q) ||
    /what(?:'s| is|s)? on my (?:plate|agenda|schedule)/i.test(q) ||
    /^(?:what(?:'s| is|s)?\s+)?(?:left\s+)?on my plate\b/i.test(q) ||
    /fill me in|update me|where do i stand/i.test(q)
  ) {
    if (/\btomorrow\b/i.test(q)) return "show my tasks for tomorrow";
    if (/\bthis week\b/i.test(q)) return "show my tasks for this week";
    if (/\bnext week\b/i.test(q)) return "show my tasks for next week";
    if (/\bthis month\b/i.test(q)) return "show my tasks for this month";
    if (/\bnext month\b/i.test(q)) return "show my tasks for next month";
    if (/\boverdue\b/i.test(q)) return "show my overdue tasks";
    return "show my tasks for today";
  }

  // "am i free tomorrow" / "do i have room today"
  if (
    /\b(?:am i free|do i have (?:room|time|space)|is (?:my day|today) clear|anything blocking)\b/i.test(
      text
    )
  ) {
    if (/\btomorrow\b/i.test(text)) return "show my tasks for tomorrow";
    if (/\bthis week\b/i.test(text)) return "show my tasks for this week";
    return "show my tasks for today";
  }

  // "give me a rundown of the week"
  if (/\b(?:rundown|recap|summary|brief(?:ing)?|digest)\b/i.test(text)) {
    if (/\bweek\b/i.test(text)) return "how much work this week";
    if (/\bmonth\b/i.test(text)) return "show my tasks for this month";
    return "show my tasks for today";
  }

  // "any overdue stuff"
  if (/\b(?:any |show )?(?:overdue|late|past due)\b/i.test(text)) {
    return "show my overdue tasks";
  }

  // "show my upcoming task(s)"
  if (
    /\b(?:show|list|see|view|display)\s+(?:me\s+|my\s+)?upcoming\s+tasks?\b/i.test(text) ||
    /\bmy\s+upcoming\s+tasks?\b/i.test(text)
  ) {
    return "show my tasks for next 7 days";
  }

  return null;
}

function softChecklist(text: string): string | null {
  // "shopping list: milk, eggs, bread"
  const labeled = text.match(
    /^(?:(?:make|create|start|new|build)\s+)?(?:a\s+)?(?:shopping|grocery|groceries|packing|todo|errands?)?\s*list\s*[:\-]\s*(.+)$/i
  );
  if (labeled) {
    const kind = text.match(/\b(shopping|grocery|groceries|packing|errands?)\b/i)?.[1] ?? "checklist";
    const title =
      /grocery|groceries|shopping/i.test(kind)
        ? "Groceries"
        : /packing/i.test(kind)
          ? "Packing"
          : /errand/i.test(kind)
            ? "Errands"
            : "Checklist";
    return `create checklist for ${title} with ${labeled[1]}`;
  }

  // "make a list of X, Y, and Z" / "checklist: …"
  const makeList = text.match(
    /^(?:make|create|start|build)\s+(?:a\s+)?(?:new\s+)?(?:checklist|list)\s+(?:of|with|:)\s+(.+)$/i
  );
  if (makeList) return `create checklist for Checklist with ${makeList[1]}`;

  const bareList = text.match(/^checklist\s*[:\-]\s*(.+)$/i);
  if (bareList) return `create checklist for Checklist with ${bareList[1]}`;

  // "groceries: milk eggs"
  const groceries = text.match(/^(?:groceries|shopping|packing)\s*[:\-]\s*(.+)$/i);
  if (groceries) {
    const title = /packing/i.test(text) ? "Packing" : "Groceries";
    return `create checklist for ${title} with ${groceries[1]}`;
  }

  // "add milk and eggs to my groceries"
  const addToNamed = text.match(
    /^(?:add|put)\s+(.+?)\s+to\s+(?:my\s+|the\s+)?(groceries|shopping|packing|checklist)(?:\s+list)?$/i
  );
  if (addToNamed) {
    const listName =
      /grocery|shopping/i.test(addToNamed[2])
        ? "groceries"
        : /packing/i.test(addToNamed[2])
          ? "packing"
          : "checklist";
    return `add ${addToNamed[1]} to my ${listName} checklist`;
  }

  return null;
}

function softPlan(text: string): string | null {
  const cmd = detectPlanningCommand(text);
  if (cmd) return planningCommandToText(cmd);
  return null;
}

function softReschedule(text: string): string | null {
  const push = text.match(
    /^(?:can we |could we |please )?(?:push|bump|slide)\s+(.+?)\s+(?:to|until|till)\s+(.+)$/i
  );
  if (push) return `move ${push[1]} to ${push[2]}`;

  const changeDate = text.match(
    /^(?:change|update|set)\s+(?:the\s+)?(?:date|deadline|due date)\s+(?:of\s+|for\s+)?(.+?)\s+to\s+(.+)$/i
  );
  if (changeDate) return `move ${changeDate[1]} to ${changeDate[2]}`;

  const makeIt = text.match(
    /^(?:make it|change it(?:\s+to)?|set it(?:\s+to)?)\s+(.+)$/i
  );
  if (makeIt) return `move it to ${makeIt[1]}`;

  const instead = text.match(
    /^(today|tonight|tomorrow|yesterday|this\s+\w+|next\s+\w+|(?:mon|tues|wednes|thurs|fri|satur|sun)day)\s+instead$/i
  );
  if (instead) return `move it to ${instead[1]}`;

  return null;
}

function softEvent(text: string): string | null {
  const meeting = text.match(
    /^(?:i have |there's |there is )?(?:a\s+)?(meeting|appointment|exam)\s+(?:with\s+)?(.+?)(?:\s+(?:on|for|at)\s+(.+))?$/i
  );
  if (meeting && !/^(?:add|create|schedule|make)\b/i.test(text)) {
    const when = meeting[3] ? ` on ${meeting[3]}` : "";
    return `schedule ${meeting[1]} ${meeting[2]}${when}`;
  }
  return null;
}

/**
 * Understand everyday user text before the local command matcher runs.
 */
export function understandInput(raw: string): Understood {
  const text = normalizeInput(raw).replace(/[.!?…]+$/g, "").trim();
  if (!text) return { kind: "pass" };

  const chat = matchConversation(raw);
  if (chat) return { kind: "reply", message: chat.message };

  const stance = detectStance(raw);

  if (stance.kind === "prohibit") {
    return {
      kind: "reply",
      message:
        "Understood — I won't add that. If you meant a different change, tell me in your own words.",
    };
  }

  if (stance.kind === "conditional") {
    return {
      kind: "reply",
      message:
        "That sounds like an if/then plan. Which part should I do right now?",
    };
  }

  if (stance.kind === "suggestion") {
    const advice =
      /^(?:should i|shall i|do you think i should|would it|is it (?:a )?good idea)/i.test(
        text
      );
    return {
      kind: "reply",
      message: advice
        ? "I can share what is already on your list, but I will not add or change anything from an advice question. Tell me explicitly if you want a task saved."
        : "Sounds like you're still deciding. Want me to save that as a task, or leave it for now?",
    };
  }

  if (stance.kind === "smalltalk") {
    const again = matchConversation(raw);
    if (again) return { kind: "reply", message: again.message };
  }

  if (stance.kind === "complete_focus") {
    const subject = extractFinishSubject(text);
    if (subject) {
      return { kind: "command", text: `mark ${subject} complete` };
    }
  }

  if (stance.kind === "lookup_past") {
    const rewrittenLookup = rewriteIntent(text);
    return { kind: "command", text: rewrittenLookup };
  }

  // Soft transforms that go beyond rewriteIntent.
  // Skip softCreate when stance says this is not a create request.
  const soft =
    softPlan(text) ||
    softChecklist(text) ||
    softQuery(text) ||
    softComplete(text) ||
    softReschedule(text) ||
    softEvent(text) ||
    (blocksCreateRewrite(stance) ? null : softCreate(text));

  const candidate = soft ?? text;
  const rewritten = rewriteIntent(candidate);
  const rewrittenNorm = rewritten.trim().toLowerCase();
  const textNorm = text.trim().toLowerCase();

  // Internal markers from rewriteIntent → friendly handling
  if (/^__prohibit__/i.test(rewrittenNorm)) {
    return {
      kind: "reply",
      message:
        "Understood — I won't add that. If you meant a different change, tell me in your own words.",
    };
  }
  if (/^__clarify_conditional__/i.test(rewrittenNorm)) {
    return {
      kind: "reply",
      message:
        "That sounds like an if/then plan. Which part should I do right now?",
    };
  }
  if (/^__clarify_suggestion__/i.test(rewrittenNorm)) {
    return {
      kind: "reply",
      message:
        "Sounds like you're still deciding. Want me to save that as a task, or leave it for now?",
    };
  }

  if (rewrittenNorm !== textNorm || soft) {
    return { kind: "command", text: rewritten };
  }

  // Already a clear local command or explicit correction — let the matcher handle it.
  if (
    /^(?:add|create|make|new|move|mark|delete|complete|finish|show|list|plan|undo|schedule|set|remove)\b/i.test(
      textNorm
    ) ||
    /^(?:no|nope|wait|actually|sorry)\b.+\b(?:i meant|make it|change it)\b/i.test(textNorm) ||
    /^i meant\b/i.test(textNorm)
  ) {
    return { kind: "pass" };
  }

  // Phrasebook similarity + slot extraction when regex soft/rewrite miss.
  // Never let phrasebook create against a blocking stance.
  const interpreted = interpretUtterance(raw);
  if (
    interpreted.canonical &&
    interpreted.confidence >= 0.22 &&
    !/^move no\b/i.test(interpreted.canonical) &&
    !(blocksCreateRewrite(stance) && /^add\b/i.test(interpreted.canonical))
  ) {
    return { kind: "command", text: interpreted.canonical };
  }

  // If rewriteIntent left it unchanged but it still looks actionable, pass through
  // so the local agent's own matchers (including bare-task fallback) can try.
  return { kind: "pass" };
}
