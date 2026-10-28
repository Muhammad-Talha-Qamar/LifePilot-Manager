/**
 * Domain spell + light grammar correction for LifePilot NLU.
 *
 * Approach (noisy-channel / chatbot practice):
 * 1) Keep known words and short tokens alone.
 * 2) For unknown tokens, pick the closest domain vocabulary word using
 *    Damerau–Levenshtein (insert/delete/substitute/transpose).
 * 3) Prefer keyboard-adjacent substitutions when scores tie.
 * 4) Fix common broken grammar / missing spaces that break intent matchers.
 * 5) Never fuzzy-correct protected real English words (weak≠week) — the
 *    interpretation layer asks when those appear in date phrases.
 *
 * Content titles (essay names, people) are left alone unless they are very
 * close to a command/time word — we never invent meaning, only repair surface form.
 */

/** Valid English words that must not be fuzzy-corrected into domain vocab. */
const PROTECTED_WORDS = new Set([
  "weak", // ≠ week — interpretation asks in date phrases
  "bye",
  "form",
  "from",
  "then",
  "than",
  "were",
  "where",
  "wear",
  "ware",
  "peace",
  "piece",
  "principal",
  "principle",
]);

export function isProtectedWord(word: string): boolean {
  return PROTECTED_WORDS.has(word.toLowerCase());
}

/** QWERTY neighbor map for typographic error preference. */
const KEY_NEIGHBORS: Record<string, string> = {
  q: "wa",
  w: "qeas",
  e: "wrds",
  r: "etdf",
  t: "ryfg",
  y: "tugh",
  u: "yihj",
  i: "uojk",
  o: "ipkl",
  p: "ol",
  a: "qwsz",
  s: "awedxz",
  d: "serfcx",
  f: "drtgvc",
  g: "ftyhbv",
  h: "gyujnb",
  j: "huiknm",
  k: "jiolm",
  l: "kop",
  z: "asx",
  x: "zsdc",
  c: "xdfv",
  v: "cfgb",
  b: "vghn",
  n: "bhjm",
  m: "njk",
};

/**
 * High-value LifePilot / productivity vocabulary.
 * Fuzzy correction only targets these (plus a few everyday glue words).
 */
