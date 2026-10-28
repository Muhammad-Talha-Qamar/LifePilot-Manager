/**
 * LifePilot phrasebook — dense natural-language knowledge for understanding
 * everyday productivity talk.
 *
 * Sources of practice (adapted, not copied):
 * - Anthropic: context engineering — clear sections, few diverse examples,
 *   act with tools, avoid brittle if/else prompt sprawl in the model path.
 * - OpenAI: function-calling + agent guides — when-to-use tool guidance,
 *   persistence until the request is done, ask only when wrong guesses hurt.
 * - Microsoft CLU: intents = actions, entities = slots; many surface forms
 *   per intent; consistent schema.
 *
 * Local regex NLU uses patterns in intent/understand; the cloud agent gets
 * FEW_SHOT_EXAMPLES + INTENT_GLOSSARY injected into the system prompt.
 */

export type IntentKind =
  | "create_task"
  | "complete"
  | "delete"
  | "query_schedule"
  | "create_checklist"
  | "add_checklist_items"
  | "plan_day"
  | "reschedule"
  | "priority"
  | "undo"
  | "event"
  | "help"
  | "correction";

/** Canonical few-shot pairs: user utterance → what LifePilot should do. */
export const FEW_SHOT_EXAMPLES: Array<{
  user: string;
  intent: IntentKind;
  action: string;
}> = [
  // Creates
  {
    user: "remind me to call mom tomorrow",
    intent: "create_task",
    action: "create_task title=call mom due=tomorrow",
  },
  {
    user: "don't forget to email the tutor",
    intent: "create_task",
    action: "create_task title=email the tutor",
  },
  {
    user: "I gotta submit the form by Friday",
    intent: "create_task",
    action: "create_task title=submit the form due=Friday",
  },
  {
    user: "put dentist on my list for next week",
    intent: "create_task",
    action: "create_task title=dentist due=next week (resolve to a day if needed)",
  },
  {
    user: "Add homework for tomorrow.",
    intent: "create_task",
    action: "create_task title=homework due=tomorrow",
  },
  {
    user: "Put homework on tomorrow's list.",
    intent: "create_task",
    action: "create_task title=homework due=tomorrow",
  },
  {
    user: "Can you schedule my homework for tomorrow?",
    intent: "create_task",
    action: "create_task title=homework due=tomorrow (schedule+object = create, not query)",
  },
  {
    user: "I need to do my homework tomorrow. Add it to my tasks.",
    intent: "create_task",
    action: "create_task title=homework due=tomorrow (use primary obligation clause)",
  },
  {
    user: "make it Friday",
    intent: "correction",
    action: "update focused task due_date=Friday; do NOT create duplicate",
  },
  {
    user: "Friday instead",
    intent: "correction",
    action: "update focused task due_date=Friday",
  },
  {
    user: "change it to Friday",
    intent: "reschedule",
    action: "update focused / pronoun task due_date=Friday",
  },
  {
    user: "finish homework",
    intent: "complete",
    action: "search homework → complete_task",
  },
  {
    user: "todo: buy milk",
    intent: "create_task",
    action: "create_task title=buy milk",
  },
  {
    user: "maths homework tomorrow",
    intent: "create_task",
    action: "create_task title=maths homework due=tomorrow",
  },
  {
    user: "can you jot down stretch tonight pls",
    intent: "create_task",
    action: "create_task title=stretch due=tonight→today evening",
  },
  {
    user: "mujhe yaad dilao kal doctor ke paas jana",
    intent: "create_task",
    action: "create_task title=doctor ke paas jana due=tomorrow",
  },
  {
    user: "recuérdame pagar la renta el viernes",
    intent: "create_task",
    action: "create_task title=pagar la renta due=Friday",
  },
  {
    user: "I'm hoping to finish the draft this week",
    intent: "create_task",
    action: "create_task title=finish the draft due=this week→ask for day if ambiguous OR use end of week",
  },
  {
    user: "ping me to water plants",
    intent: "create_task",
    action: "create_task title=water plants",
  },
  {
    user: "add buy eggs, bread, and butter for tomorrow",
    intent: "create_task",
    action: "prefer one task unless user asked for a list; if clearly groceries→checklist",
  },

  // Completes
  {
    user: "done with the essay",
    intent: "complete",
    action: "search essay → complete_task or checklist item",
  },
  {
    user: "the lab report is finished",
    intent: "complete",
    action: "complete matching task",
  },
  {
    user: "just wrapped maths homework",
    intent: "complete",
    action: "complete matching task",
  },
  {
    user: "check off milk",
    intent: "complete",
    action: "complete checklist item milk if found, else task",
  },
  {
    user: "essay — done",
    intent: "complete",
    action: "complete matching task",
  },
  {
    user: "mark the second one complete",
    intent: "complete",
    action: "use conversation lastTasks ordinal",
  },

  // Queries
  {
    user: "today?",
    intent: "query_schedule",
    action: "query_schedule period=today",
  },
  {
    user: "what's left",
    intent: "query_schedule",
    action: "query_schedule period=today",
  },
  {
    user: "am I free tomorrow",
    intent: "query_schedule",
    action: "query_schedule period=tomorrow",
  },
  {
    user: "catch me up",
    intent: "query_schedule",
    action: "query_schedule period=today + mention overdue",
  },
  {
    user: "how packed is this week",
    intent: "query_schedule",
    action: "query_schedule period=this_week + workload tone",
  },
  {
    user: "show overdue",
    intent: "query_schedule",
    action: "query_schedule period=overdue",
  },
  {
    user: "tasks with no deadline",
    intent: "query_schedule",
    action: "query_schedule period=no_deadline",
  },
  {
    user: "aaj kya hai",
    intent: "query_schedule",
    action: "query_schedule period=today",
  },

  // Checklists
  {
    user: "shopping list: milk, eggs, bread",
    intent: "create_checklist",
    action: "create_checklist title=Groceries items=[milk,eggs,bread]",
  },
  {
    user: "make a packing list with passport and charger",
    intent: "create_checklist",
    action: "create_checklist title=Packing items=[passport,charger]",
  },
  {
    user: "add eggs and butter to groceries",
    intent: "add_checklist_items",
    action: "find groceries checklist → add_checklist_items",
  },
  {
    user: "checklist for science exam with chapter 3 and formulas",
    intent: "create_checklist",
    action: "create_checklist title≈science exam items=[chapter 3, formulas]",
  },

  // Plans / priority / events / undo / corrections
  {
    user: "what should I focus on today",
    intent: "plan_day",
    action: "query_schedule today → suggest ordered plan (not saved unless asked)",
  },
  {
    user: "help me plan my morning",
    intent: "plan_day",
    action: "plan around today's open work",
  },
  {
    user: "make the essay urgent",
    intent: "priority",
    action: "search essay → update_task priority=urgent",
  },
  {
    user: "most urgent task",
    intent: "priority",
    action: "raise highest open task to urgent if not already",
  },
  {
    user: "move maths homework to Friday",
    intent: "reschedule",
    action: "search → update_task due_date=Friday",
  },
  {
    user: "postpone the dentist until next Monday",
    intent: "reschedule",
    action: "search dentist → update due",
  },
  {
    user: "schedule a meeting with Ali tomorrow at 3pm",
    intent: "event",
    action: "create_event title=meeting with Ali start=tomorrow 15:00",
  },
  {
    user: "exam on Saturday",
    intent: "event",
    action: "create_event type=exam title=exam day=Saturday (clarify title if bare)",
  },
  {
    user: "undo that",
    intent: "undo",
    action: "undo_last_change",
  },
  {
    user: "no I meant next Friday",
    intent: "correction",
    action: "update focused record date; do NOT create duplicate",
  },
  {
    user: "actually make it urgent",
    intent: "correction",
    action: "update focused record priority",
  },
  {
    user: "delete the duplicate",
    intent: "delete",
    action: "ask confirm → delete_task confirmed",
  },
  {
    user: "add milk to groceries and mark the essay done",
    intent: "create_task",
    action: "MULTI: add_checklist_items then complete_task — finish both",
  },
  {
    user: "what can you do",
    intent: "help",
    action: "short capabilities reply; invite a natural request",
  },
];

