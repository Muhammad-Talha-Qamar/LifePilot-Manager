/**
 * Structured personalization memory for LifePilot.
 *
 * Three information tiers (enforced in prompts + tools):
 * 1. Temporary conversation context — ConversationContext (session)
 * 2. Persistent preferences / context notes — UserMemory (this module)
 * 3. Application data — tasks, checklists, events (repository; authoritative)
 *
 * No vector DB: keyword/tag overlap retrieval over a small per-user store.
 */

import type { MemoryCategory, UserMemory } from "@/types";

export const MAX_MEMORY_CONTENT = 500;
export const MAX_MEMORIES_PER_USER = 40;
export const MAX_PREFERENCES_IN_PROMPT = 12;
export const MAX_CONTEXT_IN_PROMPT = 5;

const SENSITIVE_PATTERN =
  /\b(?:password|passwd|api[_\s-]?key|secret[_\s-]?key|private[_\s-]?key|ssn|social\s*security|credit\s*card|card\s*number|cvv|cvc|bank\s*account|routing\s*number|bearer\s+[a-z0-9._-]{20,}|sk-[a-z0-9]{20,})\b/i;

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "to",
  "of",
  "in",
  "on",
  "for",
  "my",
  "me",
  "i",
  "is",
  "are",
  "be",
  "with",
  "that",
  "this",
  "it",
  "as",
  "at",
  "from",
  "about",
  "please",
  "just",
  "really",
  "very",
  "can",
  "you",
  "your",
  "do",
  "does",
  "did",
  "will",
  "would",
  "should",
  "could",
]);

/** Stable keys for common preference upserts. */
export const PREFERENCE_KEYS = {
  communication_style: "communication_style",
  summary_length: "summary_length",
  planning_style: "planning_style",
  reminder_style: "reminder_style",
  tone: "tone",
} as const;

export function isSensitiveMemoryContent(content: string): boolean {
  return SENSITIVE_PATTERN.test(content);
}

export function tokenizeForMemory(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

export function deriveMemoryTags(content: string, extra: string[] = []): string[] {
  const fromContent = tokenizeForMemory(content).slice(0, 12);
  const merged = [...extra.map((t) => t.toLowerCase().trim()), ...fromContent];
  return [...new Set(merged.filter(Boolean))].slice(0, 16);
}

export function suggestMemoryKey(
  category: MemoryCategory,
  content: string,
  explicitKey?: string | null
): string | null {
  if (explicitKey?.trim()) {
    return explicitKey
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 64) || null;
  }
  if (category !== "preference") return null;

  const lower = content.toLowerCase();
  if (
    /\b(concise|brief|short|verbose|detailed|long)\b/.test(lower) &&
    /\b(summar(?:y|ies)?|replies|reply|responses?|answers?)\b/.test(lower)
  ) {
    return PREFERENCE_KEYS.summary_length;
  }
  if (/\b(concise|brief|short|chatty|verbose|detailed)\b/.test(lower)) {
    return PREFERENCE_KEYS.communication_style;
  }
  if (/\b(priority\s*first|time[_\s-]?blocked|flexible|planning)\b/.test(lower)) {
    return PREFERENCE_KEYS.planning_style;
  }
  if (/\b(remind|nudge|notification)\b/.test(lower)) {
    return PREFERENCE_KEYS.reminder_style;
  }
  if (/\b(formal|casual|friendly|warm|direct|tone)\b/.test(lower)) {
    return PREFERENCE_KEYS.tone;
  }
  return null;
}

/** Score how relevant a memory is to the current user message. */
export function scoreMemoryRelevance(memory: UserMemory, query: string): number {
  if (memory.category === "preference") {
    // Preferences are broadly useful; slight boost when query mentions style words.
    const tokens = new Set(tokenizeForMemory(query));
    const styleHits = tokenizeForMemory(memory.content).filter((t) => tokens.has(t)).length;
    return 10 + styleHits * 2;
  }

  const queryTokens = tokenizeForMemory(query);
  if (!queryTokens.length) return 0;

  const haystack = new Set([
    ...memory.tags.map((t) => t.toLowerCase()),
    ...tokenizeForMemory(memory.content),
    ...(memory.key ? [memory.key.replace(/_/g, " ")] : []).flatMap(tokenizeForMemory),
  ]);

  let hits = 0;
  for (const token of queryTokens) {
    if (haystack.has(token)) hits += 1;
  }
  // Prefer fresher context when scores tie — caller sorts by score then updated_at.
  return hits;
}

