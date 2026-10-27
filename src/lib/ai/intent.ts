/**
 * Rewrites casual / incomplete / synonym-heavy user text into canonical
 * command shapes the local agent already understands.
 */

import { normalizeInput } from "./normalize-input";

const DATE_TAIL =
  /(?:today|tonight|tomorrow|yesterday|this\s+\w+|next\s+\w+|(?:mon|tues|wednes|thurs|fri|satur|sun)day|\d{4}-\d{2}-\d{2}|(?:\d{1,2}\s+)?(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+\d{1,2}(?:,?\s*\d{4})?)?)/i;

function stripPolite(text: string): string {
  return text
    .replace(
      /^(?:hey|hi|hello|yo|ok|okay|so|um+|uh+|well|alright|right)[,!]?\s+/i,
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
    .replace(/^(?:i(?:'d| would) like to)\s+/i, "")
    .replace(/^(?:do me a favor and|be a doll and|kindly)\s+/i, "")
    .replace(/\bplease\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function rewriteCreates(text: string): string {
  // "remind me to buy milk tomorrow" / "don't forget to …"
  const remind = text.match(
    /^(?:remind me(?: to)?|don'?t forget(?: to)?|remember(?: to)?|note(?: to)?|ping me(?: to)?|nudge me(?: to)?|hit me(?: up)?(?: to)?|send me a reminder(?: to)?|set a reminder(?: to)?|make a note(?: to)?)\s+(.+)$/i
  );
  if (remind) return `add ${remind[1]}`;

  // "i need to / i have to / i should / i gotta …"
  const need = text.match(
    /^(?:i\s+)?(?:need|have|gotta|got|should|must|ought|wanna|want|suppose|supposed|meant)\s+to\s+(.+)$/i
  );
  if (need) return `add ${need[1]}`;

  // "it'd be good if I …" / "it would help to …"
  const softNeed = text.match(
    /^(?:it(?:'d| would) (?:be )?(?:good|nice|helpful) (?:if i|to)\s+)(.+)$/i
  );
  if (softNeed) return `add ${softNeed[1]}`;

  // "better add / better put …"
  const better = text.match(/^(?:better|best)\s+(?:to\s+)?(?:add|put|do)\s+(.+)$/i);
  if (better) return `add ${better[1]}`;

  // "put X on my list/todo" / "add X to my list"
  const putOnList = text.match(
    /^(?:put|add|stick|throw|drop|shove)\s+(.+?)\s+(?:on|to|onto|in)\s+(?:my\s+)?(?:list|todo|to-?do|tasks?|reminders?)(?:\s+for\s+(.+))?$/i
  );
  if (putOnList) {
    return putOnList[2] ? `add ${putOnList[1]} for ${putOnList[2]}` : `add ${putOnList[1]}`;
  }

  // "todo: buy milk" / "task: essay due friday"
  const labeled = text.match(
    /^(?:todo|task|reminder|do|action|follow[- ]?up)\s*[:\-]\s*(.+)$/i
  );
  if (labeled) return `add ${labeled[1]}`;

  // "new task maths homework" / "a new project called …"
  const newThing = text.match(/^a?\s*new\s+(task|project|checklist|event|meeting)\s+(.+)$/i);
  if (newThing) return `create ${newThing[1]} ${newThing[2]}`;

  // "schedule a call with … tomorrow" (not "schedule my day/week")
  const scheduleThing = text.match(
    /^schedule\s+(?:a\s+|an\s+)?(.+?)(?:\s+(?:for|on|at)\s+(.+))?$/i
  );
  if (
    scheduleThing &&
    !/\b(?:meeting|appointment|event|exam)\b/i.test(text) &&
    !/^(?:my\s+)?(?:day|today|week|month|morning|afternoon|evening)$/i.test(
      scheduleThing[1].trim()
    )
  ) {
    return scheduleThing[2]
      ? `add ${scheduleThing[1]} for ${scheduleThing[2]}`
      : `add ${scheduleThing[1]}`;
  }

  // "book time for …" / "block time for …"
  const book = text.match(/^(?:book|block)\s+(?:time\s+)?(?:for\s+)?(.+)$/i);
  if (book && !/\b(?:day|week|month)\b/i.test(book[1])) {
    return `add ${book[1]}`;
  }

  return text;
}

function rewriteCompletes(text: string): string {
  const done = text.match(
    /^(?:i(?:'ve| have)?\s+)?(?:done(?: with)?|finished|completed|wrapped up|knocked out|sorted(?: out)?|crushed|nailed|shipped)\s+(.+?)(?:\s+(?:already|now))?$/i
  );
  if (done && !/^(?:add|create|make|delete|move|show|what|plan)\b/i.test(done[1])) {
    return `mark ${done[1]} complete`;
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

  // "X done" / "X finished" (short trailing)
  const trailingDone = text.match(
    /^(.+?)\s+(?:done|finished|complete|completed)(?:\s+now)?$/i
  );
  if (
    trailingDone &&
    trailingDone[1].split(/\s+/).length <= 6 &&
    !/^(?:add|create|make|what|show|list|plan|how|mark|set|i|we|they)\b/i.test(
      trailingDone[1]
    ) &&
    !/\b(?:is|are|was|were|be)\b/i.test(trailingDone[1])
  ) {
    return `mark ${trailingDone[1]} complete`;
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
  // "do i have anything today" / "anything for tomorrow" / "what's on today"
  if (
    /^(?:do i have |is there |are there |got |have i got )?(?:anything|any(?:thing)?(?:\s+tasks?)?|what(?:'s| is|s)?(?:\s+on)?|my (?:schedule|agenda|day|plate)|what do i (?:have|need))\b/i.test(
      text
    ) ||
    /^(?:my )?(?:tasks?|schedule|agenda|workload|plate)\b/i.test(text) ||
    /^(?:show|tell|give)\s+me\b/i.test(text) ||
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
    if (/\boverdue\b|\bpast due\b|\blate\b|\bbehind\b/i.test(text)) {
      return "show my overdue tasks";
    }
    if (/\bno deadline\b|\bundated\b|\bwithout (?:a )?deadline\b|\bno due date\b/i.test(text)) {
      return "show my tasks with no deadline";
    }
    if (
      /^(?:show|tell|give)\s+me\s+(?:my\s+)?(?:tasks?|list|schedule|agenda)\b/i.test(text) ||
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
  if (/^(?:show|list|see|view|display)\s+(?:my\s+)?checklists?\b/i.test(text)) {
    return "show my checklists";
  }

  // "what's on my plate"
  if (/what(?:'s| is|s)? on my plate/i.test(text)) {
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

  return text;
}

/**
 * Bare "maths homework tomorrow" / "call mom on friday" → create task.
 * Skip if it already looks like a command or a question.
 */
function rewriteBareTask(text: string): string {
  if (
    /^(?:add|create|make|new|move|mark|delete|complete|finish|change|set|give|reschedule|shift|schedule|show|list|what|which|how|plan|undo|yes|no|nope|nah|cancel|wait|actually|sorry|i meant|who|why|when|where)\b/i.test(
      text
    )
  ) {
    return text;
  }
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
  if (/most urgent|highest priority|make .+ urgent|priorit(?:y|ise|ize)/i.test(text)) {
    if (/^(?:what(?:'s| is)?|find|get)\s+(?:my\s+)?most urgent/i.test(text)) {
      return "most urgent task priority";
    }
    const makeUrgent = text.match(
      /^(?:make|set|mark)\s+(.+?)\s+(?:as\s+)?(?:urgent|high priority|highest priority)$/i
    );
    if (makeUrgent) return `set ${makeUrgent[1]} urgent`;
  }
  // "ASAP: X" / "urgent: X"
  const asap = text.match(/^(?:asap|urgent|important)\s*[:\-]\s*(.+)$/i);
  if (asap) return `add ${asap[1]} urgent`;
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
  let text = normalizeInput(input);
  if (!text) return text;

  text = stripPolite(text);
  text = rewriteUndo(text);
  text = rewriteQueries(text);
  text = rewriteDeletes(text);
  text = rewriteCompletes(text);
  text = rewriteMoves(text);
  text = rewritePriority(text);
  text = rewriteCreates(text);
  text = rewriteBareTask(text);

  return text.replace(/\s+/g, " ").trim();
}