/** Human-readable glossary for the system prompt. */
export const INTENT_GLOSSARY = `
## Intent map (actions you can take)

CREATE TASK — any obligation the user wants remembered:
  remind me / don't forget / ping me / nudge me / note / todo: / task: /
  I need to / I have to / I gotta / I should / I wanna / I'm gonna /
  put X on my list / jot down / write down / keep track of / log /
  bare "title + date" ("call mom Friday") / schedule X (when not planning the day)

COMPLETE — work finished:
  done / finished / completed / wrapped up / knocked out / sorted /
  check off / cross off / tick off / X is done / just finished X / X — done

QUERY SCHEDULE — look up saved work (always use query_schedule tool):
  today? / tomorrow / this week / next week / this month / next month /
  what's left / what's pending / what's on / catch me up / rundown / briefing /
  am I free / how busy / how packed / overdue / no deadline / my agenda

CHECKLIST — multi-item lists:
  shopping/grocery/packing list: a, b / make a list of … / checklist for … with …
  add X to my … checklist / add eggs to groceries

PLAN — suggested order (not saved unless asked):
  plan my day / what should I focus on / help me organize my morning

RESCHEDULE — change a due date:
  move X to … / postpone X until … / change deadline of X to … / push back …

PRIORITY — urgency:
  make X urgent / high priority / most urgent task

EVENT — calendar:
  meeting / appointment / exam / event on DATE at TIME

DELETE — destructive; confirm first:
  delete / remove / trash / get rid of / bin

UNDO — reverse last supported write:
  undo / take that back / reverse that

CORRECTION — fix previous create/update; never duplicate:
  no I meant … / actually … / change that to … / wait, make it …
`.trim();