const DOMAIN_VOCAB = [
  // actions
  "add",
  "create",
  "make",
  "new",
  "show",
  "list",
  "see",
  "view",
  "display",
  "tell",
  "give",
  "delete",
  "remove",
  "trash",
  "clear",
  "complete",
  "completed",
  "finish",
  "finished",
  "done",
  "mark",
  "check",
  "move",
  "reschedule",
  "shift",
  "postpone",
  "delay",
  "bump",
  "plan",
  "organize",
  "schedule",
  "undo",
  "cancel",
  "confirm",
  "update",
  "change",
  "set",
  "assign",
  "remind",
  "reminder",
  "remember",
  "forget",
  "note",
  "jot",
  "save",
  "log",
  "track",
  "help",
  "stretch",
  "tutor",
  "submit",
  "draft",
  "proposal",
  "parking",
  "passport",
  "charger",
  "hey",
  "hi",
  "hello",
  "yo",
  "hiya",
  "howdy",
  "thanks",
  "thank",
  "cheers",
  "salam",
  "hola",
  "sup",
  "let",
  "forget",
  "forgot",
  "down",
  "off",
  "out",
  "with",
  "without",
  "about",
  "into",
  "over",
  "under",
  "again",
  "also",
  "still",
  "even",
  "only",
  "very",
  "just",
  "more",
  "most",
  "some",
  "such",
  "than",
  "then",
  "them",
  "they",
  "this",
  "that",
  "those",
  "these",
  "there",
  "their",
  "here",
  "where",
  "when",
  "which",
  "while",
  "would",
  "could",
  "should",
  "shall",
  "might",
  "must",
  "need",
  "want",
  "like",
  "make",
  "made",
  "take",
  "took",
  "keep",
  "kept",
  "give",
  "gave",
  "tell",
  "told",
  "said",
  "says",
  "know",
  "knew",
  "think",
  "going",
  "wanna",
  "gonna",
  "gotta",
  "lemme",
  "gimme",
  "search",
  "find",
  "open",
  "start",
  "stop",
  "need",
  "want",
  "should",
  "must",
  "have",
  "got",
  "please",
  // nouns
  "task",
  "tasks",
  "checklist",
  "checklists",
  "list",
  "lists",
  "item",
  "items",
  "event",
  "events",
  "meeting",
  "appointment",
  "exam",
  "calendar",
  "schedule",
  "agenda",
  "deadline",
  "priority",
  "urgent",
  "overdue",
  "homework",
  "assignment",
  "essay",
  "project",
  "groceries",
  "grocery",
  "shopping",
  "packing",
  "errands",
  "todo",
  "todos",
  "workload",
  "summary",
  "briefing",
  "rundown",
  "recap",
  "upcoming",
  // time
  "today",
  "tonight",
  "tomorrow",
  "yesterday",
  "day",
  "days",
  "week",
  "weeks",
  "month",
  "months",
  "morning",
  "afternoon",
  "evening",
  "form",
  "forms",
  "from",
  "has",
  "have",
  "had",
  "first",
  "second",
  "third",
  "two",
  "three",
  "four",
  "five",
  "as",
  "done",
  "just",
  "finished",
  "maths",
  "math",
  "lab",
  "report",
  "worksheet",
  "chapter",
  "chapters",
  "notes",
  "paper",
  "form",
  "by",
  "buy",
  "friday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "january",
  "february",
  "march",
  "april",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
  "next",
  "this",
  "last",
  "due",
  "before",
  "after",
  "until",
  "till",
  // glue / pronouns often mistyped in commands
  "what",
  "which",
  "when",
  "where",
  "how",
  "who",
  "my",
  "me",
  "i",
  "you",
  "your",
  "the",
  "a",
  "an",
  "to",
  "for",
  "of",
  "on",
  "in",
  "at",
  "with",
  "from",
  "into",
  "and",
  "or",
  "is",
  "are",
  "was",
  "were",
  "am",
  "be",
  "do",
  "does",
  "did",
  "can",
  "could",
  "would",
  "will",
  "left",
  "pending",
  "remaining",
  "anything",
  "something",
  "everything",
  "nothing",
  "free",
  "busy",
  "packed",
  "focus",
  "call",
  "email",
  "buy",
  "pay",
  "submit",
  "write",
  "read",
  "study",
  "revise",
  "review",
  "milk",
  "eggs",
  "bread",
  "water",
  "doctor",
  "dentist",
  "mom",
  "dad",
  "tutor",
] as const;

const VOCAB_SET = new Set(DOMAIN_VOCAB.map((w) => w.toLowerCase()));

/** Words we never fuzzy-correct (too short / ambiguous / ids). */
const NEVER_CORRECT = new Set([
  "a",
  "i",
  "am",
  "an",
  "as",
  "at",
  "be",
  "by",
  "do",
  "go",
  "he",
  "if",
  "in",
  "is",
  "it",
  "me",
  "my",
  "no",
  "of",
  "ok",
  "on",
  "or",
  "so",
  "to",
  "up",
  "us",
  "we",
  "id",
  "pm",
  "am",
  "let",
  "not",
  "get",
  "put",
  "all",
  "any",
  "own",
  "per",
  "via",
  "yet",
  "out",
  "off",
  "too",
  "nor",
  "hey",
  "hi",
  "yo",
  "sup",
  // Conversational follow-up words — must not fuzzy into nearby vocab (same→save).
  "same",
  "other",
  "again",
  "shorter",
  "longer",
  "created",
  "just",
]);

