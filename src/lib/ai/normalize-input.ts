/**
 * Aggressive text cleanup before intent matching.
 * Covers typos, chat slang, contractions, fillers, and common multilingual
 * productivity phrasing (romanized Urdu/Hindi + Spanish helpers).
 *
 * Inspired by CLU / chatbot NLU practice: normalize surface form first so
 * downstream patterns see a smaller, cleaner language.
 */

import { correctSpellingAndGrammar } from "./spell";

const TYPO_MAP: Array<[RegExp, string]> = [
  [/\b(tommorow|tommorrow|tomorow|tomorro|tmrw|tmr|tomorow'?s|tomorrow'?s)\b/gi, "tomorrow"],
  [/\b(todsy|tdy|tday|2day)\b/gi, "today"],
  [/\b(yesturday|yestrday|yestarday|ystday)\b/gi, "yesterday"],
  [/\b(tonite|2nite|tonigh)\b/gi, "tonight"],
  [/\b(cheklist|checklst|chcklist|check list|chklist|check-list)\b/gi, "checklist"],
  [/\b(compleat|complet|complte|compelete|finsih|finsh|finnish)\b/gi, "complete"],
  [/\b(projct|projet|proejct)\b/gi, "project"],
  [/\b(appoinment|appoitment|appt)\b/gi, "appointment"],
  [/\b(meetng|mtg|meating|meting)\b/gi, "meeting"],
  [/\b(delet|dleete|rmove|remov|remve)\b/gi, "delete"],
  [/\b(schdule|sheduling|schedual|shedule)\b/gi, "schedule"],
  [/\b(reshedul|reshedule|rescedule|reschedul)\b/gi, "reschedule"],
  [/\b(remindr|remider)\b/gi, "reminder"],
  [/\b(remnd|remid|remine)\b/gi, "remind"],
  [/\b(priorty|prioroty|prioirty)\b/gi, "priority"],
  [/\b(urgnt|emrgency)\b/gi, "urgent"],
  [/\b(calender|calandar)\b/gi, "calendar"],
  [/\b(dead line|deadlne)\b/gi, "deadline"],
  [/\b(homewerk|homewrk|homwork|home work|assingment|asignmnt|assigment)\b/gi, "homework"],
  [/\b(grocieres|grocerys|grocries)\b/gi, "groceries"],
  [/\b(tommorw|tmorrow)\b/gi, "tomorrow"],
  [/\b(fridya|friady)\b/gi, "friday"],
  [/\b(mondya|monady)\b/gi, "monday"],
  [/\b(tuesda|tusday|tueday)\b/gi, "tuesday"],
  [/\b(wensday|wednesdy|wendsday)\b/gi, "wednesday"],
  [/\b(thursda|thurday|thrsday)\b/gi, "thursday"],
  [/\b(satuday|satrday)\b/gi, "saturday"],
  [/\b(sundya|sunady)\b/gi, "sunday"],
  [/\bshw\b/gi, "show"],
  [/\b(upcomming|upcomiing|upcomin)\b/gi, "upcoming"],
  [/\bnex\s+week\b/gi, "next week"],
  [/\balot\b/gi, "a lot"],
  [/\bhav\b/gi, "have"],
  [/\bplz\b/gi, "please"],
  [/\bpls\b/gi, "please"],
];

