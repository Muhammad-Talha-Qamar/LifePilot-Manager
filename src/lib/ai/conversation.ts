/**
 * Conversational intent for LifePilot — greetings, thanks, casual remarks,
 * capability questions, and light explanations that should NOT become tasks.
 *
 * Used by the local NLU path and as a soft prior for the cloud agent.
 * Prefer understanding intended meaning over rigid templates.
 */

import { normalizeInput } from "./normalize-input";

export type ConversationalKind =
  | "greeting"
  | "thanks"
  | "how_are_you"
  | "who"
  | "help"
  | "ack"
  | "casual"
  | "explain"
  | "meta"
  | "encourage";

export type ConversationalMatch = {
  kind: ConversationalKind;
  /** Natural reply for the offline/local path. Cloud model uses this as a hint only. */
  message: string;
};

const GREETING =
  /^(?:hey|hi|hello|yo|hiya|howdy|hola|salam|salaam|assalamu? ?alaikum|good\s+(?:morning|afternoon|evening)|sup|what(?:'s| is|s) up|heya|morning|evening)(?:\s+[a-z]+)?(?:\s*[!?.]*)?$/i;

const THANKS =
  /^(?:thanks|thank you|thx|ty|appreciate it|cheers|shukriya|shukria|merci|gracias|thanks a lot|thank you so much|thx a ton)(?:\s+(?:so much|a lot|again))?(?:\s*[!?.]*)?$/i;

const HOW_ARE_YOU =
  /^(?:how are you(?: doing)?|how(?:'s| is|s) it going|how r u|you good|you okay|you alright|kya haal hai|whats up with you)(?:\s*[!?.]*)?$/i;

const WHO =
  /^(?:who are you|what are you|your name|introduce yourself|are you (?:an )?ai|are you (?:a )?bot|what(?:'s| is) lifepilot)(?:\s*[!?.]*)?$/i;

const HELP =
  /^(?:help(?: me)?|what can you do|what do you do|how (?:do|can) (?:i|you) (?:use|work)(?:\s+(?:this|you|lifepilot))?|capabilities|commands?|examples?|how does (?:this|lifepilot) work)(?:\s*[!?.]*)?$/i;

/**
 * Short acknowledgements that are not yes/confirm answers.
 * Avoid ok/sure/yeah/yep — those often continue a pending ask.
 */
const ACK =
  /^(?:cool|nice|great|awesome|perfect|got it|makes sense|sounds good|fair|true|exactly|understood|noted|bet|solid|lovely|wonderful|interesting)(?:\s*[!?.]*)?$/i;

/** Light casual remarks that should not become tasks. */
const CASUAL =
  /^(?:lol|haha|hahaha|lmao|hehe|hmm+|huh|wow|oh+|ah+|ugh|meh|same|fair enough|that(?:'s| is) (?:fair|true|rough|tough|a lot)|i(?:'m| am) (?:tired|busy|stressed|overwhelmed|good|fine|okay)|long day|rough day|busy week)(?:\s*[!?.]*)?$/i;

/** Encouragement / venting that should get empathy, not a forced plan. */
const ENCOURAGE =
  /^(?:i(?:'m| am) so (?:behind|overwhelmed|stressed)|this (?:is|feels) (?:a lot|overwhelming|impossible)|i hate (?:mondays?|deadlines?)|wish me luck)(?:\s*[!?.]*)?$/i;

/** Meta questions about the assistant / conversation, not the task board. */
const META =
  /^(?:can you (?:hear|see|understand) me|are you (?:there|listening|working)|do you understand(?: me)?|you (?:there|get (?:it|me))|is (?:anyone|somebody) there)(?:\s*[!?.]*)?$/i;

/**
 * Conceptual / how-it-works questions within LifePilot's domain.
 * Personal schedule questions ("what should I work on first") stay out —
 * those belong to planning / query tools.
 */
const EXPLAIN =
  /^(?:how (?:do|does|should|can) (?:i |you )?(?:priorit(?:y|ize)|plan(?:ning)?|break(?:ing)? (?:\w+ )?down|use (?:projects?|checklists?|tasks?|reminders?))|what(?:'s| is) (?:the )?(?:difference between|best way to)|explain (?:how |what )?(?:priorit|plan|project|checklist|task)|how (?:do )?projects? (?:work|differ)|when (?:should|do) i use (?:a )?(?:project|checklist|task)|what (?:are|is) (?:a )?(?:project|checklist|task)s?\b)/i;

function helpMessage(): string {
  return [
    "I can help you stay organized in plain language. For example:",
    "• “Remind me to call mom tomorrow”",
    "• “Done with the essay”",
    "• “What's left today?”",
    "• “Make a groceries list with milk and eggs”",
    "• “Plan my day” or “What should I work on first?”",
    "• “Move maths homework to Friday”",
    "Typos, short messages, and imperfect English are fine — I'll use what I can from context.",
  ].join("\n");
}

function explainMessage(text: string): string {
  const lower = text.toLowerCase();
  if (/project/.test(lower) && /checklist|task/.test(lower)) {
    return "Projects group related work under one effort. Tasks are individual to-dos (often with deadlines). Checklists are item lists like groceries or packing — useful when many small items belong together. Want help setting one up?";
  }
  if (/project/.test(lower)) {
    return "A project is a named container for related tasks — useful when several pieces of work belong to one goal. Individual deadlines still live on the tasks. Want me to create a project or show the ones you already have?";
  }
  if (/checklist/.test(lower)) {
    return "Checklists are for multi-item lists (shopping, packing, errands). You can add or check off items as you go. Want me to make one?";
  }
  if (/priorit/.test(lower)) {
    return "When prioritizing, I look at deadlines, the priority you set, and related project work — not earliest deadline alone. Ask “what should I work on first?” and I'll check your real list.";
  }
  if (/plan|break/.test(lower)) {
    return "I can suggest a day or week order from your saved tasks and calendar, or break a large piece of work into smaller steps. Those suggestions stay optional until you ask me to save them.";
  }
  if (/remind|task/.test(lower)) {
    return "Say what you need remembered in everyday words — including a day if you have one — and I'll save it. You can also mark things done, move dates, or ask what's left.";
  }
  return "Happy to explain. I help with tasks, checklists, projects, calendar items, and planning — grounded in what you've actually saved. What would you like clarified?";
}

/**
 * Detect conversational / non-mutating intents from everyday language.
 * Returns null when the utterance looks like a productivity action instead.
 */
export function matchConversation(raw: string): ConversationalMatch | null {
  const text = normalizeInput(raw).replace(/[.!?…]+$/g, "").trim();
  if (!text) return null;

  // Productivity cues win over soft casual matches.
  if (
    /\b(?:remind|add|create|delete|complete|finish|schedule|reschedule|move|show|list|plan my|what's left|whats left|overdue|checklist|todo:|task:)\b/i.test(
      text
    ) &&
    !HELP.test(text) &&
    !WHO.test(text) &&
    !EXPLAIN.test(text)
  ) {
    return null;
  }

  if (GREETING.test(text)) {
    return {
      kind: "greeting",
      message: "Hi — I'm here. What would you like to work on, check, or talk through?",
    };
  }
  if (HOW_ARE_YOU.test(text)) {
    return {
      kind: "how_are_you",
      message: "Doing well, thanks for asking. How's your day going — want a quick look at what's on your list?",
    };
  }
  if (THANKS.test(text)) {
    return {
      kind: "thanks",
      message: "You're welcome. I'm here whenever you need the next thing.",
    };
  }
  if (WHO.test(text)) {
    return {
      kind: "who",
      message:
        "I'm LifePilot — a productivity assistant. I help organize tasks, checklists, projects, and plans in everyday language, and I change your saved records only when you ask.",
    };
  }
  if (HELP.test(text)) {
    return { kind: "help", message: helpMessage() };
  }
  if (META.test(text)) {
    return {
      kind: "meta",
      message: "Yes — I'm here and following along. Tell me what you need in your own words.",
    };
  }
  if (ACK.test(text)) {
    return {
      kind: "ack",
      message: "Sounds good. What next?",
    };
  }
  if (CASUAL.test(text)) {
    return {
      kind: "casual",
      message: "Got it. If you want help sorting the load or picking what to do next, just say so.",
    };
  }
  if (ENCOURAGE.test(text)) {
    return {
      kind: "encourage",
      message:
        "That sounds like a lot. We can take it one step at a time — want me to check what's due soon, or help pick a starting point?",
    };
  }
  if (EXPLAIN.test(text)) {
    return { kind: "explain", message: explainMessage(text) };
  }

  return null;
}

/** True when the utterance is conversational and should not force task tooling. */
export function isConversationalUtterance(raw: string): boolean {
  return matchConversation(raw) != null;
}

/**
 * Soft prior line for the cloud model when local NLU classifies small talk.
 */
export function conversationHint(raw: string): string | null {
  const match = matchConversation(raw);
  if (!match) return null;
  return `Local NLU: conversational (${match.kind}) — reply naturally; do not create or change records unless the user clearly asks. Adapt length to the message; no generic motivational filler.`;
}
