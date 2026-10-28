/**
 * Speech-act / stance detection for LifePilot NLU.
 *
 * Separates *what the user is doing with language* from keyword matching:
 * questions, prohibitions, conditionals, lookups, and completion-oriented
 * obligations must not be blindly rewritten into "add …".
 *
 * This is a thin contextual gate — not a dictionary of English. Downstream
 * layers (intent rewrite, soft understand, phrasebook, optional LLM) still
 * do the heavy lifting.
 */

import { normalizeInput, normalizeForMatch } from "./normalize-input";

export type StanceKind =
  | "prohibit"
  | "query"
  | "lookup_past"
  | "conditional"
  | "suggestion"
  | "complete_focus"
  | "command"
  | "smalltalk"
  | "unknown";

export type Stance = {
  kind: StanceKind;
  /** Short reason for logs / model hints. */
  reason: string;
  /** Confidence that this stance should override create-biased rewrites. */
  confidence: number;
};

const COMPLETE_VERB =
  /\b(?:finish|finished|finishing|complete|completed|completing|done with|wrap(?:ped)? up|knock(?:ed)? out)\b/i;

const CREATE_VERB =
  /\b(?:add|create|put|schedule|remind|note|jot|save|log|track|include)\b/i;

const QUERY_CUE =
  /^(?:what|whats|what's|which|who|when|where|why|how|do i|does|did i|did we|have i|am i|is there|are there|any|anything|show|list|see|view|tell|give|pull up|bring up|check)\b/i;

/**
 * Detect high-level communicative stance before obligation→create rewrites.
 */
export function detectStance(raw: string): Stance {
  const normalized = normalizeInput(raw).replace(/[.!?…]+$/g, "").trim();
  if (!normalized) {
    return { kind: "unknown", reason: "empty", confidence: 0 };
  }
  const norm = normalizeForMatch(normalized);
  const hasQuestionMark = /\?/.test(raw);

  // Explicit prohibition of an action ("don't add…", "never put… on my list")
  if (
    /^(?:please\s+)?(?:do\s+not|don'?t|never|stop|avoid)\s+(?:please\s+)?(?:to\s+)?(?:add|create|put|include|schedule|save|log|make|set)\b/i.test(
      normalized
    ) ||
    /\b(?:do\s+not|don'?t|never)\s+(?:add|create|put|include)\b/i.test(normalized)
  ) {
    // Exception: "don't forget to …" is a create cue, not a prohibition.
    if (/\bdon'?t\s+forget\b/i.test(normalized) || /\bdo\s+not\s+forget\b/i.test(normalized)) {
      // fall through
    } else {
      return {
        kind: "prohibit",
        reason: "explicit negation of create/add",
        confidence: 0.95,
      };
    }
  }

  // "Make sure I don't forget …" remains a create (handled elsewhere).
  // Conditionals: do not invent a write from "if I finish X, move it…"
  if (
    /^(?:if|unless|when(?:ever)?|once|after)\b/i.test(normalized) &&
    /\b(?:then|move|reschedule|add|delete|mark|complete|finish)\b/i.test(normalized)
  ) {
    return {
      kind: "conditional",
      reason: "conditional / if-then request needs confirmation",
      confidence: 0.85,
    };
  }

  // Uncertain / tentative narration — not an instruction to save.
  // "I might do homework tomorrow" must NOT create a task.
  if (
    /^(?:i\s+)?(?:might|may|could|maybe|perhaps)\b/i.test(normalized) ||
    /^(?:i(?:'m| am)\s+)?(?:thinking about|considering|not sure(?:\s+if)?|debating)\b/i.test(
      normalized
    ) ||
    /^(?:maybe|perhaps)\s+i\s+(?:should|could|might|will|can)\b/i.test(normalized)
  ) {
    // Explicit save cues still win ("maybe add milk" / "I might as well add …")
    if (
      !/\b(?:add|create|put|remind|schedule|save|jot|note|remember|don't forget|do not forget)\b/i.test(
        normalized
      )
    ) {
      return {
        kind: "suggestion",
        reason: "tentative / uncertain narration without save request",
        confidence: 0.9,
      };
    }
  }

  // Past lookup: "Did I add milk?" / "Have I already put …"
  if (
    /^(?:did i|have i|did we|was there|is .+ on my (?:list|tasks?))\b/i.test(normalized) ||
    /\bdid i (?:already\s+)?(?:add|create|put|schedule)\b/i.test(normalized)
  ) {
    return {
      kind: "lookup_past",
      reason: "asking whether something already exists",
      confidence: 0.92,
    };
  }

  // Broken / informal schedule questions: "what task i have tomorrow"
  if (
    hasQuestionMark ||
    QUERY_CUE.test(norm) ||
    /^(?:what|whats|what's)\s+(?:task|tasks|work|stuff|things?)\b/i.test(normalized) ||
    /\b(?:what|whats|what's)\s+(?:do\s+)?i\s+(?:have|got|need|need to do)\b/i.test(normalized) ||
    /\btask(?:s)?\s+i\s+have\b/i.test(normalized) ||
    /\bi\s+hav(?:e)?\s+(?:alot|a lot|much|many)\b/i.test(normalized) ||
    /^(?:waht|wht|wat)\b/i.test(normalized)
  ) {
    // Imperative "show/list …" still query; "add what?" is rare — treat as query.
    if (!CREATE_VERB.test(normalized) || /\b(?:show|list|see|view|what|did|have)\b/i.test(normalized)) {
      return {
        kind: "query",
        reason: "information-seeking / schedule lookup",
        confidence: hasQuestionMark ? 0.9 : 0.8,
      };
    }
  }

  // Obligation + finish/complete → prefer complete over create
  // "I gotta finish homework" / "need to finish the essay"
  // Exception: "need to finish X by Friday" is deadline planning → create.
  if (
    COMPLETE_VERB.test(normalized) &&
    /(?:gotta|got to|need to|have to|must|should|wanna|want to|going to|gonna)\s+(?:to\s+)?(?:finish|complete|wrap)/i.test(
      normalized
    )
  ) {
    const deadlinePlanning =
      /\b(?:by|due|before|until|till)\s+/i.test(normalized) &&
      /(?:today|tonight|tomorrow|yesterday|this\s+\w+|next\s+\w+|(?:mon|tues|wednes|thurs|fri|satur|sun)day|\d{4}-\d{2}-\d{2})/i.test(
        normalized
      );
    if (!deadlinePlanning) {
      return {
        kind: "complete_focus",
        reason: "obligation phrased as finishing existing work",
        confidence: 0.88,
      };
    }
  }

  // Imperative finish/complete without create verbs
  if (
    /^(?:finish|complete|mark)\b/i.test(normalized) &&
    !CREATE_VERB.test(normalized)
  ) {
    return {
      kind: "complete_focus",
      reason: "imperative complete",
      confidence: 0.9,
    };
  }

  if (
    /^(?:hey|hi|hello|yo|thanks|thank you|thx|help|who are you|how are you)\b/i.test(
      normalized
    )
  ) {
    return { kind: "smalltalk", reason: "greeting/help", confidence: 0.7 };
  }

  if (
    /^(?:add|create|put|remind|schedule|move|delete|show|list|plan|undo|mark|set)\b/i.test(
      normalized
    ) ||
    /^(?:can you|could you|please|pls|plz)\b/i.test(normalized)
  ) {
    return { kind: "command", reason: "imperative / polite request", confidence: 0.75 };
  }

  return { kind: "unknown", reason: "no strong speech-act cue", confidence: 0.4 };
}

/**
 * True when create-biased rewrites must be suppressed.
 */
export function blocksCreateRewrite(stance: Stance): boolean {
  return (
    stance.kind === "prohibit" ||
    stance.kind === "query" ||
    stance.kind === "lookup_past" ||
    stance.kind === "conditional" ||
    stance.kind === "suggestion" ||
    (stance.kind === "complete_focus" && stance.confidence >= 0.8)
  );
}

/**
 * Extract the subject of "finish/complete X" from obligation phrasing.
 */
export function extractFinishSubject(raw: string): string | null {
  const text = normalizeInput(raw).replace(/[.!?…]+$/g, "").trim();
  const m = text.match(
    /(?:gotta|got to|need to|have to|must|should|wanna|want to|going to|gonna)\s+(?:to\s+)?(?:finish|complete|wrap(?:\s+up)?|knock(?:\s+out)?)\s+(.+)$/i
  );
  if (!m?.[1]) return null;
  return m[1]
    .replace(/\s+(?:today|tonight|tomorrow|this\s+\w+|next\s+\w+)$/i, "")
    .replace(/\s+/g, " ")
    .trim() || null;
}
