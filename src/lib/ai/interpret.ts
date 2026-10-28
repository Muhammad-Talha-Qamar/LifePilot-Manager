/**
 * Intent-family classifier + slot extraction for local NLU.
 *
 * Instead of growing endless phrase lists, score the utterance against
 * phrasebook examples (token overlap) and extract loose slots (title, when,
 * subject, pronoun). Local regex rewrites remain a fast path; this layer
 * recovers when rewrite/understand leave the text unmatched or misrouted.
 */

import { FEW_SHOT_EXAMPLES, type IntentKind } from "./phrasebook";
import { normalizeInput, normalizeForMatch } from "./normalize-input";

const STOP = new Set([
  "a",
  "an",
  "the",
  "my",
  "me",
  "i",
  "to",
  "for",
  "on",
  "of",
  "and",
  "or",
  "is",
  "are",
  "be",
  "it",
  "this",
  "that",
  "please",
  "can",
  "could",
  "would",
  "will",
  "you",
  "do",
  "does",
  "did",
  "with",
  "in",
  "at",
  "as",
  "so",
  "just",
  "up",
  "out",
]);

const DATE_HINT =
  /(?:today|tonight|tomorrow|yesterday|this\s+\w+|next\s+\w+|(?:mon|tues|wednes|thurs|fri|satur|sun)day|\d{4}-\d{2}-\d{2}|(?:\d{1,2}\s+)?(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+\d{1,2}(?:,?\s*\d{4})?)?)/i;

export type Interpreted = {
  family: IntentKind | "unknown";
  confidence: number;
  /** Canonical local-agent command when we can form one. */
  canonical: string | null;
  primaryClause: string;
  slots: {
    title?: string;
    subject?: string;
    when?: string;
    pronoun?: boolean;
  };
};