/** Explicit high-frequency misspellings (cognitive + typographic). */
const EXPLICIT: Record<string, string> = {
  // time
  tommorow: "tomorrow",
  tommorrow: "tomorrow",
  tomorow: "tomorrow",
  tomorro: "tomorrow",
  tomorw: "tomorrow",
  tommorw: "tomorrow",
  tmorrow: "tomorrow",
  tmrw: "tomorrow",
  tmr: "tomorrow",
  tomrw: "tomorrow",
  tomoroww: "tomorrow",
  tody: "today",
  todsy: "today",
  tdy: "today",
  tday: "today",
  "2day": "today",
  todya: "today",
  tonite: "tonight",
  "2nite": "tonight",
  tonigh: "tonight",
  tonigt: "tonight",
  yesturday: "yesterday",
  yestrday: "yesterday",
  yestarday: "yesterday",
  ysterday: "yesterday",
  nex: "next",
  nnext: "next",
  wek: "week",
  weeek: "week",
  // weekdays
  mondya: "monday",
  monady: "monday",
  munday: "monday",
  tuesda: "tuesday",
  tusday: "tuesday",
  tueday: "tuesday",
  teusday: "tuesday",
  wensday: "wednesday",
  wednesdy: "wednesday",
  wendsday: "wednesday",
  wedensday: "wednesday",
  thursda: "thursday",
  thurday: "thursday",
  thrsday: "thursday",
  thrusday: "thursday",
  fridya: "friday",
  friady: "friday",
  fridy: "friday",
  satuday: "saturday",
  satrday: "saturday",
  saturdy: "saturday",
  sundya: "sunday",
  sunady: "sunday",
  // actions / nouns
  remnd: "remind",
  remid: "remind",
  remine: "remind",
  reminde: "remind",
  remindr: "reminder",
  remider: "reminder",
  cheklist: "checklist",
  checklst: "checklist",
  chcklist: "checklist",
  chklist: "checklist",
  checklsit: "checklist",
  checlist: "checklist",
  compleat: "complete",
  complet: "complete",
  complte: "complete",
  compelete: "complete",
  compleete: "complete",
  finsih: "finish",
  finsh: "finish",
  finnish: "finish",
  finised: "finished",
  finshed: "finished",
  delet: "delete",
  dleete: "delete",
  deelte: "delete",
  delte: "delete",
  rmove: "remove",
  remov: "remove",
  remve: "remove",
  schdule: "schedule",
  shedule: "schedule",
  schedual: "schedule",
  scedule: "schedule",
  sheduleing: "scheduling",
  appoinment: "appointment",
  appoitment: "appointment",
  appointmnt: "appointment",
  meetng: "meeting",
  meating: "meeting",
  metting: "meeting",
  priorty: "priority",
  prioroty: "priority",
  prioirty: "priority",
  urgnt: "urgent",
  urget: "urgent",
  emrgency: "emergency",
  calender: "calendar",
  calandar: "calendar",
  deadlne: "deadline",
  deadlin: "deadline",
  homewerk: "homework",
  homewor: "homework",
  homewrok: "homework",
  homwork: "homework",
  homewrk: "homework",
  hoemwork: "homework",
  assingment: "assignment",
  asignmnt: "assignment",
  assigment: "assignment",
  asignment: "assignment",
  upcomming: "upcoming",
  upcomiing: "upcoming",
  upcomin: "upcoming",
  upcomiingg: "upcoming",
  reshedule: "reschedule",
  rescedule: "reschedule",
  reschedual: "reschedule",
  reschedul: "reschedule",
  meting: "meeting",
  meetin: "meeting",
  meething: "meeting",
  grocieres: "groceries",
  grocerys: "groceries",
  grocries: "groceries",
  grocereis: "groceries",
  shoping: "shopping",
  shoppin: "shopping",
  overude: "overdue",
  overdeu: "overdue",
  overdu: "overdue",
  ageda: "agenda",
  aganda: "agenda",
  agend: "agenda",
  taks: "task",
  tesk: "task",
  tassk: "task",
  tsak: "task",
  addd: "add",
  creat: "create",
  shwo: "show",
  plese: "please",
  plase: "please",
  plz: "please",
  pls: "please",
  becuase: "because",
  becasue: "because",
  becouse: "because",
  teh: "the",
  thje: "the",
  hte: "the",
  waht: "what",
  whta: "what",
  wahat: "what",
  whatt: "what",
  whne: "when",
  hwo: "how",
  anthing: "anything",
  anythng: "anything",
  anyting: "anything",
  somthing: "something",
  somehting: "something",
  nothng: "nothing",
  pendng: "pending",
  remaning: "remaining",
  remainng: "remaining",
  focuss: "focus",
  foucs: "focus",
  studdy: "study",
  studing: "studying",
  revison: "revision",
  reviwe: "review",
  emial: "email",
  eamil: "email",
  emaill: "email",
  cal: "call",
  clal: "call",
  calle: "call",
  bbuy: "buy",
  byu: "buy",
  submitt: "submit",
  sumbit: "submit",
  writte: "write",
  reead: "read",
  raed: "read",
  docter: "doctor",
  docotr: "doctor",
  denist: "dentist",
  dentits: "dentist",
  esssay: "essay",
  esay: "essay",
  mathmatics: "mathematics",
  // grammar particles (length ≥ 4 where risky)
  shoud: "should",
  shold: "should",
  shulod: "should",
  culd: "could",
  coud: "could",
  woud: "would",
  neeed: "need",
  wnat: "want",
  watn: "want",
  ahve: "have",
  dont: "don't",
  doesnt: "doesn't",
  didnt: "didn't",
  cant: "can't",
  wont: "won't",
  isnt: "isn't",
  arent: "aren't",
  wasnt: "wasn't",
  werent: "weren't",
  hasnt: "hasn't",
  havent: "haven't",
  shouldnt: "shouldn't",
  couldnt: "couldn't",
  wouldnt: "wouldn't",
  youre: "you're",
  theyre: "they're",
  thats: "that's",
  whats: "what's",
  wheres: "where's",
  theres: "there's",
  heres: "here's",
};