export interface RetrievedMemories {
  preferences: UserMemory[];
  context: UserMemory[];
  /** Flat list used for prompt + tools. */
  all: UserMemory[];
}

/**
 * Retrieve only what the current request needs.
 * Preferences are always considered (capped); context notes need keyword overlap.
 */
export function retrieveRelevantMemories(
  memories: UserMemory[],
  query: string,
  options?: { maxPreferences?: number; maxContext?: number }
): RetrievedMemories {
  const maxPreferences = options?.maxPreferences ?? MAX_PREFERENCES_IN_PROMPT;
  const maxContext = options?.maxContext ?? MAX_CONTEXT_IN_PROMPT;

  // Prefer most recent when same key appears (defensive; storage should upsert).
  const byKey = new Map<string, UserMemory>();
  const unkeyed: UserMemory[] = [];
  for (const memory of [...memories].sort((a, b) =>
    b.updated_at.localeCompare(a.updated_at)
  )) {
    if (memory.key) {
      if (!byKey.has(memory.key)) byKey.set(memory.key, memory);
    } else {
      unkeyed.push(memory);
    }
  }
  const deduped = [...byKey.values(), ...unkeyed];

  const preferences = deduped
    .filter((m) => m.category === "preference")
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, maxPreferences);

  const contextScored = deduped
    .filter((m) => m.category === "context")
    .map((memory) => ({
      memory,
      score: scoreMemoryRelevance(memory, query),
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.memory.updated_at.localeCompare(a.memory.updated_at);
    })
    .slice(0, maxContext)
    .map((row) => row.memory);

  return {
    preferences,
    context: contextScored,
    all: [...preferences, ...contextScored],
  };
}

/** Format memories for the system prompt — clearly not live app data. */
export function formatMemoriesForPrompt(retrieved: RetrievedMemories): string {
  if (!retrieved.all.length) {
    return `## Persistent memory
No confirmed preferences or context notes are stored for this user.
Never invent memories or claim to remember something that is not listed here or returned by a tool.
Application data (tasks, checklists, deadlines, completion) must come from tools — not from memory.`;
  }

  const prefLines = retrieved.preferences.map(
    (m) => `- [${m.key ?? "preference"}] ${m.content}`
  );
  const contextLines = retrieved.context.map(
    (m) => `- ${m.content}${m.key ? ` (${m.key})` : ""}`
  );

  return `## Persistent memory (user-confirmed; not live task state)
These are durable preferences/context the user asked to keep. They are NOT a source of truth for task status, deadlines, or completion — always verify those with tools.
If a memory contradicts a fresh tool result, trust the tool (application data) and offer to update or forget the memory.
Never invent additional memories.

Preferences:
${prefLines.length ? prefLines.join("\n") : "- (none)"}

Relevant context notes (may be outdated):
${contextLines.length ? contextLines.join("\n") : "- (none for this request)"}`;
}

export interface MemoryIntent {
  kind: "save" | "forget" | "list" | "none";
  category?: MemoryCategory;
  content?: string;
  key?: string | null;
  forgetQuery?: string;
}

/**
 * Detect explicit remember / forget / list requests for the local agent.
 * Does not treat casual narration as a permanent preference.
 */