function tokens(text: string): Set<string> {
  return new Set(
    normalizeForMatch(text)
      .split(/\s+/)
      .map((t) => t.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ""))
      .filter((t) => t.length > 1 && !STOP.has(t))
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

/** Pick the most actionable clause from compound chat. */
export function primaryClause(raw: string): string {
  const cleaned = normalizeInput(raw)
    .replace(/[.!?]+$/g, "")
    .trim();
  if (!cleaned) return cleaned;

  const parts = cleaned
    .split(/(?<=[.!?])\s+|\s+(?:and then|then)\s+/i)
    .map((p) => p.replace(/[.!?]+$/g, "").trim())
    .filter((p) => p.length > 1);
  if (parts.length <= 1) return cleaned;

  const scored = parts.map((part) => {
    const n = normalizeForMatch(part);
    let score = 0;
    if (
      /\b(?:remind|add|create|schedule|put|need|gotta|have to|should|want|todo|finish|done|complete|mark|move|reschedule|delete|remove|show|what|plan|postpone|bump)\b/.test(
        n
      )
    ) {
      score += 3;
    }
    if (DATE_HINT.test(part)) score += 1;
    if (/\b(?:add it|put it|save it)\b/.test(n)) score -= 1;
    if (/^(?:thanks|ok|okay|please)\b/.test(n)) score -= 2;
    return { part, score, len: part.length };
  });
  scored.sort((a, b) => b.score - a.score || b.len - a.len);
  return scored[0]?.part ?? cleaned;
}

function extractWhen(text: string): string | undefined {
  const forDue = text.match(
    new RegExp(`\\b(?:for|due|by|on|before|until|till|to)\\s+(${DATE_HINT.source})\\s*$`, "i")
  );
  if (forDue) return forDue[1].trim();
  const trailing = text.match(new RegExp(`\\s+(${DATE_HINT.source})\\s*$`, "i"));
  if (trailing) return trailing[1].trim();
  return undefined;
}

function stripWhen(text: string, when?: string): string {
  let t = text;
  if (when) {
    t = t.replace(new RegExp(`\\s*(?:for|due|by|on|before|until|till|to)\\s+${escapeRe(when)}\\s*$`, "i"), "");
    t = t.replace(new RegExp(`\\s+${escapeRe(when)}\\s*$`, "i"), "");
  }
  return t.replace(/\s+/g, " ").trim();
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanTitle(raw: string): string {
  return raw
    .replace(/^to\s+/i, "")
    .replace(/^do\s+(?:my\s+|the\s+)?/i, "")
    .replace(/^(?:a\s+|an\s+)/i, "")
    .replace(/\s+(?:to my (?:tasks?|list|todo)|on my (?:list|tasks?)|please)$/i, "")
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isPronounSubject(text: string): boolean {
  return /^(?:it|that|this|that one|this one|that task|this task)$/i.test(
    normalizeForMatch(text)
  );
}

function cueBoosts(norm: string): Partial<Record<IntentKind, number>> {
  const boosts: Partial<Record<IntentKind, number>> = {};

  // Negation of create must suppress create scoring.
  if (
    /\b(?:do not|dont|don't|never)\s+(?:add|create|put|include|schedule)\b/.test(norm) &&
    !/\b(?:dont|don't|do not)\s+forget\b/.test(norm)
  ) {
    boosts.create_task = (boosts.create_task ?? 0) - 0.8;
    boosts.query_schedule = (boosts.query_schedule ?? 0) + 0.1;
    return boosts;
  }

  // "gotta finish / need to finish" → complete, not create.
  if (
    /(?:gotta|got to|need to|have to|must|should|wanna|want to|gonna|going to)\s+(?:to\s+)?(?:finish|complete|wrap)/.test(
      norm
    )
  ) {
    boosts.complete = (boosts.complete ?? 0) + 0.45;
    boosts.create_task = (boosts.create_task ?? 0) - 0.35;
  }

  if (
    /\b(?:remind|don't forget|dont forget|nudge|ping|jot|todo|note|need to|have to|gotta|should|wanna|gonna|put .+ on|add |create |schedule (?!my (?:day|week|month)))\b/.test(
      norm
    ) ||
    (DATE_HINT.test(norm) &&
      !/\b(?:what|show|left|free|busy|anything|overdue)\b/.test(norm) &&
      !/\?$/.test(norm))
  ) {
    boosts.create_task = (boosts.create_task ?? 0) + 0.25;
  }
  // Verb "schedule X" is create; noun "my schedule" / "schedule?" is query.
  if (
    /\bschedule\b/.test(norm) &&
    !/\bschedule\s+(?:my\s+)?(?:day|week|month|today|morning)\b/.test(norm) &&
    !/^(?:my\s+)?schedule\b/.test(norm) &&
    !/\b(?:show|what|check)\b.*\bschedule\b/.test(norm)
  ) {
    boosts.create_task = (boosts.create_task ?? 0) + 0.35;
    boosts.query_schedule = (boosts.query_schedule ?? 0) - 0.4;
  }
  if (
    /\b(?:done|finished|complete|completed|wrapped|check off|cross off|mark .+ (?:done|complete)|is done)\b/.test(
      norm
    )
  ) {
    boosts.complete = (boosts.complete ?? 0) + 0.3;
  }
  if (/^(?:finish|complete)\s+\S+/i.test(norm)) {
    boosts.complete = (boosts.complete ?? 0) + 0.35;
  }
  if (
    /\b(?:move|reschedule|postpone|bump|push|shift|slide|change .+ (?:to|until)|make it|change it)\b/.test(
      norm
    ) ||
    /\binstead\b/.test(norm)
  ) {
    boosts.reschedule = (boosts.reschedule ?? 0) + 0.3;
    boosts.correction = (boosts.correction ?? 0) + 0.15;
  }
  if (
    /^(?:what|show|list|anything|today|tomorrow|this week|overdue|left|pending|free|busy)\b/.test(
      norm
    ) ||
    /\?$/.test(norm)
  ) {
    boosts.query_schedule = (boosts.query_schedule ?? 0) + 0.25;
  }
  if (/\b(?:delete|remove|trash|get rid)\b/.test(norm)) {
    boosts.delete = (boosts.delete ?? 0) + 0.35;
  }
  if (/\b(?:undo|take that back|reverse that)\b/.test(norm)) {
    boosts.undo = (boosts.undo ?? 0) + 0.5;
  }
  if (/\b(?:list:|checklist|groceries|shopping list|packing)\b/.test(norm)) {
    boosts.create_checklist = (boosts.create_checklist ?? 0) + 0.3;
  }
  if (/\b(?:plan my|focus on|organize my|plan tomorrow|plan (?:my )?week|too much to do)\b/.test(norm)) {
    boosts.plan_day = (boosts.plan_day ?? 0) + 0.3;
    boosts.plan_week = (boosts.plan_week ?? 0) + 0.2;
  }
  if (/\b(?:work on first|deadlines? should i|prioriti[sz]e|coming up)\b/.test(norm)) {
    boosts.plan_priority = (boosts.plan_priority ?? 0) + 0.35;
  }
  if (/\b(?:break .+ into|smaller steps|break this down)\b/.test(norm)) {
    boosts.breakdown = (boosts.breakdown ?? 0) + 0.4;
  }
  if (/\b(?:i meant|make it|actually|change it to|instead)\b/.test(norm)) {
    boosts.correction = (boosts.correction ?? 0) + 0.35;
  }
  return boosts;
}

function scoreFamilies(text: string): { family: IntentKind; score: number }[] {
  const inputTokens = tokens(text);
  const byFamily = new Map<IntentKind, number[]>();
  for (const ex of FEW_SHOT_EXAMPLES) {
    const score = jaccard(inputTokens, tokens(ex.user));
    const list = byFamily.get(ex.intent) ?? [];
    list.push(score);
    byFamily.set(ex.intent, list);
  }
  const boosts = cueBoosts(normalizeForMatch(text));
  const ranked: { family: IntentKind; score: number }[] = [];
  for (const [family, scores] of byFamily) {
    const best = Math.max(...scores, 0);
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    ranked.push({
      family,
      score: Math.min(1, best * 0.7 + avg * 0.3 + (boosts[family] ?? 0)),
    });
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}

function buildCanonical(
  family: IntentKind,
  clause: string,
  slots: Interpreted["slots"]
): string | null {
  const when = slots.when;
  const title = slots.title;
  const subject = slots.subject ?? (slots.pronoun ? "it" : undefined);
  const isMeantCorrection =
    /\bi meant\b/i.test(clause) ||
    /^(?:no|nope|wait|actually|sorry)\b/i.test(clause);

  switch (family) {
    case "create_task":
      if (!title) return null;
      return when ? `add ${title} for ${when}` : `add ${title}`;
    case "complete":
      if (!subject && !title) return null;
      return `mark ${subject ?? title} complete`;
    case "reschedule":
    case "correction":
      if (isMeantCorrection && when) {
        return `i meant ${when}`;
      }
      if (when && slots.pronoun) {
        return `move it to ${when}`;
      }
      if (when && subject && !/^no\b/i.test(subject)) {
        return `move ${subject} to ${when}`;
      }
      if (when && title) return `move ${title} to ${when}`;
      if (when) return `i meant ${when}`;
      return null;
    case "delete":
      if (!subject && !title) return null;
      return `delete ${subject ?? title}`;
    case "query_schedule": {
      const n = normalizeForMatch(clause);
      if (/\boverdue\b/.test(n)) return "show my overdue tasks";
      if (/\btomorrow\b/.test(n)) return "show my tasks for tomorrow";
      if (/\byesterday\b/.test(n)) return "show my tasks for yesterday";
      if (/\bthis week\b/.test(n)) return "show my tasks for this week";
      if (/\bnext week\b/.test(n)) return "show my tasks for next week";
      if (/\bthis month\b/.test(n)) return "show my tasks for this month";
      if (/\bnext month\b/.test(n)) return "show my tasks for next month";
      if (/\bno deadline\b|\bundated\b/.test(n)) return "show my tasks with no deadline";
      return "show my tasks for today";
    }
    case "plan_day": {
      const n = normalizeForMatch(clause);
      if (/\btomorrow\b/.test(n)) return "plan my tomorrow";
      if (/\bnext week\b/.test(n)) return "plan my next week";
      if (/\bweek\b/.test(n)) return "plan my week";
      if (/\bnext month\b/.test(n)) return "plan my next month";
      if (/\bmonth\b/.test(n)) return "plan my month";
      return "plan my day";
    }
    case "plan_week": {
      const n = normalizeForMatch(clause);
      if (/\btoo much\b|\boverwhelmed\b|\bswamped\b/.test(n)) {
        return /\btomorrow\b/.test(n)
          ? "too much to do tomorrow"
          : "too much to do this week";
      }
      if (/\bproject\b/.test(n)) return "help me finish my project on time";
      if (/\bnext week\b/.test(n)) return "plan my next week";
      return "plan my week";
    }
    case "plan_priority": {
      const n = normalizeForMatch(clause);
      if (/\bdeadline/.test(n)) return "which deadlines should I worry about";
      if (/\bbefore\b|\bby friday\b|\bfinish everything\b/.test(n)) {
        const m = clause.match(/\b(?:before|by)\s+(.+)$/i);
        return m
          ? `can I finish everything before ${m[1].trim()}`
          : "can I finish everything before Friday";
      }
      if (/\bcoming up\b/.test(n)) return "what's coming up";
      return "what should I work on first";
    }
    case "breakdown": {
      const goal =
        title ||
        clause
          .replace(/^.*?\b(?:break(?:\s+\w+)?\s+(?:down|into)|split)\s+/i, "")
          .replace(/\binto\s+smaller\s+steps?\b/i, "")
          .trim() ||
        "this goal";
      return `break down ${goal}`;
    }
    case "undo":
      return "undo";
    case "create_checklist":
      return null; // leave to soft checklist / existing matchers
    case "event":
      return null;
    default:
      return null;
  }
}

function extractSlots(family: IntentKind, clause: string): Interpreted["slots"] {
  const when = extractWhen(clause);
  const withoutWhen = stripWhen(clause, when);
  const norm = normalizeForMatch(withoutWhen);

  // "No, I meant next Friday" / "I meant tomorrow" — correction of focused record.
  const meant = clause.match(
    /^(?:no|nope|wait|actually|sorry)[, ]+(?:i meant|make it|change it to|it should be|that should be)\s+(.+)$/i
  ) || clause.match(/^i meant\s+(.+)$/i);
  if (meant && (family === "correction" || family === "reschedule")) {
    return { subject: "it", when: meant[1].trim(), pronoun: true };
  }

  if (family === "create_task") {
    let title = withoutWhen
      .replace(
        /^(?:can you|could you|would you|will you|please|pls|plz)\s+/i,
        ""
      )
      .replace(
        /^(?:remind me(?: to)?|don'?t forget(?: to)?|remember(?: to)?|schedule(?: a| an| my)?|put|add|create|make|new(?: task)?|jot(?: down)?|note(?: down)?|write(?: down)?|ping me(?: to)?|nudge me(?: to)?|set a reminder(?: to)?)\s+/i,
        ""
      )
      .replace(
        /^(?:i(?:'m| am)?\s+)?(?:need|have|gotta|got|should|must|ought|wanna|want|gonna|going to|planning to|trying to|hoping to)\s+(?:to\s+)?/i,
        ""
      )
      .replace(/\s+on\s+(?:my\s+)?(?:list|todo|tasks?)(?:\s+for\s+.+)?$/i, "")
      .replace(/\s+to\s+(?:my\s+)?(?:list|todo|tasks?)$/i, "")
      .replace(/\s+on\s+.+\s+list$/i, "");
    title = cleanTitle(title);
    return { title: title || undefined, when, pronoun: false };
  }

  if (family === "complete") {
    let subject = withoutWhen
      .replace(/^(?:mark|complete|finish|check(?:ed)? off|cross(?:ed)? off)\s+/i, "")
      .replace(/\s+(?:as\s+)?(?:done|complete|completed|finished)$/i, "")
      .replace(/^(?:i(?:'ve| have)?\s+)?(?:just\s+)?(?:done(?: with)?|finished|completed|wrapped up)\s+/i, "")
      .replace(/\s+(?:is|are)\s+(?:done|finished|complete|completed)$/i, "");
    subject = cleanTitle(subject) || cleanTitle(withoutWhen);
    return {
      subject: subject || undefined,
      title: subject || undefined,
      pronoun: isPronounSubject(subject),
      when,
    };
  }

  if (family === "reschedule" || family === "correction") {
    const move = clause.match(
      /^(?:move|reschedule|shift|postpone|push(?:\s+back)?|bump|slide|delay|defer)\s+(.+?)\s+(?:to|until|till|for)\s+(.+)$/i
    );
    if (move) {
      return {
        subject: cleanTitle(move[1]) || move[1].trim(),
        when: move[2].trim(),
        pronoun: isPronounSubject(move[1]),
      };
    }
    const makeIt = clause.match(
      /^(?:make it|change it(?: to)?|set it(?: to)?|move it(?: to)?)\s+(.+)$/i
    );
    if (
      makeIt &&
      !/^(?:shorter|longer|urgent|high(?:\s+priority)?|low(?:\s+priority)?|medium)$/i.test(
        makeIt[1].trim()
      )
    ) {
      return { subject: "it", when: makeIt[1].trim(), pronoun: true };
    }
    const instead = clause.match(new RegExp(`^(${DATE_HINT.source})\\s+instead$`, "i"));
    if (instead) {
      return { subject: "it", when: instead[1].trim(), pronoun: true };
    }
    const changeTo = clause.match(
      /^(?:change|update|set)\s+(?:the\s+)?(?:date|deadline|due date)?\s*(?:to\s+)?(.+)$/i
    );
    if (changeTo && DATE_HINT.test(changeTo[1])) {
      return { subject: "it", when: changeTo[1].trim(), pronoun: true };
    }
    if (when && isPronounSubject(withoutWhen)) {
      return { subject: "it", when, pronoun: true };
    }
    if (when) {
      return {
        subject: cleanTitle(withoutWhen) || undefined,
        when,
        pronoun: false,
      };
    }
    return { when, pronoun: /\bit\b/.test(norm) };
  }

  if (family === "delete") {
    const subject = cleanTitle(
      withoutWhen.replace(/^(?:delete|remove|trash|get rid of|bin|erase)\s+/i, "")
    );
    return { subject: subject || undefined, title: subject || undefined };
  }

  return { when, title: cleanTitle(withoutWhen) || undefined };
}

/**
 * Interpret free-form user text into an intent family + optional canonical command.
 */
export function interpretUtterance(raw: string): Interpreted {
  const clause = primaryClause(raw);
  if (!clause) {
    return {
      family: "unknown",
      confidence: 0,
      canonical: null,
      primaryClause: "",
      slots: {},
    };
  }

  const ranked = scoreFamilies(clause);
  const top = ranked[0];
  const second = ranked[1];
  if (!top || top.score < 0.18) {
    return {
      family: "unknown",
      confidence: top?.score ?? 0,
      canonical: null,
      primaryClause: clause,
      slots: {},
    };
  }

  // Prefer create over query when scores are close and utterance has schedule+object.
  let family = top.family;
  let confidence = top.score;
  const norm = normalizeForMatch(clause);
  if (
    family === "query_schedule" &&
    /\bschedule\b/.test(norm) &&
    !/^(?:my\s+)?schedule\b/.test(norm) &&
    !/\bschedule\s+(?:my\s+)?(?:day|week|month)\b/.test(norm) &&
    second?.family === "create_task"
  ) {
    family = "create_task";
    confidence = Math.max(second.score, top.score * 0.9);
  }

  const slots = extractSlots(family, clause);
  const canonical = buildCanonical(family, clause, slots);

  return {
    family,
    confidence,
    canonical,
    primaryClause: clause,
    slots,
  };
}
