/**
 * Google-like interpretation layer for LifePilot.
 *
 * Produces a user-facing "I think you mean…" sentence when spelling / grammar
 * meaningfully differs from the original, and flags ambiguous homophones so
 * the agent asks instead of guessing.
 *
 * Spelling repair uses the model-friendly local NLU stack (normalize + soft
 * understanding). This module decides what to *show* and when to *clarify*,
 * without inventing actions.
 */

import { correctSpellingAndGrammar } from "./spell";
import { normalizeInput } from "./normalize-input";
import type { AssistantBlock } from "./types";

export type InterpretationDecision = {
  /** Original user text (trimmed). */
  original: string;
  /**
   * Natural-language intended sentence for display
   * (spelling/grammar fixed, phrasing preserved).
   */
  interpreted: string;
  /** True when the UI should show an "I think you mean" chip. */
  showInterpretation: boolean;
  /**
   * Clarifying question when meaning is ambiguous — caller must not
   * execute a write until the user confirms.
   */
  clarification: string | null;
  /** 0–1 confidence that `interpreted` matches user intent. */
  confidence: number;
};

type AmbiguityRule = {
  pattern: RegExp;
  question: string;
  /** Suggested replacement shown in the question. */
  suggestion: string;
};

const AMBIGUITY_RULES: AmbiguityRule[] = [
  {
    // "next weak" / "nex weak" — real English "weak" must not silently become "week"
    pattern: /\bnex(?:t)?\s+weak\b/i,
    question: "Did you mean next week?",
    suggestion: "next week",
  },
  {
    pattern: /\bthis\s+weak\b/i,
    question: "Did you mean this week?",
    suggestion: "this week",
  },
  {
    pattern: /\blast\s+weak\b/i,
    question: "Did you mean last week?",
    suggestion: "last week",
  },
  {
    pattern: /\b(?:for|by|on|until|till)\s+weak\b/i,
    question: "Did you mean week?",
    suggestion: "week",
  },
];

/**
 * Context-aware phrase repairs that fuzzy spelling alone cannot do
 * (real English words used in the wrong sense).
 */
function applyContextualRepairs(text: string): string {
  return (
    text
      // "remind me to by milk" / "need to by groceries"
      .replace(/\bto\s+by\b/gi, "to buy")
      .replace(/\b(go|going)\s+by\s+(milk|eggs|bread|groceries|food)\b/gi, "$1 buy $2")
      // "add by milk" after remind rewrite edge cases
      .replace(/\b(add|create)\s+by\s+/gi, "$1 buy ")
      // Common misspellings not always caught by fuzzy (protected / short)
      .replace(/\bupcomming\b/gi, "upcoming")
      .replace(/\bupcomiing\b/gi, "upcoming")
      .replace(/\bupcomin\b/gi, "upcoming")
      .replace(/\bhomwork\b/gi, "homework")
      .replace(/\bhomewrk\b/gi, "homework")
      .replace(/\breshedule\b/gi, "reschedule")
      .replace(/\brescedule\b/gi, "reschedule")
      .replace(/\bmeting\b/gi, "meeting")
      .replace(/\bmeetin\b/gi, "meeting")
      .replace(/\btomorow\b/gi, "tomorrow")
      // Plural soft fix for "upcoming task" when clearly a list query
      .replace(
        /\b(show|list|see|view|display)\s+(?:me\s+|my\s+)?upcoming\s+task\b/gi,
        "$1 my upcoming tasks"
      )
      .replace(/\s+/g, " ")
      .trim()
  );
}

function polishSentence(text: string): string {
  let out = text.replace(/\s+/g, " ").trim();
  if (!out) return out;
  // Capitalize first letter; keep rest as corrected.
  out = out.charAt(0).toUpperCase() + out.slice(1);
  // Light trailing period for display (Google-like single sentence).
  if (!/[.!?]$/.test(out) && out.split(/\s+/).length >= 3) {
    out = `${out}.`;
  }
  return out;
}

function compareKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.!?…,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Build the natural intended sentence without collapsing to canonical commands.
 * ("Remind me to buy milk" stays that shape — not "add buy milk".)
 */
export function surfaceCorrect(raw: string): string {
  let text = raw.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!text) return text;
  text = applyContextualRepairs(text);
  text = correctSpellingAndGrammar(text);
  text = applyContextualRepairs(text);
  return polishSentence(text);
}

function findAmbiguity(raw: string): AmbiguityRule | null {
  for (const rule of AMBIGUITY_RULES) {
    if (rule.pattern.test(raw)) return rule;
  }
  return null;
}

/**
 * Decide whether to show an interpretation, ask for clarification, or stay quiet.
 */
export function resolveInterpretation(raw: string): InterpretationDecision {
  const original = raw.replace(/\s+/g, " ").trim();
  if (!original) {
    return {
      original: "",
      interpreted: "",
      showInterpretation: false,
      clarification: null,
      confidence: 1,
    };
  }

  // Surface-correct first so "nex weak" / "assigment" become visible to ambiguity rules.
  const interpreted = surfaceCorrect(original);

  // Check both the raw text and the repaired text — typos often hide the homophone.
  const ambiguity =
    findAmbiguity(original) ||
    findAmbiguity(interpreted) ||
    findAmbiguity(interpreted.replace(/\.$/, ""));
  if (ambiguity) {
    // Prefer substituting on the spelling-corrected sentence so other typos
    // (assigment→assignment, nex→next) stay fixed in the accepted follow-up.
    let accepted: string;
    if (ambiguity.pattern.test(interpreted)) {
      accepted = interpreted.replace(ambiguity.pattern, ambiguity.suggestion);
    } else {
      accepted = surfaceCorrect(
        original.replace(ambiguity.pattern, ambiguity.suggestion)
      );
    }
    return {
      original,
      interpreted: polishSentence(accepted),
      showInterpretation: false,
      clarification: ambiguity.question,
      confidence: 0.45,
    };
  }

  const same = compareKey(original) === compareKey(interpreted);

  // Also consider normalizeInput (slang / multilingual) for display when
  // surface spelling alone looks identical but meaning was repaired.
  const normalized = polishSentence(normalizeInput(original));
  const meaningChanged =
    !same ||
    (compareKey(original) !== compareKey(normalized) &&
      // Only surface normalize diffs that look like spelling, not full rewrites
      // to canonical commands (add/mark/show…).
      !/^(?:add|mark|move|delete|show my tasks|create checklist)\b/i.test(
        compareKey(normalized)
      ) &&
      levenshteinRatio(compareKey(original), compareKey(normalized)) >= 0.55);

  const display = !same
    ? interpreted
    : meaningChanged
      ? normalized
      : interpreted;

  const showInterpretation =
    compareKey(original) !== compareKey(display) &&
    // Avoid flashing for tiny casing / trailing-punct only differences
    stripSurfaceNoise(original) !== stripSurfaceNoise(display);

  return {
    original,
    interpreted: display,
    showInterpretation,
    clarification: null,
    confidence: showInterpretation ? 0.86 : 0.98,
  };
}

function stripSurfaceNoise(text: string): string {
  return compareKey(text).replace(/['']/g, "");
}

function levenshteinRatio(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const m = a.length;
  const n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  const dist = dp[n];
  return 1 - dist / Math.max(m, n);
}

/** Block helper for assistant replies. */
export function interpretationBlock(
  decision: InterpretationDecision
): Extract<AssistantBlock, { type: "interpretation" }> | null {
  if (decision.clarification) {
    return {
      type: "interpretation",
      label: "Did you mean",
      text: decision.interpreted.replace(/\.$/, ""),
      uncertain: true,
    };
  }
  if (!decision.showInterpretation) return null;
  return {
    type: "interpretation",
    label: "I think you mean",
    text: decision.interpreted.replace(/\.$/, ""),
    uncertain: false,
  };
}
