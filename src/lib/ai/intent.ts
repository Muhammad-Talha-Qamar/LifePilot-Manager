/**
 * Rewrites casual / incomplete / synonym-heavy user text into canonical
 * command shapes the local agent already understands.
 */

const DATE_TAIL =
  /(?:today|tonight|tomorrow|yesterday|this\s+\w+|next\s+\w+|(?:mon|tues|wednes|thurs|fri|satur|sun)day|\d{4}-\d{2}-\d{2}|(?:\d{1,2}\s+)?(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+\d{1,2}(?:,?\s*\d{4})?)?)/i;

function stripPolite(text: string): string {
  return text
    .replace(
      /^(?:hey|hi|hello|yo|ok|okay|so|um+|uh+|well)[,!]?\s+/i,
      ""
    )
    .replace(
      /^(?:can you|could you|would you|will you|please|pls|plz)\s+(?:please\s+)?(?:help me\s+)?/i,
      ""
    )
    .replace(
      /^(?:i(?:'d| would) like you to|i want you to|help me(?: to)?)\s+/i,
      ""
    )
    .replace(/^(?:i(?:'d| would) like to)\s+/i, "")
    .replace(/\bplease\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function rewriteCreates(text: string): string {
  // "remind me to buy milk tomorrow" / "don't forget to …"
  const remind = text.match(
    /^(?:remind me(?: to)?|don'?t forget(?: to)?|remember(?: to)?|note(?: to)?|ping me(?: to)?|nudge me(?: to)?)\s+(.+)$/i
  );
  if (remind) return `add ${remind[1]}`;

  // "i need to / i have to / i should / i gotta …"
  const need = text.match(
    /^(?:i\s+)?(?:need|have|gotta|got|should|must|ought|wanna|want)\s+to\s+(.+)$/i
  );
  if (need) return `add ${need[1]}`;

  // "it'd be good if I …" / "it would help to …"
  const softNeed = text.match(
    /^(?:it(?:'d| would) (?:be )?(?:good|nice|helpful) (?:if i|to)\s+)(.+)$/i
  );
  if (softNeed) return `add ${softNeed[1]}`;

  // "put X on my list/todo" / "add X to my list"
  const putOnList = text.match(
    /^(?:put|add|stick|throw)\s+(.+?)\s+(?:on|to|onto)\s+(?:my\s+)?(?:list|todo|to-?do|tasks?)(?:\s+for\s+(.+))?$/i
  );
  if (putOnList) {
    return putOnList[2] ? `add ${putOnList[1]} for ${putOnList[2]}` : `add ${putOnList[1]}`;
  }

  // "todo: buy milk" / "task: essay due friday"
  const labeled = text.match(/^(?:todo|task|reminder|do)\s*[:\-]\s*(.+)$/i);
  if (labeled) return `add ${labeled[1]}`;

  // "new task maths homework" / "a new project called …"
  const newThing = text.match(/^a?\s*new\s+(task|project|checklist|event|meeting)\s+(.+)$/i);
  if (newThing) return `create ${newThing[1]} ${newThing[2]}`;

  // "schedule a call with … tomorrow" (not "schedule my day/week")
  const scheduleThing = text.match(
    /^schedule\s+(?:a\s+)?(.+?)(?:\s+(?:for|on|at)\s+(.+))?$/i
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

  return text;
}

function rewriteCompletes(text: string): string {
  const done = text.match(
    /^(?:i(?:'ve| have)?\s+)?(?:done(?: with)?|finished|completed|wrapped up|knocked out|sorted(?: out)?)\s+(.+?)(?:\s+(?:already|now))?$/i
  );
  if (done && !/^(?:add|create|make|delete|move|show|what|plan)\b/i.test(done[1])) {
    return `mark ${done[1]} complete`;
  }

  const checkOff = text.match(
    /^(?:check(?:ed)?\s+off|cross(?:ed)?\s+off|tick(?:ed)?\s+off)\s+(.+)$/i
  );
  if (checkOff) return `mark ${checkOff[1]} complete`;

  const markDone = text.match(
    /^(?:mark|set)\s+(.+?)\s+(?:as\s+)?(?:done|complete|completed|finished)$/i
  );
  if (markDone) return `mark ${markDone[1]} complete`;

  // "all done with X"
  const allDone = text.match(/^all\s+done(?:\s+with)?\s+(.+)$/i);
  if (allDone) return `mark ${allDone[1]} complete`;

  return text;
}

function rewriteDeletes(text: string): string {
  const remove = text.match(
    /^(?:remove|get rid of|trash|bin|drop|clear)\s+(.+)$/i
  );
  if (remove) return `delete ${remove[1]}`;
  return text;
}

function rewriteQueries(text: string): string {
  // "do i have anything today" / "anything for tomorrow" / "what's on today"
  if (
    /^(?:do i have |is there |are there |got )?(?:anything|any(?:thing)?(?:\s+tasks?)?|what(?:'s| is|s)?(?:\s+on)?|my (?:schedule|agenda|day)|what do i (?:have|need))\b/i.test(
      text
    ) ||
    /^(?:my )?(?:tasks?|schedule|agenda|workload|plate)\b/i.test(text) ||
    /^(?:show|tell|give)\s+me\b/i.test(text)
  ) {
    if (/\btoday\b|\btonight\b/i.test(text)) return "show my tasks for today";
    if (/\btomorrow\b/i.test(text)) return "show my tasks for tomorrow";
    if (/\bthis week\b/i.test(text)) return "show my tasks for this week";
    if (/\bnext week\b/i.test(text)) return "show my tasks for next week";
    if (/\bthis month\b/i.test(text)) return "show my tasks for this month";
    if (/\bnext month\b/i.test(text)) return "show my tasks for next month";
    if (/\boverdue\b|\bpast due\b|\blate\b/i.test(text)) return "show my overdue tasks";
    if (/\bno deadline\b|\bundated\b|\bwithout (?:a )?deadline\b/i.test(text)) {
      return "show my tasks with no deadline";
    }
    if (/^(?:show|tell|give)\s+me\s+(?:my\s+)?(?:tasks?|list|schedule|agenda)\b/i.test(text)) {
      return "show my tasks for today";
    }
  }

  // Bare period questions: "today?", "this week", "tomorrow"
  if (/^(?:today|tonight|tomorrow|this week|next week|this month|next month|overdue)(?:\??)?$/i.test(text)) {
    return `show my tasks for ${text.replace(/\?+$/, "")}`;
  }

  // "how busy am i this week" / "how much work …"
  if (/how (?:busy|much work|packed|full)/i.test(text)) {
    if (/\bthis week\b/i.test(text)) return "how much work this week";
    if (/\btoday\b/i.test(text)) return "how much work today";
  }

  // "list projects that aren't done" etc. already covered; normalize "incomplete projects"
  if (/\b(?:incomplete|open|unfinished|active)\s+projects?\b/i.test(text) && !/^(?:add|create|make)\b/i.test(text)) {
    return "show incomplete projects";
  }

  if (/^(?:my )?checklists?\??$/i.test(text)) return "show my checklists";
  if (/^(?:show|list|see)\s+(?:my\s+)?checklists?\b/i.test(text)) return "show my checklists";

  return text;
}

function rewriteMoves(text: string): string {
  const assign = text.match(
    /^(?:assign|attach|link)\s+(.+?)\s+(?:to|into)\s+(?:the\s+|my\s+)?(.+?)(?:\s+project)?$/i
  );
  if (assign) return `move ${assign[1]} into ${assign[2]}`;

  const postpone = text.match(
    /^(?:postpone|push(?:\s+back)?|delay)\s+(.+?)\s+(?:to|until|till)\s+(.+)$/i
  );
  if (postpone) return `move ${postpone[1]} to ${postpone[2]}`;

  return text;
}

/**
 * Bare "maths homework tomorrow" / "call mom on friday" → create task.
 * Skip if it already looks like a command or a question.
 */
function rewriteBareTask(text: string): string {
  if (
    /^(?:add|create|make|new|move|mark|delete|complete|finish|change|set|give|reschedule|shift|schedule|show|list|what|which|how|plan|undo|yes|no|nope|nah|cancel|wait|actually|sorry|i meant)\b/i.test(
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

  // "X for/due/by/on DATE"
  const withDue = text.match(
    new RegExp(`^(.+?)\\s+(?:for|due|by|on)\\s+(${DATE_TAIL.source})$`, "i")
  );
  if (withDue) {
    const title = withDue[1].trim();
    if (title.length >= 2) return `add ${title} for ${withDue[2]}`;
  }

  // "X tomorrow/today/…" (date at end, no preposition)
  const trailingDate = text.match(new RegExp(`^(.+?)\\s+(${DATE_TAIL.source})$`, "i"));
  if (trailingDate) {
    const title = trailingDate[1].trim();
    // Avoid turning "what about tomorrow" style into tasks (already filtered)
    if (title.length >= 2 && !/^(?:about|for|by|on|due)$/i.test(title)) {
      return `add ${title} for ${trailingDate[2]}`;
    }
  }

  return text;
}

function rewritePriority(text: string): string {
  if (/most urgent|highest priority|make .+ urgent|priorit(?:y|ise|ize)/i.test(text)) {
    if (/most urgent|highest|priorit/.test(text)) {
      // Leave "most urgent task" path intact; normalize soft variants
      if (/^(?:what(?:'s| is)?|find|get)\s+(?:my\s+)?most urgent/i.test(text)) {
        return "most urgent task priority";
      }
    }
  }
  return text;
}

/** Canonicalize informal user input before the local command matcher runs. */
export function rewriteIntent(input: string): string {
  let text = input.trim();
  if (!text) return text;

  text = stripPolite(text);
  text = rewriteQueries(text);
  text = rewriteDeletes(text);
  text = rewriteCompletes(text);
  text = rewriteMoves(text);
  text = rewritePriority(text);
  text = rewriteCreates(text);
  text = rewriteBareTask(text);

  return text.replace(/\s+/g, " ").trim();
}