function damerauLevenshtein(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (Math.abs(a.length - b.length) > 3) return maxLen;
  const la = a.length;
  const lb = b.length;
  const dp: number[][] = Array.from({ length: la + 1 }, () =>
    Array.from({ length: lb + 1 }, () => 0)
  );
  for (let i = 0; i <= la; i++) dp[i][0] = i;
  for (let j = 0; j <= lb; j++) dp[0][j] = j;
  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + cost);
      }
    }
  }
  return dp[la][lb];
}

function keyboardSubCost(from: string, to: string): number {
  if (from === to) return 0;
  const neighbors = KEY_NEIGHBORS[from] ?? "";
  return neighbors.includes(to) ? 0.4 : 1;
}

/** Soft distance: Damerau + cheaper keyboard-adjacent swaps. */
function softDistance(a: string, b: string): number {
  const base = damerauLevenshtein(a, b);
  if (base === 0) return 0;
  if (a.length === b.length && base === 1) {
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        return keyboardSubCost(a[i], b[i]);
      }
    }
  }
  return base;
}

function maxEdits(word: string): number {
  if (word.length <= 3) return 1;
  if (word.length <= 6) return 1;
  if (word.length <= 9) return 2;
  return 3;
}

/** Function words we may match FROM explicit typos, but never as fuzzy targets. */
const FUNCTION_TARGETS = new Set([
  "a",
  "an",
  "the",
  "to",
  "for",
  "of",
  "on",
  "in",
  "at",
  "by",
  "as",
  "or",
  "and",
  "if",
  "is",
  "am",
  "be",
  "do",
  "did",
  "can",
  "me",
  "my",
  "i",
  "you",
  "it",
  "up",
  "so",
  "no",
  "ok",
]);

function bestCorrection(token: string): string | null {
  const lower = token.toLowerCase();
  if (!lower || NEVER_CORRECT.has(lower)) return null;
  if (isProtectedWord(lower)) return null;
  if (VOCAB_SET.has(lower)) return null;
  if (EXPLICIT[lower]) return EXPLICIT[lower];

  // Digits / uuids / emails stay. Short tokens are too ambiguous for fuzzy repair
  // (hey→they, let→left, two→to) — only EXPLICIT map may change them.
  if (/\d/.test(lower) || lower.includes("@") || lower.length < 4) return null;

  let best: string | null = null;
  let bestScore = Infinity;
  let bestLenDelta = Infinity;
  const limit = maxEdits(lower);

  for (const candidate of DOMAIN_VOCAB) {
    // Never fuzzy-collapse a content word into a short function word ("two"→"to", "form"→"for", "cal"→"can")
    if (FUNCTION_TARGETS.has(candidate) || candidate.length <= 2) continue;
    if (Math.abs(candidate.length - lower.length) > limit) continue;
    // Same first letter preference for longer words (noisy-channel heuristic)
    if (lower.length >= 5 && candidate[0] !== lower[0] && softDistance(lower, candidate) > 1) {
      continue;
    }
    const score = softDistance(lower, candidate);
    const lenDelta = Math.abs(candidate.length - lower.length);
    if (score > limit) continue;
    if (
      score < bestScore ||
      (score === bestScore && lenDelta < bestLenDelta) ||
      (score === bestScore && lenDelta === bestLenDelta && candidate.length > (best?.length ?? 0))
    ) {
      bestScore = score;
      bestLenDelta = lenDelta;
      best = candidate;
    }
  }

  // Require a confident hit: distance 1 always; distance 2+ only if length allows
  if (best == null) return null;
  if (bestScore <= 1) return best;
  if (bestScore <= 2 && lower.length >= 6) return best;
  if (bestScore <= 3 && lower.length >= 10) return best;
  return null;
}

