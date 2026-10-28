/**
 * Rewrites casual / incomplete / synonym-heavy user text into canonical
 * command shapes the local agent already understands.
 */

import { primaryClause } from "./interpret";
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

const DATE_TAIL =
  /(?:today|tonight|tomorrow|yesterday|this\s+\w+|next\s+\w+|(?:mon|tues|wednes|thurs|fri|satur|sun)day|\d{4}-\d{2}-\d{2}|(?:\d{1,2}\s+)?(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+\d{1,2}(?:,?\s*\d{4})?)?)/i;

/** Drop trailing sentence punctuation so anchored matchers see clean commands. */
function stripTrailingPunct(text: string): string {
  return text.replace(/[.!?…]+$/g, "").replace(/\s+/g, " ").trim();
}

function stripPolite(text: string): string {
  return text
    .replace(
      /^(?:hey|hi|hello|yo|ok|okay|so|um+|uh+|well|alright|right|ngl|tbh|idk|imo|fyi)[,!]?\s+/i,
      ""
    )
    .replace(
      /^(?:can you|could you|would you|will you|please|pls|plz)\s+(?:please\s+)?(?:help me\s+)?/i,
      ""
    )
    .replace(
      /^(?:i(?:'d| would) like you to|i want you to|i need you to|help me(?: to)?)\s+/i,
      ""
    )
    .replace(
      /^(?:i(?:'d| would) appreciate(?: it)? if you could|i(?:'d| would) appreciate if you(?: could)?)\s+/i,
      ""
    )
    .replace(/^(?:i(?:'d| would) like to)\s+/i, "")
    .replace(/^(?:do me a favor and|be a doll and|kindly)\s+/i, "")
    .replace(/\bplease\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tidyCreatePayload(payload: string): string {
  return payload
    .replace(/^to\s+/i, "")
    .replace(/^do\s+(?:my\s+|the\s+)?/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function rewriteCreates(text: string): string {
  // "remind me to buy milk tomorrow" / "don't forget to …"
  const remind = text.match(
    /^(?:remind me(?: to)?|don'?t forget(?: to)?|do not forget(?: to)?|remember(?: to)?|note(?:\s+of|\s+to)?|ping me(?: to)?|nudge me(?: to)?|hit me(?: up)?(?: to)?|send me a reminder(?: to)?|set a reminder(?: to)?|make a note(?:\s+of|\s+to)?)\s+(.+)$/i
  );
  if (remind) return `add ${tidyCreatePayload(remind[1])}`;

  // "i need to / i have to / i should / i gotta …"
  const need = text.match(
    /^(?:i\s+)?(?:need|have|gotta|got|should|must|ought|wanna|want|suppose|supposed|meant)\s+to\s+(.+)$/i
  );
  if (need) return `add ${tidyCreatePayload(need[1])}`;

  // "I should do laundry …" (obligation verb without "to")
  const shouldDo = text.match(
    /^(?:i\s+)?(?:should|must|oughta)\s+(?!to\b)(.+)$/i
  );
  if (shouldDo && !/^(?:add|create|make|show|what|mark|move)\b/i.test(shouldDo[1])) {
    return `add ${tidyCreatePayload(shouldDo[1])}`;
  }

  // "it'd be good if I …" / "it would help to …"
  const softNeed = text.match(
    /^(?:it(?:'d| would) (?:be )?(?:good|nice|helpful) (?:if i|to)\s+)(.+)$/i
  );
  if (softNeed) return `add ${tidyCreatePayload(softNeed[1])}`;

  // "better add / better put …"
  const better = text.match(/^(?:better|best)\s+(?:to\s+)?(?:add|put|do)\s+(.+)$/i);
  if (better) return `add ${tidyCreatePayload(better[1])}`;

  // "put this down for tomorrow"
  const putDown = text.match(
    /^(?:put|write|note)\s+(.+?)\s+down(?:\s+(?:for|on)\s+(.+))?$/i
  );
  if (putDown) {
    const title = tidyCreatePayload(putDown[1]);
    return putDown[2] ? `add ${title} for ${putDown[2]}` : `add ${title}`;
  }

  // "put X on my list/todo" / "add X to my list" / slang dump|chuck|slap onto backlog/plate
  const putOnList = text.match(
    /^(?:put|add|stick|throw|drop|shove|dump|chuck|slap)\s+(.+?)\s+(?:on|to|onto|in)\s+(?:my\s+)?(?:list|todo|to-?do|tasks?|reminders?|workload|schedule|agenda|backlog|plate)(?:\s+for\s+(.+))?$/i
  );
  if (putOnList) {
    const title = tidyCreatePayload(putOnList[1]).replace(/^['"]|['"]$/g, "");
    return putOnList[2] ? `add ${title} for ${putOnList[2]}` : `add ${title}`;
  }

  // "jot down X" / "pencil in X" / "chuck a reminder for X onto friday"
  const jotDown = text.match(
    /^(?:jot(?:\s+down)?|pencil(?:\s+in)?|note(?:\s+down)?)\s+(.+)$/i
  );
  if (jotDown) return `add ${tidyCreatePayload(jotDown[1])}`;

  const chuckReminder = text.match(
    /^(?:chuck|dump|slap|throw)\s+(?:a\s+)?(?:reminder|note|task)?\s*(?:for|to)?\s*(.+?)(?:\s+(?:onto|on|to|for)\s+(.+))?$/i
  );
  if (chuckReminder) {
    const title = tidyCreatePayload(chuckReminder[1]);
    return chuckReminder[2] ? `add ${title} for ${chuckReminder[2]}` : `add ${title}`;
  }

  // "put homework on tomorrow's list" / "put X on Friday list"
  const putOnDatedList = text.match(
    new RegExp(
      `^(?:put|add|stick|throw|drop|shove)\\s+(.+?)\\s+on\\s+(${DATE_TAIL.source})(?:'s)?\\s+(?:list|todo|to-?do|tasks?|agenda)$`,
      "i"
    )
  );
  if (putOnDatedList) {
    return `add ${tidyCreatePayload(putOnDatedList[1])} for ${putOnDatedList[2]}`;
  }

  // "todo: buy milk" / "task: essay due friday"
  const labeled = text.match(
    /^(?:todo|task|reminder|do|action|follow[- ]?up)\s*[:\-]\s*(.+)$/i
  );
  if (labeled) return `add ${tidyCreatePayload(labeled[1])}`;

  // "new task maths homework" / "a new project called …"
  const newThing = text.match(/^a?\s*new\s+(task|project|checklist|event|meeting)\s+(.+)$/i);
  if (newThing) return `create ${newThing[1]} ${newThing[2]}`;

  // "schedule a call with … tomorrow" / "schedule my homework for tomorrow"
  // (not "schedule my day/week" and not bare "my schedule")
  const scheduleThing = text.match(
    /^schedule\s+(?:a\s+|an\s+|my\s+)?(.+?)(?:\s+(?:for|on|at)\s+(.+))?$/i
  );
  if (
    scheduleThing &&
    !/\b(?:meeting|appointment|event|exam)\b/i.test(text) &&
    !/^(?:my\s+)?(?:day|today|week|month|morning|afternoon|evening)$/i.test(
      scheduleThing[1].trim()
    )
  ) {
    const title = tidyCreatePayload(scheduleThing[1]);
    return scheduleThing[2] ? `add ${title} for ${scheduleThing[2]}` : `add ${title}`;
  }

  // "book time for …" / "block time for …" / "book the dentist"
  const book = text.match(/^(?:book|block)\s+(?:time\s+)?(?:for\s+)?(.+)$/i);
  if (book && !/^(?:day|week|month)\b/i.test(book[1])) {
    return `add ${tidyCreatePayload(book[1])}`;
  }

  // "include X in my schedule/workload"
  const include = text.match(
    /^(?:include)\s+(.+?)\s+(?:in|on|to)\s+(?:my\s+)?(?:schedule|workload|agenda|list|tasks?)(?:\s+for\s+(.+))?$/i
  );
  if (include) {
    const title = tidyCreatePayload(include[1]);
    return include[2] ? `add ${title} for ${include[2]}` : `add ${title}`;
  }

  return text;
}

function rewriteCompletes(text: string): string {
  const done = text.match(
    /^(?:i(?:'ve| have)?\s+)?(?:just\s+)?(?:done(?: with)?|finished|completed|wrapped up|knocked out|sorted(?: out)?|crushed|nailed|shipped)\s+(.+?)(?:\s+(?:already|now))?$/i
  );
  if (done && !/^(?:add|create|make|delete|move|show|what|plan)\b/i.test(done[1])) {
    return `mark ${done[1]} complete`;
  }

  // "finish homework" / "complete the essay" (imperative)
  const imperative = text.match(/^(?:finish|complete)\s+(.+)$/i);
  if (
    imperative &&
    !/^(?:add|create|make|delete|move|show|what|plan|off)\b/i.test(imperative[1]) &&
    !/\b(?:checklist|items?)\b/i.test(imperative[1])
  ) {
    return `mark ${imperative[1]} complete`;
  }

  const checkOff = text.match(
    /^(?:check(?:ed)?\s+off|cross(?:ed)?\s+off|tick(?:ed)?\s+off|strike(?:n)?\s+off)\s+(.+)$/i
  );
  if (checkOff) return `mark ${checkOff[1]} complete`;

  const markDone = text.match(
    /^(?:mark|set)\s+(.+?)\s+(?:as\s+)?(?:done|complete|completed|finished)$/i
  );
  if (markDone) return `mark ${markDone[1]} complete`;

  // "all done with X"
  const allDone = text.match(/^all\s+done(?:\s+with)?\s+(.+)$/i);
  if (allDone) return `mark ${allDone[1]} complete`;

  // "X done" / "X finished" (short trailing) — avoid "science as done" → "mark science as"
  const trailingDone = text.match(
    /^(.+?)\s+(?:done|finished|complete|completed)(?:\s+now)?$/i
  );
  if (
    trailingDone &&
    trailingDone[1].split(/\s+/).length <= 6 &&
    !/\bas$/i.test(trailingDone[1].trim()) &&
    !/^(?:add|create|make|what|show|list|plan|how|mark|set|i|we|they)\b/i.test(
      trailingDone[1]
    ) &&
    !/\b(?:is|are|was|were|be)\b/i.test(trailingDone[1])
  ) {
    return `mark ${trailingDone[1]} complete`;
  }

  // "X as done" / "X as complete"
  const asDone = text.match(
    /^(.+?)\s+as\s+(?:done|complete|completed|finished)$/i
  );
  if (
    asDone &&
    asDone[1].split(/\s+/).length <= 6 &&
    !/^(?:add|create|make|what|show|list|plan|how|mark|set)\b/i.test(asDone[1])
  ) {
    return `mark ${asDone[1]} complete`;
  }

  return text;
}

function rewriteDeletes(text: string): string {
  const remove = text.match(
    /^(?:remove|get rid of|trash|bin|drop|clear|scrub|erase|kill)\s+(.+)$/i
  );
  if (remove) return `delete ${remove[1]}`;
  return text;
}

function rewriteQueries(text: string): string {
  // Verb "schedule X for …" is a create — never treat as a schedule query.
  if (
    /^schedule\s+(?:a\s+|an\s+|my\s+)?(?!day\b|today\b|week\b|month\b|morning\b|afternoon\b|evening\b).+/i.test(
      text
    )
  ) {
    return text;
  }

  // Broken grammar: "what task i have tomorrow" / "what tasks i got today"
  // Do NOT match "what do I need to finish …" (handled by the general query block).
  const brokenHave = text.match(
    /^(?:what|whats|what is|which)\s+(?:tasks?|work|stuff|things?)\s+(?:do\s+)?i\s+(?:have|got|need)(?:\s+to\s+do)?(?:\s+(?:for|on))?\s*(.+)?$/i
  ) || text.match(
    /^(?:what|whats|what is|which)\s+(?:do\s+)?i\s+(?:have|got)(?:\s+(?:for|on))?\s*(.+)?$/i
  );
  if (brokenHave) {
    const when = (brokenHave[1] ?? "").trim();
    if (/\btomorrow\b/i.test(text) || /\btomorrow\b/i.test(when)) {
      return "show my tasks for tomorrow";
    }
    if (/\btoday\b|\btonight\b/i.test(text) || /\btoday\b|\btonight\b/i.test(when)) {
      return "show my tasks for today";
    }
    if (/\bthis week\b/i.test(text)) return "show my tasks for this week";
    if (/\bnext week\b/i.test(text)) return "show my tasks for next week";
    if (/\bthis month\b/i.test(text)) return "show my tasks for this month";
    if (/\bnext month\b/i.test(text)) return "show my tasks for next month";
    if (when && /^(?:today|tonight|tomorrow|yesterday|this\s+\w+|next\s+\w+)$/i.test(when)) {
      return `show my tasks for ${when}`;
    }
    return "show my tasks for today";
  }

  // "i have a lot of work tomorrow" / "hav alot of work tomorow" → schedule glance
  if (
    /^(?:i\s+)?(?:hav(?:e)?|got)\s+(?:a\s+lot|alot|lots|much|many|too much)\s+(?:of\s+)?(?:work|tasks?|stuff|things?)(?:\s+(?:for|on))?\s*(.+)?$/i.test(
      text
    )
  ) {
    if (/\btomorrow\b/i.test(text)) return "show my tasks for tomorrow";
    if (/\btoday\b|\btonight\b/i.test(text)) return "show my tasks for today";
    if (/\bthis week\b/i.test(text)) return "show my tasks for this week";
    return "show my tasks for today";
  }

  // "do i have anything today" / "anything for tomorrow" / "what's on today"
  // Note: bare "schedule" as a noun only ("my schedule", "schedule?") — not "schedule homework".
  if (
    /^(?:do i have |is there |are there |got |have i got )?(?:anything|any(?:thing)?(?:\s+tasks?)?|what(?:'s| is|s)?(?:\s+on)?|my (?:schedule|agenda|day|plate)|what do i (?:have|need))\b/i.test(
      text
    ) ||
    /^(?:my )?(?:tasks?|agenda|workload|plate)\b/i.test(text) ||
    /^(?:my\s+)?schedule\??$/i.test(text) ||
    /^(?:show|tell|give)\s+me\b/i.test(text) ||
    /^(?:show|list|see|view|display)\s+(?:me\s+|my\s+)?(?:upcoming\s+)?(?:tasks?|list|schedule|agenda|day)\b/i.test(
      text
    ) ||
    /^(?:pull up|bring up|load|open|see)\s+(?:my\s+)?(?:tasks?|list|schedule|agenda|day)\b/i.test(
      text
    )
  ) {
    if (/\btoday\b|\btonight\b/i.test(text)) return "show my tasks for today";
    if (/\btomorrow\b/i.test(text)) return "show my tasks for tomorrow";
    if (/\byesterday\b/i.test(text)) return "show my tasks for yesterday";
    if (/\bthis week\b/i.test(text)) return "show my tasks for this week";
    if (/\bnext week\b/i.test(text)) return "show my tasks for next week";
    if (/\bthis month\b/i.test(text)) return "show my tasks for this month";
    if (/\bnext month\b/i.test(text)) return "show my tasks for next month";
    if (/\b(?:next|upcoming)\s+(?:7|seven)\s+days\b/i.test(text) || /\bupcoming\b/i.test(text)) {
      return "show my tasks for next 7 days";
    }
    if (/\boverdue\b|\bpast due\b|\blate\b|\bbehind\b/i.test(text)) {
      return "show my overdue tasks";
    }
    if (/\bno deadline\b|\bundated\b|\bwithout (?:a )?deadline\b|\bno due date\b/i.test(text)) {
      return "show my tasks with no deadline";
    }
    if (
      /^(?:show|tell|give)\s+me\s+(?:my\s+)?(?:tasks?|list|schedule|agenda)\b/i.test(text) ||
      /^(?:show|list|see|view|display)\s+(?:me\s+|my\s+)?(?:tasks?|list|schedule|agenda)\b/i.test(
        text
      ) ||
      /^(?:pull up|bring up|load|open|see)\s+(?:my\s+)?(?:tasks?|list|schedule|agenda|day)\b/i.test(
        text
      )
    ) {
      return "show my tasks for today";
    }
  }

  // Bare period questions: "today?", "this week", "tomorrow"
  if (
    /^(?:today|tonight|tomorrow|yesterday|this week|next week|this month|next month|overdue)(?:\??)?$/i.test(
      text
    )
  ) {
    const period = text.replace(/\?+$/, "").toLowerCase();
    if (period === "overdue") return "show my overdue tasks";
    if (period === "tonight") return "show my tasks for today";
    return `show my tasks for ${period}`;
  }

  // "how busy am i this week" / "how much work …"
  if (/how (?:busy|much work|packed|full|loaded|heavy)/i.test(text)) {
    if (/\bthis week\b/i.test(text)) return "how much work this week";
    if (/\bnext week\b/i.test(text)) return "how much work this week";
    if (/\btoday\b/i.test(text)) return "how much work today";
  }

  // "list projects that aren't done" etc.
  if (
    /\b(?:incomplete|open|unfinished|active)\s+projects?\b/i.test(text) &&
    !/^(?:add|create|make)\b/i.test(text)
  ) {
    return "show incomplete projects";
  }

  if (/^(?:my )?checklists?\??$/i.test(text)) return "show my checklists";
  if (
    /^(?:show|list|see|view|display)\s+(?:me\s+|my\s+)?checklists?\b/i.test(text) ||
    /^(?:show|list|see|view|display)\s+me\s+(?:my\s+)?checklists?\b/i.test(text)
  ) {
    return "show my checklists";
  }

  // "what's on my plate" / "whats on my plate tomorrow"
  if (
    /what(?:'s| is|s)? on my plate/i.test(text) ||
    /^(?:what(?:'s| is|s)?\s+)?(?:left\s+)?on my plate\b/i.test(text)
  ) {
    if (/\btomorrow\b/i.test(text)) return "show my tasks for tomorrow";
    if (/\btoday\b|\btonight\b/i.test(text)) return "show my tasks for today";
    if (/\bthis week\b/i.test(text)) return "show my tasks for this week";
    return "show my tasks for today";
  }

  return text;
}

function rewriteMoves(text: string): string {
  const assign = text.match(
    /^(?:assign|attach|link)\s+(.+?)\s+(?:to|into)\s+(?:the\s+|my\s+)?(.+?)(?:\s+project)?$/i
  );
  if (assign) return `move ${assign[1]} into ${assign[2]}`;

  const postpone = text.match(
    /^(?:postpone|push(?:\s+back)?|delay|defer|bump)\s+(.+?)\s+(?:to|until|till|for)\s+(.+)$/i
  );
  if (postpone) return `move ${postpone[1]} to ${postpone[2]}`;

  const moveDue = text.match(
    /^(?:move|reschedule|shift)\s+(.+?)\s+(?:to|until|till|for)\s+(.+)$/i
  );
  if (moveDue) return `move ${moveDue[1]} to ${moveDue[2]}`;

  // Focus follow-ups: "make it Friday" / "change it to next week" / "Friday instead"
  // Do not rewrite non-date follow-ups like "make it shorter" / "make it urgent".
  const makeIt = text.match(
    /^(?:make it|change it(?:\s+to)?|set it(?:\s+to)?|move it(?:\s+to)?)\s+(.+)$/i
  );
  if (makeIt) {
    const rest = makeIt[1].trim();
    if (
      !/^(?:shorter|longer|urgent|high(?:\s+priority)?|low(?:\s+priority)?|medium)$/i.test(rest)
    ) {
      return `move it to ${rest}`;
    }
  }

  const instead = text.match(new RegExp(`^(${DATE_TAIL.source})\\s+instead$`, "i"));
  if (instead) return `move it to ${instead[1]}`;

  const changeDate = text.match(
    /^(?:change|update|set)\s+(?:the\s+)?(?:date|deadline|due date)\s+to\s+(.+)$/i
  );
  if (changeDate) return `move it to ${changeDate[1]}`;

  return text;
}

/**
 * Bare "maths homework tomorrow" / "call mom on friday" → create task.
 * Skip if it already looks like a command or a question.
 */
function rewriteBareTask(text: string): string {
  if (
    /^(?:add|create|make|new|move|mark|delete|complete|finish|change|set|give|reschedule|shift|schedule|show|list|what|which|how|plan|undo|yes|no|nope|nah|cancel|wait|actually|sorry|i meant|who|why|when|where|too much|break down|can i finish|move less important|help me finish)\b/i.test(
      text
    )
  ) {
    return text;
  }
  if (detectPlanningCommand(text)) return text;
  if (/\b(?:i meant|make it|change it to|it should be)\b/i.test(text)) {
    return text;
  }
  if (/\b(?:checklist|project|meeting|appointment|event|exam)\b/i.test(text)) {
    return text;
  }
  if (/\?$/.test(text)) return text;

  // "X for/due/by/on DATE"
  const withDue = text.match(
    new RegExp(`^(.+?)\\s+(?:for|due|by|on|before)\\s+(${DATE_TAIL.source})$`, "i")
  );
  if (withDue) {
    const title = withDue[1].trim();
    if (title.length >= 2) return `add ${title} for ${withDue[2]}`;
  }

  // "X tomorrow/today/…" (date at end, no preposition)
  const trailingDate = text.match(new RegExp(`^(.+?)\\s+(${DATE_TAIL.source})$`, "i"));
  if (trailingDate) {
    const title = trailingDate[1].trim();
    if (title.length >= 2 && !/^(?:about|for|by|on|due|before)$/i.test(title)) {
      return `add ${title} for ${trailingDate[2]}`;
    }
  }

  return text;
}

function rewritePriority(text: string): string {
  if (/most urgent|highest priority|make .+ urgent|priorit(?:y|ise|ize)|more urgent/i.test(text)) {
    // "what should I prioritize first" is planning, not a priority mutation.
    if (/what should i (?:work on|do|focus on|prioriti[sz]e)\s+first/i.test(text)) {
      return text;
    }
    if (/^(?:what(?:'s| is)?|find|get)\s+(?:my\s+)?most urgent/i.test(text)) {
      return "most urgent task priority";
    }
    const makeUrgent = text.match(
      /^(?:make|set|mark)\s+(.+?)\s+(?:as\s+|more\s+)?(?:urgent|high priority|highest priority)$/i
    );
    if (makeUrgent) return `set ${makeUrgent[1]} urgent`;
  }
  // "ASAP: X" / "urgent: X"
  const asap = text.match(/^(?:asap|urgent|important)\s*[:\-]\s*(.+)$/i);
  if (asap) return `add ${asap[1]} urgent`;
  return text;
}

function rewritePlanning(text: string): string {
  const cmd = detectPlanningCommand(text);
  if (cmd) return planningCommandToText(cmd);
  return text;
}

function rewriteUndo(text: string): string {
  if (
    /^(?:oops[, ]+)?(?:please\s+)?(?:undo|undo that|undo it|undo the last change|take that back|reverse that|reverse the last change|roll that back|scratch that)$/i.test(
      text
    )
  ) {
    return "undo";
  }
  return text;
}

/** Canonicalize informal user input before the local command matcher runs. */
export function rewriteIntent(input: string): string {
  // Prefer the actionable clause in compound chat before pattern matching.
  let text = stripTrailingPunct(primaryClause(input));
  if (!text) {
    text = stripTrailingPunct(normalizeInput(input));
  }
  if (!text) return text;

  const stance = detectStance(text);
  text = stripPolite(text);

  // Prohibitions must never become creates ("don't add milk").
  if (stance.kind === "prohibit") {
    return stripTrailingPunct(`__prohibit__ ${text}`);
  }

  // Conditionals need clarification — do not invent a write.
  if (stance.kind === "conditional") {
    return stripTrailingPunct(`__clarify_conditional__ ${text}`);
  }

  // Tentative narration ("I might…") — do not invent a create.
  if (stance.kind === "suggestion") {
    return stripTrailingPunct(`__clarify_suggestion__ ${text}`);
  }

  // Past lookups ("Did I add milk?") → search-style query, not create.
  if (stance.kind === "lookup_past") {
    const about = text
      .replace(
        /^(?:did i|have i|did we)\s+(?:already\s+)?(?:add|create|put|schedule|include)\s+/i,
        ""
      )
      .replace(/\s+(?:to|on|in)\s+(?:my\s+)?(?:list|tasks?|todo|schedule).*$/i, "")
      .replace(/\?+$/g, "")
      .trim();
    if (about) return `show my tasks about ${about}`;
    return "show my tasks for today";
  }

  // "I gotta finish X" → complete, not create "finish X".
  if (stance.kind === "complete_focus") {
    const subject = extractFinishSubject(text);
    if (subject) {
      return `mark ${subject} complete`;
    }
  }

  text = rewriteUndo(text);
  const beforePlan = text;
  text = rewritePlanning(text);
  // Canonical planning commands must not be re-interpreted as creates
  // (e.g. "too much to do this week" must not become "add … for this week").
  if (text !== beforePlan || detectPlanningCommand(text)) {
    return stripTrailingPunct(text.replace(/\s+/g, " ").trim());
  }
  text = rewriteQueries(text);
  text = rewriteDeletes(text);
  text = rewriteCompletes(text);
  text = rewriteMoves(text);
  text = rewritePriority(text);

  // Skip create / bare-task when stance says this is not a create request.
  if (!blocksCreateRewrite(stance)) {
    text = rewriteCreates(text);
    text = rewriteBareTask(text);
  } else if (stance.kind === "query") {
    // Ensure query rewrite still wins if earlier passes left text unchanged.
    text = rewriteQueries(text);
  }

  return stripTrailingPunct(text.replace(/\s+/g, " ").trim());
}