const SLANG_MAP: Array<[RegExp, string]> = [
  [/\bwats\b/gi, "what is"],
  [/\bwhats\b/gi, "what is"],
  [/\bwhat'?s\b/gi, "what is"],
  [/\bwhatcha\b/gi, "what are you"],
  [/\bidk\b/gi, "i don't know"],
  [/\bidc\b/gi, "i don't care"],
  [/\btbh\b/gi, "to be honest"],
  [/\bimho\b/gi, "in my opinion"],
  [/\bgonna\b/gi, "going to"],
  [/\bwanna\b/gi, "want to"],
  [/\bgotta\b/gi, "got to"],
  [/\blemme\b/gi, "let me"],
  [/\bgimme\b/gi, "give me"],
  [/\bkinda\b/gi, "kind of"],
  [/\bsorta\b/gi, "sort of"],
  [/\boutta\b/gi, "out of"],
  [/\bcuz\b/gi, "because"],
  [/\bcause\b/gi, "because"],
  [/\btho\b/gi, "though"],
  [/\bthru\b/gi, "through"],
  [/\bur\b/gi, "your"],
  [/\bya\b/gi, "you"],
  [/\bkk\b/gi, "ok"],
  [/\bnvm\b/gi, "never mind"],
  [/\bnvmnd\b/gi, "never mind"],
  [/\blmk\b/gi, "let me know"],
  [/\bty\b/gi, "thank you"],
  [/\bthx\b/gi, "thanks"],
  [/\btysm\b/gi, "thank you"],
  [/\bw\/o\b/gi, "without"],
  [/\bb4\b/gi, "before"],
  [/\basap\b/gi, "urgent"],
  [/\bhw\b/gi, "homework"],
  [/\bppl\b/gi, "people"],
  [/\brn\b/gi, "right now"],
  [/\blaterz\b/gi, "later"],
  [/\bdun\b/gi, "done"],
  [/\bfinna\b/gi, "going to"],
  [/\bim\b/gi, "i am"],
  [/\bive\b/gi, "i have"],
  [/\bcant\b/gi, "cannot"],
  [/\bwont\b/gi, "will not"],
  [/\bdont\b/gi, "do not"],
  [/\bdidnt\b/gi, "did not"],
  [/\bisnt\b/gi, "is not"],
  [/\barent\b/gi, "are not"],
  [/\bwasnt\b/gi, "was not"],
  [/\bwerent\b/gi, "were not"],
  [/\bhasnt\b/gi, "has not"],
  [/\bhavent\b/gi, "have not"],
  [/\bshouldnt\b/gi, "should not"],
  [/\bcouldnt\b/gi, "could not"],
  [/\bwouldnt\b/gi, "would not"],
  [/\blets\b/gi, "let us"],
  // Normalize "to-do" / "to-dos" only — keep bare "todo:" for intent rewrite.
  [/\bto-dos?\b/gi, "tasks"],
];

/** Romanized Urdu / Hindi helpers people often mix into English. */
const SOUTH_ASIAN_MAP: Array<[RegExp, string]> = [
  [/\byad rakhna\b/gi, "remind me to"],
  [/\byaad rakhna\b/gi, "remind me to"],
  [/\byad dilana\b/gi, "remind me to"],
  [/\byaad dilana\b/gi, "remind me to"],
  [/\bmujhe yaad dilao\b/gi, "remind me to"],
  [/\bmujhe yaad rakhna\b/gi, "remind me to"],
  [/\bkarna hai\b/gi, "i need to"],
  [/\bkarna he\b/gi, "i need to"],
  [/\bkrna hai\b/gi, "i need to"],
  [/\bho gaya\b/gi, "is done"],
  [/\bho gya\b/gi, "is done"],
  [/\bho gaya hai\b/gi, "is done"],
  [/\bkhatam\b/gi, "done"],
  [/\bkhtm\b/gi, "done"],
  [/\baaj\b/gi, "today"],
  [/\bkal\b/gi, "tomorrow"],
  [/\bparso\b/gi, "day after tomorrow"],
  [/\babhi\b/gi, "now"],
  [/\bzaroor\b/gi, "must"],
  [/\bzaroori\b/gi, "urgent"],
  [/\bjldi\b/gi, "urgent"],
  [/\bjaldi\b/gi, "urgent"],
  [/\blist banao\b/gi, "make a checklist"],
  [/\blist bana do\b/gi, "make a checklist"],
  [/\btask add karo\b/gi, "add"],
  [/\btask add kar do\b/gi, "add"],
  [/\bcomplete kar do\b/gi, "mark complete"],
  [/\bcomplete karo\b/gi, "mark complete"],
  [/\bdikhao\b/gi, "show"],
  [/\bbatao\b/gi, "tell me"],
  [/\bkya hai\b/gi, "what is"],
  [/\bkya karna hai\b/gi, "what do i need to do"],
  [/\baaj kya hai\b/gi, "what is on today"],
  [/\bkal kya hai\b/gi, "what is on tomorrow"],
];

const SPANISH_MAP: Array<[RegExp, string]> = [
  [/\brecu[eé]rdame\b/gi, "remind me to"],
  [/\bno olvides?\b/gi, "don't forget to"],
  [/\btengo que\b/gi, "i need to"],
  [/\bnecesito\b/gi, "i need to"],
  [/\ba[nñ]ade\b/gi, "add"],
  [/\bagregar?\b/gi, "add"],
  [/\bcrea(?:r)?\b/gi, "create"],
  [/\btermin[eé]\b/gi, "finished"],
  [/\bhecho\b/gi, "done"],
  [/\bcompletado\b/gi, "complete"],
  [/\bqu[eé] tengo\b/gi, "what do i have"],
  [/\bhoy\b/gi, "today"],
  [/\bma[nñ]ana\b/gi, "tomorrow"],
  [/\besta semana\b/gi, "this week"],
  [/\bla semana que viene\b/gi, "next week"],
  [/\bur[gğ]ente\b/gi, "urgent"],
  [/\blista de\b/gi, "checklist for"],
  [/\bcompras\b/gi, "groceries"],
];

const FILLER_LEADING =
  /^(?:um+|uh+|erm+|hmm+|like|so+|well|okay so|ok so|basically|literally|actually wait|hold on|one sec|real quick|quick question|just wondering|btw|by the way)[,:]?\s+/i;

const FILLER_INLINE =
  /\b(?:um+|uh+|like|,?\s*you know,?|i mean,?|sort of|kind of)\b/gi;

/**
 * Soft-normalize free-form chat into something pattern matchers can read.
 * Keeps meaning; expands abbreviations; fixes frequent typos.
 */
export function normalizeInput(raw: string): string {
  let text = raw
    .normalize("NFKC")
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201C\u201D\u2033]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u00A0\u200B\uFEFF]/g, " ")
    .replace(/[✅✓✔︎☑]/g, " done")
    .replace(/[❌✕]/g, " delete")
    .replace(/[📝📌]/g, " note ")
    .replace(/[📅🗓]/g, " calendar ")
    .replace(/[⏰⏳]/g, " remind ")
    .replace(/[🔥⚡]/g, " urgent ")
    .replace(/[🎉🙌]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return text;

  text = text.replace(FILLER_LEADING, "");
  text = text.replace(FILLER_INLINE, " ");

  for (const [pattern, replacement] of TYPO_MAP) {
    text = text.replace(pattern, replacement);
  }
  for (const [pattern, replacement] of SLANG_MAP) {
    text = text.replace(pattern, replacement);
  }
  for (const [pattern, replacement] of SOUTH_ASIAN_MAP) {
    text = text.replace(pattern, replacement);
  }
  for (const [pattern, replacement] of SPANISH_MAP) {
    text = text.replace(pattern, replacement);
  }

  // Fuzzy domain spelling + light grammar (Damerau–Levenshtein / keyboard-aware)
  text = correctSpellingAndGrammar(text);

  // Collapse doubled polite words after slang expansion
  text = text
    .replace(/\b(please\s+){2,}/gi, "please ")
    .replace(/\b(thank you\s+){2,}/gi, "thank you ")
    // Urdu/Hindi often puts the day before the action: "remind me to tomorrow doctor"
    .replace(
      /\b(remind me to|don'?t forget to|i need to|add)\s+(today|tomorrow|tonight)\s+(.+)$/i,
      "$1 $3 $2"
    )
    .replace(/\s+/g, " ")
    .trim();

  return text;
}

/** Lowercase command form used by local matchers. */
export function normalizeForMatch(raw: string): string {
  return normalizeInput(raw)
    .toLowerCase()
    .replace(/[?!.,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