function preserveCase(original: string, replacement: string): string {
  if (original === original.toUpperCase() && original.length > 1) {
    return replacement.toUpperCase();
  }
  if (original[0] === original[0]?.toUpperCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

/** Split glued command phrases people type without spaces. */
function splitGluedCommands(text: string): string {
  return text
    .replace(/\bremindme\b/gi, "remind me")
    .replace(/\baddtask\b/gi, "add task")
    .replace(/\bcreatetask\b/gi, "create task")
    .replace(/\bmakelist\b/gi, "make list")
    .replace(/\bshowme\b/gi, "show me")
    .replace(/\btellme\b/gi, "tell me")
    .replace(/\bgiveme\b/gi, "give me")
    .replace(/\bletme\b/gi, "let me")
    .replace(/\bdonot\b/gi, "do not")
    .replace(/\bdontforget\b/gi, "don't forget")
    .replace(/\bdon\s+forget\b/gi, "don't forget")
    .replace(/\bwhatis\b/gi, "what is")
    .replace(/\bwhatsup\b/gi, "what's up")
    .replace(/\bplanmyday\b/gi, "plan my day")
    .replace(/\bmarkdone\b/gi, "mark done")
    .replace(/\bcheckoff\b/gi, "check off")
    .replace(/\bcompleteds?\b/gi, "completed");
}

/** Phrase-level repairs that single-token fuzzy cannot do. */
function applyPhraseRepairs(text: string): string {
  return text
    .replace(/\bto\s+by\b/gi, "to buy")
    .replace(/\b(add|create)\s+by\s+/gi, "$1 buy ")
    .replace(/\bupcomming\b/gi, "upcoming")
    .replace(/\bhomwork\b/gi, "homework");
}

/** Light grammar cleanup that helps intent regexes. */
function fixGrammar(text: string): string {
  return (
    text
      // doubled words: "the the", "to to"
      .replace(/\b(\w+)\s+\1\b/gi, "$1")
      // "i has / i does / i is" → have / do / am
      .replace(/\bi\s+has\b/gi, "i have")
      .replace(/\bi\s+does\b/gi, "i do")
      .replace(/\bi\s+is\b/gi, "i am")
      .replace(/\bi\s+were\b/gi, "i was")
      .replace(/\bi\s+are\b/gi, "i am")
      // "me need to" / "me wanna"
      .replace(/\bme\s+(need|have|wanna|want|gotta|got)\b/gi, "i $1")
      // "whats lefts" style plurals on queries already handled elsewhere
      // missing space after punctuation mid-sentence
      .replace(/([a-z])([.?!])([A-Za-z])/g, "$1$2 $3")
      // "a apple" → "an apple" (mild)
      .replace(/\ba\s+([aeiou])/gi, "an $1")
      // strip trailing filler punctuation noise
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * Correct spelling of domain-relevant tokens and light grammar issues.
 * Safe for task titles: unknown proper words with no close vocab match are kept.
 */
export function correctSpellingAndGrammar(raw: string): string {
  let text = splitGluedCommands(raw.trim());
  if (!text) return text;

  // Grammar first so "i has" becomes "i have" before fuzzy can turn "has" into "was".
  text = fixGrammar(text);
  text = applyPhraseRepairs(text);

  // Explicit whole-token map + fuzzy domain repair
  text = text
    .split(/(\s+)/)
    .map((part) => {
      if (/^\s+$/.test(part)) return part;
      // Keep punctuation attached: "tommorow?" → correct stem
      const match = part.match(/^([^A-Za-z']*)([A-Za-z']+)([^A-Za-z']*)$/);
      if (!match) return part;
      const [, lead, word, trail] = match;
      const lower = word.toLowerCase();
      if (EXPLICIT[lower]) {
        return lead + preserveCase(word, EXPLICIT[lower]) + trail;
      }
      const fixed = bestCorrection(word);
      if (fixed) return lead + preserveCase(word, fixed) + trail;
      return part;
    })
    .join("");

  text = applyPhraseRepairs(text);
  text = fixGrammar(text);
  return text.replace(/\s+/g, " ").trim();
}

/** Test helper: distance between two words. */
export function spellDistance(a: string, b: string): number {
  return softDistance(a.toLowerCase(), b.toLowerCase());
}