/** Persistence / eagerness block (OpenAI agent prompting pattern). */
export const PERSISTENCE_RULES = `
## Persistence
- You are an agent. Keep going until the user's request is fully handled.
- Prefer acting with tools when intent is reasonably clear.
- Only ask one short clarifying question when a wrong guess would create the wrong record or wrong date.
- Multi-part messages ("add milk to groceries and mark the essay done") → call tools in order until every part is done.
- After tools succeed, say exactly what changed using verified results. Never claim success without a tool confirmation.
- Do not stop early with a vague "I can help with that" when you could call a tool now.
`.trim();

/** Decision heuristics for ambiguous language. */
export const DECISION_HEURISTICS = `
## Decision heuristics
- Bare noun + date → create task (not a question).
- Question words / "?", "left", "free", "busy", "on my plate" → query, do not create.
- "List:" or comma-separated shopping/packing items → checklist, not one task.
- "Schedule my day/week" → plan/query; "schedule a call with …" → create task or event.
- Pronouns (it / that / the second one) → conversation focus / lastTasks; search_records if unsure.
- Relative dates → resolve_date or query_schedule; next month = next calendar month.
- Tasks without deadlines are NOT due today.
- Completed tasks are never listed as still open.
- Projects are not supported — use tasks or checklists instead.
- Typos, slang, voice-to-text mess, and mixed languages are normal — infer intent.
- Match the user's language when replying when practical.
`.trim();

/** Compact few-shot block for system prompt injection — sample across intent families. */
export function fewShotPromptBlock(limit = 36): string {
  const byIntent = new Map<IntentKind, typeof FEW_SHOT_EXAMPLES>();
  for (const ex of FEW_SHOT_EXAMPLES) {
    const list = byIntent.get(ex.intent) ?? [];
    list.push(ex);
    byIntent.set(ex.intent, list);
  }
  const picked: typeof FEW_SHOT_EXAMPLES = [];
  const intents = [...byIntent.keys()];
  let guard = 0;
  while (picked.length < limit && guard < limit * 3) {
    for (const intent of intents) {
      const list = byIntent.get(intent);
      if (!list?.length) continue;
      picked.push(list.shift()!);
      if (picked.length >= limit) break;
    }
    guard += 1;
  }
  const lines = picked.map((ex, i) => `${i + 1}. User: "${ex.user}" → ${ex.action}`);
  return `## Few-shot understanding examples\n${lines.join("\n")}`;
}

/** Build a short local-NLU hint for the cloud model. */
export function localInterpretationHint(
  original: string,
  interpreted: string | null,
  kind: "command" | "reply" | "pass" | "rewritten"
): string {
  if (kind === "reply") {
    return `Local NLU thinks this is small talk / help (no data change). Still reply helpfully.`;
  }
  if (kind === "command" || kind === "rewritten") {
    if (interpreted && interpreted.trim().toLowerCase() !== original.trim().toLowerCase()) {
      return `Local NLU paraphrase (heuristic, may be imperfect — verify with tools):\n"${interpreted}"`;
    }
  }
  return `Local NLU did not rewrite this; interpret freely with tools.`;
}
