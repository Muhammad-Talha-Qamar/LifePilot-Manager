import { normalizeForMatch } from "./normalize-input";

const STOP = new Set([
  "my",
  "the",
  "a",
  "an",
  "to",
  "for",
  "of",
  "on",
  "in",
  "me",
  "please",
  "task",
  "tasks",
  "item",
  "items",
  "checklist",
  "project",
  "all",
  "and",
  "that",
  "this",
  "those",
  "it",
]);

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = temp;
    }
  }
  return row[b.length];
}

export function scoreName(query: string, name: string): number {
  const q = normalizeText(query);
  const n = normalizeText(name);
  if (!q || !n) return 0;
  if (q === n) return 100;
  if (n.includes(q)) return 92;
  if (q.includes(n) && n.length > 3) return 86;
  const qTokens = q.split(" ").filter((token) => token.length > 2 && !STOP.has(token));
  if (qTokens.length === 0) return 0;
  const nTokens = n.split(" ");
  let hits = 0;
  for (const token of qTokens) {
    const close = nTokens.some(
      (candidate) =>
        candidate === token ||
        (token.length > 4 && candidate.startsWith(token.slice(0, 4))) ||
        (token.length > 3 && levenshtein(candidate, token) <= 1)
    );
    if (close) hits += 1;
  }
  return Math.round((hits / qTokens.length) * 80);
}

export interface Ranked<T> {
  item: T;
  score: number;
}

export function rankByName<T>(
  query: string,
  items: T[],
  nameOf: (item: T) => string
): Ranked<T>[] {
  return items
    .map((item) => ({ item, score: scoreName(query, nameOf(item)) }))
    .filter((row) => row.score >= 50)
    .sort((a, b) => b.score - a.score);
}

export function pickUnique<T>(
  ranked: Ranked<T>[]
): { match: T } | { ambiguous: T[] } | { none: true } {
  if (ranked.length === 0) return { none: true };
  const [top, second] = ranked;
  if (!second || top.score - second.score >= 12) return { match: top.item };
  return {
    ambiguous: ranked.filter((row) => top.score - row.score < 12).map((row) => row.item),
  };
}

const ORDINAL: Record<string, number> = {
  first: 0,
  second: 1,
  third: 2,
  fourth: 3,
  fifth: 4,
  sixth: 5,
  seventh: 6,
  eighth: 7,
  ninth: 8,
  tenth: 9,
};

const COUNTS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

export function selectionCount(text: string): number | null {
  const match = text.match(
    /\bfirst\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/
  );
  if (!match) return null;
  return COUNTS[match[1]] ?? Number(match[1]);
}

export function ordinalIndex(text: string): number | null {
  if (selectionCount(text) && /\bfirst\s+(?!one\b)/.test(text)) return null;
  const match = text.match(
    /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+(?:st|nd|rd|th))\b/
  );
  if (!match) return null;
  if (match[1] === "first" && selectionCount(text)) return null;
  if (ORDINAL[match[1]] !== undefined) return ORDINAL[match[1]];
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) && value >= 1 ? value - 1 : null;
}

export function normalizeCommand(input: string): string {
  return normalizeForMatch(input).replace(/\bteh\b/g, "the");
}

export function cleanPhrase(value: string): string {
  return value.replace(/[.?!]+$/g, "").replace(/\s+/g, " ").trim();
}

export function titleCase(value: string): string {
  return value.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1));
}