export function detectMemoryIntent(raw: string): MemoryIntent {
  const text = raw.trim();
  if (!text) return { kind: "none" };
  const lower = text.toLowerCase();

  if (
    /^(?:what\s+do\s+you\s+remember|show\s+(?:my\s+)?(?:memories|preferences)|list\s+(?:my\s+)?(?:memories|preferences)|what\s+(?:preferences|memories)\s+(?:do\s+you\s+have|have\s+you\s+saved))\b/i.test(
      lower
    )
  ) {
    return { kind: "list" };
  }

  // Only clear persistent memories — never steal task "delete/remove" commands.
  if (
    /^(?:forget|clear|delete|remove)\s+(?:all\s+)?(?:of\s+)?(?:my\s+)?(?:memories|preferences)\b/i.test(
      lower
    ) ||
    /^(?:forget|clear)\s+everything\b/i.test(lower)
  ) {
    return { kind: "forget", forgetQuery: "*" };
  }

  const forget =
    text.match(
      /^(?:forget|delete|remove|clear)\s+(?:my\s+)?(?:preference|memory|note)s?\s*(?:about|for|regarding|that)?\s*(.+)$/i
    ) ||
    text.match(/^forget\s+(?:that\s+)?(?:i\s+)?(.+)$/i) ||
    text.match(/^stop\s+remembering\s+(.+)$/i) ||
    text.match(/^don'?t\s+remember\s+(?:that\s+)?(.+)$/i);
  if (forget?.[1]) {
    const forgetQuery = forget[1].replace(/[.!?]+$/, "").trim();
    // "forget to buy milk" is a task reminder, not a memory delete.
    if (/^to\s+\S+/i.test(forgetQuery)) {
      return { kind: "none" };
    }
    if (/^(?:everything|all(?:\s+of\s+it)?)$/i.test(forgetQuery)) {
      return { kind: "forget", forgetQuery: "*" };
    }
    if (forgetQuery && forgetQuery.toLowerCase() !== "it") {
      return { kind: "forget", forgetQuery };
    }
  }

  // Explicit save cues only — never treat temporary narration as permanent.
  const savePatterns: RegExp[] = [
    /^(?:please\s+)?remember\s+(?:that\s+)?(.+)$/i,
    /^(?:please\s+)?(?:always|from\s+now\s+on)\s+(.+)$/i,
    /^(?:i\s+)?(?:prefer|want)\s+(?:you\s+to\s+)?(.+)$/i,
    /^keep\s+(?:my\s+)?(?:replies?|responses?|summaries|answers?)\s+(.+)$/i,
    /^save\s+(?:this\s+)?(?:preference|memory|note)\s*:?\s*(.+)$/i,
  ];

  for (const pattern of savePatterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    let content = match[1].replace(/[.!?]+$/, "").trim();
    if (!content || content.length < 3) continue;

    // Skip task-like "remember to buy milk" — that is a task, not a preference.
    if (/^to\s+\S+/i.test(content) && !/\b(prefer|always|never|style|concise|brief|verbose)\b/i.test(content)) {
      return { kind: "none" };
    }

    const isPreference =
      /\b(prefer|always|never|concise|brief|short|verbose|detailed|formal|casual|planning|summar|replies?|responses?|tone|style)\b/i.test(
        content
      ) || /^(?:please\s+)?remember\s+(?:that\s+)?i\s+prefer\b/i.test(lower);

    const category: MemoryCategory = isPreference ? "preference" : "context";
    // Normalize "remember that I prefer X" content
    if (/^that\s+/i.test(content)) content = content.replace(/^that\s+/i, "");
    const key = suggestMemoryKey(category, content);
    return { kind: "save", category, content: content.slice(0, MAX_MEMORY_CONTENT), key };
  }

  return { kind: "none" };
}

/** Match memories for a forget query (content/key/tags). */
export function matchMemoriesForForget(
  memories: UserMemory[],
  forgetQuery: string
): UserMemory[] {
  if (forgetQuery === "*") return [...memories];
  const tokens = tokenizeForMemory(forgetQuery);
  if (!tokens.length) return [];

  return memories
    .map((memory) => ({
      memory,
      score: scoreMemoryRelevance(
        { ...memory, category: "context" },
        forgetQuery
      ) + (memory.key && forgetQuery.toLowerCase().includes(memory.key.replace(/_/g, " ")) ? 5 : 0),
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((row) => row.memory);
}
