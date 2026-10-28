import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { CalendarEvent, ChecklistItem, Project, Task } from "@/types";
import {
  calendarToday,
  detectPeriodKind,
  formatDateOnly,
  priorityWeight,
  resolveDatePhrase,
} from "@/lib/utils/dates";
import {
  scheduleBlocks,
  toChecklistCard,
  toEventCard,
  toProjectCard,
  toTaskCard,
} from "./blocks";
import {
  interpretationBlock,
  resolveInterpretation,
} from "./interpretation";
import { interpretUtterance } from "./interpret";
import { rewriteIntent } from "./intent";
import {
  cleanPhrase,
  normalizeCommand,
  normalizeText,
  ordinalIndex,
  pickUnique,
  rankByName,
  scoreName,
  selectionCount,
  titleCase,
} from "./match";
import { understandInput } from "./understand";
import type {
  AssistantBlock,
  Board,
  ConversationContext,
  PendingAction,
  ScheduleQueryResult,
} from "./types";
import { friendlyFailure } from "./user-messages";

export interface ToolOutcome {
  success: boolean;
  result: unknown;
  error?: string;
}

export type ToolHandler = (
  name: string,
  args: Record<string, unknown>
) => Promise<ToolOutcome>;

export interface LocalCommandResult {
  message: string;
  blocks: AssistantBlock[];
  context: ConversationContext;
}

function cloneContext(context: ConversationContext): ConversationContext {
  return {
    lastTasks: [...(context.lastTasks ?? [])],
    lastItems: [...(context.lastItems ?? [])],
    undo: [...(context.undo ?? [])],
    lastProject: context.lastProject ?? null,
    lastChecklist: context.lastChecklist ?? null,
    focus: context.focus ?? null,
    pending: context.pending ?? null,
    pendingClarification: context.pendingClarification ?? null,
    pendingInterpretation: context.pendingInterpretation ?? null,
  };
}

function withInterpretation(
  result: LocalCommandResult,
  interpBlock: AssistantBlock | null
): LocalCommandResult {
  if (!interpBlock) return result;
  return {
    ...result,
    blocks: [interpBlock, ...result.blocks],
  };
}

function isAffirmative(norm: string): boolean {
  return /^(?:yes|yeah|yep|yup|sure|correct|right|exactly|please|ok|okay|do it|go ahead|confirm)$/i.test(
    norm
  );
}

function isNegative(norm: string): boolean {
  return /^(?:no|nope|nah|cancel|never ?mind|wrong|incorrect)$/i.test(norm);
}

function failed(action: string, error?: string): string {
  return friendlyFailure(action, error);
}

function taskFrom(result: unknown): Task | null {
  if (!result || typeof result !== "object" || !("id" in result) || !("title" in result)) {
    return null;
  }
  return result as Task;
}

function rememberTask(context: ConversationContext, task: Task) {
  context.focus = { kind: "task", id: task.id, label: task.title, detail: task.due_date };
  context.lastTasks = [
    { id: task.id, title: task.title },
    ...(context.lastTasks ?? []).filter((item) => item.id !== task.id),
  ].slice(0, 20);
}

function rememberProject(context: ConversationContext, project: Project) {
  context.focus = { kind: "project", id: project.id, label: project.name, detail: project.deadline };
  context.lastProject = { id: project.id, name: project.name };
}

function rememberChecklist(
  context: ConversationContext,
  checklist: { id: string; title: string },
  items: ChecklistItem[]
) {
  context.focus = { kind: "checklist", id: checklist.id, label: checklist.title };
  context.lastChecklist = { id: checklist.id, title: checklist.title };
  context.lastItems = [...items]
    .sort((a, b) => a.position - b.position)
    .map((item) => ({
      id: item.id,
      title: item.title,
      checklist_id: checklist.id,
    }));
}

function tasksAbout(phrase: string, tasks: Task[]): Task[] {
  const tokens = normalizeText(phrase)
    .split(" ")
    .filter((token) => token.length > 3 && !["task", "tasks", "into", "that", "this", "project"].includes(token));
  if (!tokens.length) return [];
  return tasks.filter((task) => {
    const hay = normalizeText(
      `${task.title} ${task.description ?? ""} ${task.category ?? ""} ${(task.tags ?? []).join(" ")}`
    );
    return tokens.some((token) => hay.includes(token));
  });
}

function parseClock(phrase: string): string | "ambiguous" | null {
  const match = phrase.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] ?? "00";
  const meridiem = match[3];
  if (!meridiem) return "ambiguous";
  if (hour < 1 || hour > 12) return null;
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${minute}`;
}

function chapterItems(text: string): string[] | null {
  const range = text.match(/chapters?\s+(\d+)\s*(?:to|-|through)\s*(\d+)/i);
  if (range) {
    const start = Number(range[1]);
    const end = Number(range[2]);
    if (end < start || end - start > 30) return null;
    const verb = /revis/i.test(text) ? "Revise" : "Review";
    return Array.from({ length: end - start + 1 }, (_, index) => `${verb} chapter ${start + index}`);
  }
  const single = text.match(/chapter\s+(\d+)/i);
  if (!single) return null;
  const verb = /revis/i.test(text) ? "Revise" : "Review";
  return [`${verb} chapter ${single[1]}`];
}

/** Split "milk and eggs" / "milk, eggs, bread" into checklist item titles. */
function parseItemList(text: string): string[] {
  const cleaned = cleanPhrase(text);
  if (!cleaned) return [];
  return cleaned
    .split(/\s*,\s*|\s+and\s+/i)
    .map((part) => cleanPhrase(part))
    .filter(Boolean);
}

/** Pull title + optional "with …" / ": …" items from a checklist create phrase. */
function extractChecklistTitleAndItems(raw: string): { title: string; items: string[] } {
  // "… checklist to it with A and B" (title comes from the linked project later)
  const attachedWith = raw.match(/\bchecklist\b\s+to\s+it\s+with\s+(.+)$/i)?.[1];
  if (attachedWith) {
    return { title: "New checklist", items: parseItemList(attachedWith) };
  }

  const named = raw.match(/checklist\s+(?:for|called|named|titled)\s+(.+)/i)?.[1];
  if (named) {
    const body = named.replace(/^my\s+/i, "").trim();
    const withItems = body.match(/^(.+?)\s+with\s+(.+)$/i) || body.match(/^(.+?)\s*:\s*(.+)$/);
    if (withItems) {
      return {
        title: titleCase(cleanPhrase(withItems[1]) || "New checklist"),
        items: parseItemList(withItems[2]),
      };
    }
    return {
      title: titleCase(cleanPhrase(body) || "New checklist"),
      items: [],
    };
  }

  const trailingWith = raw.match(/\bchecklist\b\s+with\s+(.+)$/i)?.[1];
  if (trailingWith) {
    return { title: "New checklist", items: parseItemList(trailingWith) };
  }

  return { title: "New checklist", items: [] };
}

function isAddingItemsToChecklist(norm: string, context: ConversationContext): boolean {
  if (!/^add\b/.test(norm)) return false;
  if (/\b(?:a|an|new)\s+checklist\b/.test(norm)) return false;
  if (/\bto (?:my |the )?.+?\s+checklist\b/.test(norm)) return true;
  if (/\bto\s+(?:it|that|this)\b/.test(norm) && context.lastChecklist) return true;
  return false;
}

function isYes(text: string): boolean {
  return /^(yes|yep|yeah|yup|sure|ok|okay|y|confirm|do it|go ahead|sounds good|absolutely|delete it|yes delete(?: it)?|please delete(?: it)?)$/.test(
    text
  );
}

function isNo(text: string): boolean {
  return /^(no|nope|nah|cancel|stop|don't|do not|never mind|nevermind|n)$/.test(text);
}

function isUndo(text: string): boolean {
  return /^(?:please )?(?:undo|undo that|undo it|undo the last change|take that back|reverse that|reverse the last change|oops undo)$/.test(
    text
  );
}

function askAmbiguous(names: string[], noun: string): string {
  return `I found more than one ${noun}: ${names.map((name) => `“${name}”`).join(", ")}. Which one do you mean?`;
}

function focusedTask(
  board: Board,
  context: ConversationContext
): Task | null {
  if (context.focus?.kind === "task") {
    const task = board.tasks.find((item) => item.id === context.focus?.id);
    if (task) return task;
  }
  const recent = context.lastTasks?.[0];
  if (recent) {
    const task = board.tasks.find((item) => item.id === recent.id);
    if (task) return task;
  }
  return null;
}

function resolveTaskPhrase(
  phrase: string,
  board: Board,
  context: ConversationContext
): { tasks: Task[] } | { ask: string } | { none: string } {
  const text = normalizeCommand(phrase);
  const pronoun =
    /^(?:it|that|this|that task|this task|that one|this one)$/.test(text) ||
    /\b(it|that task|this task|that one|this one)\b/.test(text);

  if (pronoun) {
    const task = focusedTask(board, context);
    if (task) return { tasks: [task] };
    if ((context.lastTasks?.length ?? 0) > 1) {
      return {
        ask: askAmbiguous(
          (context.lastTasks ?? []).slice(0, 5).map((item) => item.title),
          "task"
        ),
      };
    }
    return {
      none: "Which task do you mean? Mention its name, or create one first.",
    };
  }
  if (/\b(those|them|those tasks|these tasks)\b/.test(text) && context.lastTasks?.length) {
    const tasks = context.lastTasks
      .map((ref) => board.tasks.find((task) => task.id === ref.id))
      .filter((task): task is Task => Boolean(task));
    if (tasks.length) return { tasks };
  }
  const index = ordinalIndex(text);
  if (index !== null && context.lastTasks?.length) {
    const ref = context.lastTasks[index];
    const task = ref ? board.tasks.find((item) => item.id === ref.id) : undefined;
    if (!task) return { none: `There is no item ${index + 1} in the last list.` };
    return { tasks: [task] };
  }
  const ranked = rankByName(
    phrase,
    board.tasks.filter((task) => task.status !== "cancelled"),
    (task) => `${task.title} ${task.category ?? ""} ${(task.tags ?? []).join(" ")}`
  );
  const picked = pickUnique(ranked);
  if ("none" in picked) {
    // Weak name match + recent focus: prefer the focused task when the phrase is emptyish.
    if (!cleanPhrase(phrase)) {
      const task = focusedTask(board, context);
      if (task) return { tasks: [task] };
    }
    return { none: `I couldn't find a task matching “${cleanPhrase(phrase)}”.` };
  }
  if ("ambiguous" in picked) return { ask: askAmbiguous(picked.ambiguous.map((task) => task.title), "task") };
  return { tasks: [picked.match] };
}

function resolveProjectPhrase(
  phrase: string,
  board: Board,
  context: ConversationContext
): { project: Project } | { ask: string } | { none: string } {
  const text = normalizeCommand(phrase);
  if (/\b(it|that project|this project|that|this)\b/.test(text) && context.lastProject) {
    const project = board.projects.find((item) => item.id === context.lastProject?.id);
    if (project) return { project };
  }
  const ranked = rankByName(phrase, board.projects, (project) => project.name);
  const picked = pickUnique(ranked);
  if ("none" in picked) return { none: `I couldn't find a project matching “${cleanPhrase(phrase)}”.` };
  if ("ambiguous" in picked) {
    return { ask: askAmbiguous(picked.ambiguous.map((project) => project.name), "project") };
  }
  return { project: picked.match };
}

function resolveChecklist(
  phrase: string,
  board: Board,
  context: ConversationContext
): { checklist: Board["checklists"][number] } | { ask: string } | { none: string } {
  const text = normalizeCommand(phrase);
  if (
    (/\b(it|that checklist|this checklist|that|this)\b/.test(text) || !cleanPhrase(phrase)) &&
    context.lastChecklist
  ) {
    const checklist = board.checklists.find((item) => item.id === context.lastChecklist?.id);
    if (checklist) return { checklist };
  }
  const index = ordinalIndex(text);
  if (index !== null && context.lastChecklist) {
    const checklist = board.checklists.find((item) => item.id === context.lastChecklist?.id);
    if (checklist) return { checklist };
  }
  if (!cleanPhrase(phrase) || /^(it|that|this|the checklist)$/.test(text)) {
    if (board.checklists.length === 1) return { checklist: board.checklists[0] };
    if (context.lastChecklist) {
      const checklist = board.checklists.find((item) => item.id === context.lastChecklist?.id);
      if (checklist) return { checklist };
    }
  }
  const ranked = rankByName(phrase, board.checklists, (checklist) => checklist.title);
  const picked = pickUnique(ranked);
  if ("none" in picked) {
    if (context.lastChecklist) {
      const checklist = board.checklists.find((item) => item.id === context.lastChecklist?.id);
      if (checklist) return { checklist };
    }
    return { none: `I couldn't find a checklist matching “${cleanPhrase(phrase) || "that"}”.` };
  }
  if ("ambiguous" in picked) {
    return { ask: askAmbiguous(picked.ambiguous.map((checklist) => checklist.title), "checklist") };
  }
  return { checklist: picked.match };
}

function projectTasks(project: Project, tasks: Task[]): Task[] {
  return tasks.filter((task) => task.project_id === project.id && task.status !== "cancelled");
}

function confirm(summary: string, action: PendingAction, context: ConversationContext): LocalCommandResult {
  context.pending = action;
  return {
    message: summary,
    blocks: [{ type: "confirm", prompt: summary, action }],
    context,
  };
}

async function runQuery(
  norm: string,
  board: Board,
  context: ConversationContext,
  act: ToolHandler
): Promise<LocalCommandResult | null> {
  if (/project/.test(norm) && /incomplete|open|active|unfinished|not done/.test(norm)) {
    const result = await act("list_projects", { incomplete_only: true });
    if (!result.success) return { message: failed("load projects", result.error), blocks: [], context };
    const projects = (result.result as Project[]).filter(
      (project) => project.status === "active" || project.status === "on_hold"
    );
    const cards = projects.map((project) =>
      toProjectCard(project, board.tasks, board.checklists.flatMap((checklist) => checklist.items))
    );
    return {
      message: projects.length
        ? `You have ${projects.length} incomplete project(s): ${projects.map((project) => project.name).join(", ")}.`
        : "You have no incomplete projects.",
      blocks: [{ type: "projects", title: "Incomplete projects", projects: cards }],
      context,
    };
  }

  if (
    /\bchecklist/.test(norm) &&
    /\b(show|list|what|which|my|see|view|display)\b/.test(norm) &&
    !/^(?:add|create|make|start|delete|mark|complete|finish)\b/.test(norm)
  ) {
    const result = await act("list_checklists", { include_items: true });
    if (!result.success) return { message: failed("load checklists", result.error), blocks: [], context };
    const checklists = (result.result as Board["checklists"]) ?? board.checklists;
    const cards = checklists.map((checklist) =>
      toChecklistCard(checklist, checklist.items ?? [], board.projects)
    );
    if (checklists[0]) {
      rememberChecklist(context, checklists[0], checklists[0].items ?? []);
    }
    return {
      message: checklists.length
        ? `You have ${checklists.length} checklist(s): ${checklists.map((checklist) => checklist.title).join(", ")}.`
        : "You have no checklists yet.",
      blocks: checklists.length
        ? [{ type: "checklists", title: "Your checklists", checklists: cards }]
        : [],
      context,
    };
  }

  const period = detectPeriodKind(norm);
  const ranged = norm.match(/\bfrom\s+(\d{4}-\d{2}-\d{2})\s+(?:to|through)\s+(\d{4}-\d{2}-\d{2})\b/);
  if (
    !period &&
    !ranged &&
    !/\b(what|show|list|which|how much|how many|see|view|display|tell me|give me|any(?:thing)?)\b/.test(
      norm
    )
  ) {
    return null;
  }
  if (!period && !ranged) return null;

  const args = ranged
    ? { period: "range", from: ranged[1], to: ranged[2] }
    : { period: period! };
  const result = await act("query_schedule", args);
  if (!result.success || !result.result) {
    return { message: failed("look up that schedule", result.error), blocks: [], context };
  }
  const schedule = result.result as ScheduleQueryResult;
  context.lastTasks = schedule.tasks.map((task) => ({ id: task.id, title: task.title }));
  const summary = describeSchedule(schedule, /how much work/.test(norm));
  return {
    message: summary,
    blocks: scheduleBlocks(schedule, board.projects),
    context,
  };
}

function describeSchedule(result: ScheduleQueryResult, workload: boolean): string {
  const lines: string[] = [];
  const taskWord = result.tasks.length === 1 ? "task" : "tasks";
  const eventWord = result.events.length === 1 ? "event" : "events";
  const overdueWord = result.overdue_tasks.length === 1 ? "task" : "tasks";
  if (workload) {
    lines.push(
      `This week you have ${result.tasks.length} open ${taskWord} (about ${result.estimated_minutes} minutes), ${result.events.length} ${eventWord}, and ${result.overdue_tasks.length} overdue ${overdueWord} from earlier.`
    );
  } else {
    lines.push(
      result.tasks.length === 0
        ? `${result.period.label}: nothing open on your list for this period.`
        : `${result.period.label}: ${result.tasks.length} open ${taskWord}.`
    );
  }
  if (result.tasks.length === 0) {
    lines.push(
      result.period.kind === "no_deadline"
        ? "Every open task already has a deadline."
        : "Nothing open falls in that period. Tasks without a deadline are left out of this list."
    );
  } else {
    for (const task of result.tasks) {
      const project = result.projects.find((item) => item.id === task.project_id);
      lines.push(
        `• ${task.title} — ${task.priority} priority, ${task.status === "done" ? "done" : "not done yet"}, due ${task.due_date ? formatDateOnly(task.due_date) : "no deadline"}${task.due_time ? ` at ${task.due_time.slice(0, 5)}` : ""}${project ? `, in ${project.name}` : ""}`
      );
    }
  }
  if (result.overdue_tasks.length) {
    lines.push("Still overdue from earlier (listed separately):");
    for (const task of result.overdue_tasks) {
      lines.push(`• ${task.title} — due ${formatDateOnly(task.due_date)}, ${task.priority}`);
    }
  }
  if (result.events.length) {
    lines.push("Events:");
    for (const event of result.events) lines.push(`• ${event.title} (${event.event_type})`);
  } else if (result.period.kind === "today" || result.period.kind === "tomorrow") {
    lines.push("No events in that period.");
  }
  if (result.completed_omitted) {
    const doneWord = result.completed_omitted === 1 ? "task" : "tasks";
    lines.push(
      `${result.completed_omitted} finished ${doneWord} from this period are not shown as still open.`
    );
  }
  if (!workload && result.period.kind !== "overdue" && result.period.kind !== "no_deadline" && result.tasks.length > 0) {
    lines.push(`About ${result.estimated_minutes} minutes for the open tasks.`);
  }
  return lines.join("\n");
}

function buildPlan(
  schedule: ScheduleQueryResult,
  board: Board
): Extract<AssistantBlock, { type: "schedule" }> {
  const start = board.workStart ?? "09:00";
  const [hours, minutes] = start.split(":").map(Number);
  let cursor = hours * 60 + minutes;
  const slots: { time_label: string; title: string; minutes: number; task_id?: string; kind: "task" | "event" }[] = [];
  for (const event of schedule.events) {
    slots.push({
      time_label: event.all_day
        ? "All day"
        : formatInTimeZone(new Date(event.start_at), board.timezone, "HH:mm"),
      title: event.title,
      minutes: 0,
      kind: "event",
    });
  }
  const ordered = [...schedule.overdue_tasks, ...schedule.tasks];
  for (const task of ordered) {
    const length = task.estimated_minutes ?? board.defaultDuration;
    const label = `${String(Math.floor(cursor / 60)).padStart(2, "0")}:${String(cursor % 60).padStart(2, "0")}`;
    slots.push({ time_label: label, title: task.title, minutes: length, task_id: task.id, kind: "task" });
    cursor += length;
  }
  return {
    type: "schedule",
    title: "Suggested day",
    saved: false,
    note: "This is a suggestion. It has not been saved to your calendar.",
    slots,
  };
}

export async function runLocalCommand(
  raw: string,
  incoming: ConversationContext,
  board: Board,
  act: ToolHandler
): Promise<LocalCommandResult> {
  const context = cloneContext(incoming);

  // Resolve a pending "Did you mean …?" before anything else.
  if (context.pendingInterpretation) {
    const answer = normalizeCommand(raw);
    if (isAffirmative(answer)) {
      const accepted = context.pendingInterpretation.acceptedText;
      context.pendingInterpretation = null;
      return runLocalCommand(accepted, context, board, act);
    }
    if (isNegative(answer)) {
      context.pendingInterpretation = null;
      return {
        message: "Got it — I left everything as it is. Tell me what you meant.",
        blocks: [],
        context,
      };
    }
    // User rephrased — drop the pending ask and continue with the new text.
    context.pendingInterpretation = null;
  }

  // Google-like spelling / intent surface interpretation (before acting).
  const decision = resolveInterpretation(raw);
  const interpBlock = interpretationBlock(decision);

  if (decision.clarification) {
    context.pendingInterpretation = {
      question: decision.clarification,
      acceptedText: decision.interpreted.replace(/\.$/, ""),
    };
    return {
      message: decision.clarification,
      blocks: interpBlock ? [interpBlock] : [],
      context,
    };
  }

  // Free-form NLU first: greetings, soft creates/completes/queries, then intent rewrite.
  // Prefer the surface-corrected text so typos reach understand/rewrite cleanly.
  const inputForNlu = decision.showInterpretation
    ? decision.interpreted.replace(/\.$/, "")
    : raw;

  const coreResult = await (async (): Promise<LocalCommandResult> => {
  const understood = understandInput(inputForNlu);
  if (understood.kind === "reply") {
    return { message: understood.message, blocks: [], context };
  }

  let rewritten =
    understood.kind === "command"
      ? understood.text
      : rewriteIntent(inputForNlu);

  // Recover via phrasebook intent+slots only when we still lack a canonical verb.
  const rewrittenNorm = normalizeCommand(rewritten);
  const looksCanonical =
    /^(?:add|create|make|new|move|mark|delete|complete|finish|show|list|plan|undo|schedule|set|remove|postpone|reschedule|shift)\b/.test(
      rewrittenNorm
    ) ||
    /^(?:no|nope|wait|actually|sorry)\b.+\b(?:i meant|make it|change it)\b/.test(rewrittenNorm) ||
    /^i meant\b/.test(rewrittenNorm);
  if (!looksCanonical) {
    const interpreted = interpretUtterance(inputForNlu);
    if (interpreted.canonical && interpreted.confidence >= 0.22) {
      rewritten = interpreted.canonical;
    }
  }

  const workingRaw =
    rewritten.trim().toLowerCase() !== inputForNlu.trim().toLowerCase()
      ? rewritten
      : inputForNlu;
  const norm = normalizeCommand(workingRaw);

  // Only block explicit project create/manage — not every mention of the word.
  if (
    /\bprojects?\b/.test(norm) &&
    /^(?:add|create|make|new|delete|move|list|show|update)\b/.test(norm)
  ) {
    return {
      message:
        "Projects aren't available in LifePilot. Use a task or checklist instead.",
      blocks: [],
      context,
    };
  }

  const correction = norm.match(
    /^(?:no|nope|wait|actually|sorry)[, ]+(?:i meant|make it|change it to|it should be|that should be)\s+(.+)$/
  ) || norm.match(/^i meant\s+(.+)$/);
  if (correction) {
    return correctFocused(correction[1], workingRaw, context, board, act);
  }

  // Short follow-ups with focus: bare date / "friday instead" / "make it friday"
  if (
    context.focus?.kind === "task" &&
    !/^(?:add|create|make|new|show|what|list|delete|plan|mark|complete|finish|schedule)\b/.test(
      norm
    )
  ) {
    const focusDate =
      norm.match(/^(?:make it|change it(?: to)?|set it(?: to)?|move it(?: to)?)\s+(.+)$/) ||
      norm.match(/^(.+)\s+instead$/) ||
      (/^(today|tonight|tomorrow|yesterday|this \w+|next \w+|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/.test(
        norm
      )
        ? (["", norm] as unknown as RegExpMatchArray)
        : null);
    if (focusDate?.[1]) {
      return correctFocused(focusDate[1], workingRaw, context, board, act);
    }
  }

  if (context.pending && isYes(norm)) {
    const pending = context.pending;
    const result = await act(pending.tool, { ...pending.args, confirmed: true });
    context.pending = null;
    if (!result.success) {
      return { message: failed("complete that delete", result.error), blocks: [], context };
    }
    return {
      message: `Deleted. ${pending.summary.replace(/\?$/, "").replace(/^Delete /, "Removed ")}`,
      blocks: [{ type: "notice", tone: "success", text: "Deleted." }],
      context,
    };
  }

  if (context.pending && isNo(norm)) {
    context.pending = null;
    return {
      message: "Cancelled. I did not delete anything.",
      blocks: [],
      context,
    };
  }

  if (
    context.pendingClarification &&
    !/^(add|create|make|show|what|move|delete|plan|which|list|mark|complete|finish|schedule)\b/.test(
      norm
    )
  ) {
    const clarified = await applyClarification(norm, workingRaw, context, board, act);
    if (clarified) return clarified;
  } else if (context.pendingClarification) {
    context.pendingClarification = null;
  }

  if (isUndo(norm)) {
    const result = await act("undo_last_change", {});
    if (!result.success) return { message: failed("undo that", result.error), blocks: [], context };
    const payload = result.result as { undone?: string; result?: unknown };
    const task = taskFrom(payload?.result);
    return {
      message: task
        ? `Undid the last change. “${task.title}” is now ${task.status}${task.due_date ? `, due ${formatDateOnly(task.due_date)}` : ""}.`
        : `Undid the last change${payload?.undone ? `: ${payload.undone}` : ""}.`,
      blocks: task
        ? [{ type: "tasks", title: "Updated task", tasks: [toTaskCard(task, board.projects, board.timezone)] }]
        : [],
      context,
    };
  }

  if (/plan (?:my |the )?(?:day|today)\b|^plan my day\b/.test(norm)) {
    const result = await act("query_schedule", { period: "today" });
    if (!result.success) return { message: failed("plan the day", result.error), blocks: [], context };
    const schedule = result.result as ScheduleQueryResult;
    const block = buildPlan(schedule, board);
    return {
      message: block.slots.length
        ? `Here is a suggested plan for today: ${block.slots.map((slot) => `${slot.time_label} ${slot.title}`).join("; ")}. It is not saved on the calendar.`
        : "There are no incomplete tasks or events today to plan around. I did not save a schedule.",
      blocks: [block, ...scheduleBlocks(schedule, board.projects)],
      context,
    };
  }

  if (/plan (?:my |the )?next month\b/.test(norm)) {
    const result = await act("query_schedule", { period: "next_month" });
    if (!result.success) return { message: failed("plan next month", result.error), blocks: [], context };
    const schedule = result.result as ScheduleQueryResult;
    const slots = schedule.tasks.map((task) => ({
      time_label: task.due_date ? formatDateOnly(task.due_date) : "No deadline",
      title: task.title,
      minutes: task.estimated_minutes ?? board.defaultDuration,
      task_id: task.id,
      kind: "task" as const,
    }));
    return {
      message: `Next calendar month (${schedule.period.label}) has ${schedule.tasks.length} incomplete task(s). This plan is only a suggestion and has not been saved.`,
      blocks: [
        {
          type: "schedule",
          title: `Suggested plan · ${schedule.period.label}`,
          saved: false,
          note: "Not saved. This is the next calendar month, not the next 30 days.",
          slots,
        },
        ...scheduleBlocks(schedule, board.projects),
      ],
      context,
    };
  }

  const isMutation =
    /^(?:please\s+)?(?:add|create|make|new|move|mark|delete|complete|finish|change|set|give|reschedule|shift|schedule|put|assign|remove|postpone)\b/.test(
      norm
    );
  if (!isMutation) {
    const queried = await runQuery(norm, board, context, act);
    if (queried) return queried;
  }

  if (/most urgent task/.test(norm) && /priority|urgent/.test(norm)) {
    const open = board.tasks.filter((task) => task.status === "todo" || task.status === "in_progress");
    const chosen = [...open].sort((a, b) => {
      const byPriority = priorityWeight(b.priority) - priorityWeight(a.priority);
      if (byPriority) return byPriority;
      return (a.due_date ?? "9999-99-99").localeCompare(b.due_date ?? "9999-99-99");
    })[0];
    if (!chosen) return { message: "You have no incomplete tasks to prioritize.", blocks: [], context };
    if (chosen.priority === "urgent") {
      rememberTask(context, chosen);
      return {
        message: `“${chosen.title}” already has the highest priority.`,
        blocks: [{ type: "tasks", title: "Highest priority", tasks: [toTaskCard(chosen, board.projects, board.timezone)] }],
        context,
      };
    }
    const result = await act("update_task", { id: chosen.id, priority: "urgent" });
    const task = taskFrom(result.result);
    if (!result.success || !task || task.priority !== "urgent") {
      return { message: failed(`raise the priority of “${chosen.title}”`, result.error), blocks: [], context };
    }
    rememberTask(context, task);
    return {
      message: `Set “${task.title}” to urgent. It was the most urgent open task by priority and deadline.`,
      blocks: [{ type: "tasks", title: "Priority updated", tasks: [toTaskCard(task, board.projects, board.timezone)] }],
      context,
    };
  }

  const moveAll = norm.match(/move all (?:my )?(.+?) tasks? into (?:that|this|the)?\s*project/);
  if (moveAll) {
    return {
      message:
        "Projects aren't available in LifePilot. Use a task or checklist instead.",
      blocks: [],
      context,
    };
  }

  const moveOneInto = norm.match(
    /^(?:move|put|assign) (.+?) into (?:the |my )?(.+?)(?: project)?$/
  );
  if (moveOneInto && !/\ball\b/.test(norm)) {
    return {
      message:
        "Projects aren't available in LifePilot. Use a task or checklist instead.",
      blocks: [],
      context,
    };
  }

  const deadline = norm.match(
    /(?:change|move|set|update) (?:the )?(?:deadline|due date) of (?:my )?(.+?) to (.+)/
  );
  if (deadline) {
    return reschedule(deadline[1], deadline[2], workingRaw, context, board, act);
  }

  const moveOne = norm.match(/^(?:move|reschedule|shift) (.+?) to (.+)/);
  if (moveOne) return reschedule(moveOne[1], moveOne[2], workingRaw, context, board, act);

  // Incomplete reschedule: "shift science" / "postpone homework" — ask for the date.
  const moveIncomplete = norm.match(
    /^(?:move|reschedule|shift|postpone|bump|push(?: back)?|delay|defer|slide)\s+(.+)$/
  );
  if (moveIncomplete && !/\b(?:to|until|till|for)\b/.test(norm)) {
    const subject = cleanPhrase(moveIncomplete[1]);
    const found = resolveTaskPhrase(subject, board, context);
    if ("ask" in found) return { message: found.ask, blocks: [], context };
    if ("none" in found) {
      return {
        message: `I couldn't find “${subject}” to reschedule. Which task, and to which day?`,
        blocks: [],
        context,
      };
    }
    rememberTask(context, found.tasks[0]);
    return {
      message: `Move “${found.tasks[0].title}” to which day? (for example: Friday, tomorrow, next week)`,
      blocks: [
        {
          type: "tasks",
          title: "Task to reschedule",
          tasks: [toTaskCard(found.tasks[0], board.projects, board.timezone)],
        },
      ],
      context,
    };
  }

  // "show my tasks about milk" / past-lookup rewrite
  const aboutMatch = norm.match(
    /^(?:show|list|see|find|search)\s+(?:my\s+)?tasks?\s+(?:about|named|called|for|with)\s+(.+)$/
  );
  if (aboutMatch) {
    const phrase = cleanPhrase(aboutMatch[1]);
    const hits = tasksAbout(phrase, board.tasks.filter((t) => t.status !== "done"));
    const alsoDone = hits.length
      ? hits
      : tasksAbout(phrase, board.tasks);
    if (!alsoDone.length) {
      return {
        message: `I don't see a task about “${phrase}” on your list.`,
        blocks: [],
        context,
      };
    }
    context.lastTasks = alsoDone.slice(0, 20).map((task) => ({
      id: task.id,
      title: task.title,
    }));
    if (alsoDone.length === 1) rememberTask(context, alsoDone[0]);
    return {
      message:
        alsoDone.length === 1
          ? `Yes — “${alsoDone[0].title}” is on your list${alsoDone[0].due_date ? ` (due ${formatDateOnly(alsoDone[0].due_date)})` : ""}${alsoDone[0].status === "done" ? ", and it's already done" : ""}.`
          : `I found ${alsoDone.length} tasks about “${phrase}”: ${alsoDone.map((t) => t.title).join(", ")}.`,
      blocks: [
        {
          type: "tasks",
          title: "Matching tasks",
          tasks: alsoDone.slice(0, 12).map((task) =>
            toTaskCard(task, board.projects, board.timezone)
          ),
        },
      ],
      context,
    };
  }

  if (
    /^(?:mark|complete|finish|check off)\b/.test(norm) &&
    (/checklist|items?\b/.test(norm) || selectionCount(norm))
  ) {
    return completeChecklist(norm, workingRaw, context, board, act);
  }

  const completeTask = norm.match(
    /^(?:mark|complete|finish) (.+?)(?:\s+(?:as\s+)?(?:complete|completed|done))?$/
  );
  if (completeTask && !/checklist/.test(norm)) {
    const phrase = completeTask[1]
      .replace(/\s+as\s+(?:complete|completed|done)\b/g, "")
      .replace(/\s+(?:complete|completed|done)$/g, "")
      .trim();
    // Prefer checklist items when the phrase matches an item title.
    const itemHits = board.checklists.flatMap((checklist) =>
      checklist.items
        .filter((item) => !item.is_completed)
        .filter((item) => scoreName(phrase, item.title) >= 80)
        .map((item) => ({ checklist, item }))
    );
    if (itemHits.length === 1) {
      const hit = itemHits[0];
      const result = await act("complete_checklist_items", {
        checklist_id: hit.checklist.id,
        item_ids: [hit.item.id],
      });
      if (!result.success) {
        return { message: failed(`complete “${hit.item.title}”`, result.error), blocks: [], context };
      }
      const payload = result.result as {
        checklist: { id: string; title: string; project_id: string | null };
        items: ChecklistItem[];
      };
      rememberChecklist(context, payload.checklist, payload.items);
      return {
        message: `Marked “${hit.item.title}” complete on “${payload.checklist.title}”.`,
        blocks: [
          {
            type: "checklists",
            title: payload.checklist.title,
            checklists: [toChecklistCard(payload.checklist, payload.items, board.projects)],
          },
        ],
        context,
      };
    }

    const resolved = resolveTaskPhrase(phrase, board, context);
    if ("ask" in resolved) return { message: resolved.ask, blocks: [], context };
    if ("none" in resolved) {
      if (itemHits.length > 1) {
        return {
          message: askAmbiguous(
            itemHits.map((hit) => hit.item.title),
            "checklist item"
          ),
          blocks: [],
          context,
        };
      }
      return { message: resolved.none, blocks: [], context };
    }
    const target = resolved.tasks[0];
    const result = await act("complete_task", { id: target.id });
    const task = taskFrom(result.result);
    if (!result.success || !task || task.status !== "done") {
      return { message: failed(`complete “${target.title}”`, result.error), blocks: [], context };
    }
    rememberTask(context, task);
    return {
      message: `Marked “${task.title}” complete.`,
      blocks: [{ type: "tasks", title: "Completed", tasks: [toTaskCard(task, board.projects, board.timezone)] }],
      context,
    };
  }

  if (/^delete\b/.test(norm)) return requestDelete(norm, context, board);

  const chapters = chapterItems(workingRaw);
  if (chapters && (/checklist/.test(norm) || context.lastChecklist || /^add\b/.test(norm))) {
    const added = await addItems(chapters, norm, context, board, act);
    if (added) return added;
  }

  if (isAddingItemsToChecklist(norm, context)) {
    const itemPart = workingRaw
      .replace(/^add\s+/i, "")
      .replace(/\s+to\s+(?:my |the )?.+$/i, "");
    const titles = parseItemList(itemPart);
    const added = await addItems(
      titles.length ? titles : [cleanPhrase(itemPart)].filter(Boolean),
      norm,
      context,
      board,
      act
    );
    if (added) return added;
  }

  if (/checklist/.test(norm) && /^(?:add|create|make|start)\b/.test(norm)) {
    return createChecklistCommand(workingRaw, norm, context, board, act);
  }

  if (
    /\b(event|meeting|appointment|exam)\b/.test(norm) &&
    /^(?:add|create|make|schedule)\b/.test(norm) &&
    !/\bproject\b/.test(norm) &&
    !/\bchecklist\b/.test(norm)
  ) {
    return createEventCommand(workingRaw, norm, context, board, act);
  }

  if (/^(?:add|create|make|new)\b/.test(norm)) {
    return createTaskCommand(workingRaw, norm, context, board, act);
  }

  // Last resort: if they named an existing task without a verb, surface it.
  const maybeTask = resolveTaskPhrase(workingRaw, board, context);
  if ("tasks" in maybeTask && maybeTask.tasks.length === 1 && cleanPhrase(workingRaw).length > 2) {
    const task = maybeTask.tasks[0];
    rememberTask(context, task);
    return {
      message: `Found “${task.title}”${task.due_date ? `, due ${formatDateOnly(task.due_date)}` : ""}. Want me to mark it done, move the date, or something else?`,
      blocks: [{ type: "tasks", title: "Matched task", tasks: [toTaskCard(task, board.projects, board.timezone)] }],
      context,
    };
  }

  return {
    message:
      "I want to help, but I'm not sure what you meant. Try saying it the way you'd tell a friend — for example “remind me to call mom tomorrow,” “the essay is done,” “what's left today?,” or “shopping list: milk, eggs, bread.” Nothing was changed.",
    blocks: [],
    context,
  };
  })();

  return withInterpretation(coreResult, interpBlock);
}

async function correctFocused(
  phrase: string,
  raw: string,
  context: ConversationContext,
  board: Board,
  act: ToolHandler
): Promise<LocalCommandResult> {
  const focus = context.focus;
  if (!focus) {
    return {
      message: "I don't have a recent item to correct, so I did not create anything.",
      blocks: [],
      context,
    };
  }
  const resolved = resolveDatePhrase(phrase, board.timezone, board.weekStartsOn, board.now);
  if (resolved?.type === "ambiguous") {
    const soon = resolved.options[0];
    const later = resolved.options[1];
    if (later && focus.detail && soon && focus.detail === soon.date) {
      return correctFocused(later.date, raw, context, board, act);
    }
    context.pendingClarification = {
      question: resolved.question,
      target:
        focus.kind === "project"
          ? { type: "project", id: focus.id, field: "deadline" }
          : { type: "task", id: focus.id, field: "due_date" },
      options: resolved.options,
    };
    return { message: resolved.question, blocks: [], context };
  }
  if (resolved?.type === "range") {
    return {
      message: `${resolved.label} is a range (${formatDateOnly(resolved.from)} to ${formatDateOnly(resolved.to)}), not a single deadline. Which day should I use? I did not create a duplicate.`,
      blocks: [],
      context,
    };
  }
  if (resolved?.type === "day") {
    if (focus.kind === "project") {
      const result = await act("update_project", { id: focus.id, deadline: resolved.date });
      const project = result.result as Project | null;
      if (!result.success || !project || project.deadline !== resolved.date) {
        return { message: failed("change that deadline", result.error), blocks: [], context };
      }
      rememberProject(context, project);
      return {
        message: `Updated “${project.name}” to ${formatDateOnly(project.deadline)}. I changed the existing project instead of creating another one.`,
        blocks: [{ type: "projects", title: "Updated project", projects: [toProjectCard(project, board.tasks, [])] }],
        context,
      };
    }
    const result = await act("update_task", { id: focus.id, due_date: resolved.date });
    const task = taskFrom(result.result);
    if (!result.success || !task || task.due_date !== resolved.date) {
      return { message: failed("change that date", result.error), blocks: [], context };
    }
    rememberTask(context, task);
    return {
      message: `Updated “${task.title}” to ${formatDateOnly(task.due_date)}. I did not create a duplicate.`,
      blocks: [{ type: "tasks", title: "Updated task", tasks: [toTaskCard(task, board.projects, board.timezone)] }],
      context,
    };
  }
  if (focus.kind === "task") {
    const title = cleanPhrase(raw.match(/meant\s+(.+)$/i)?.[1] ?? phrase);
    const result = await act("update_task", { id: focus.id, title });
    const task = taskFrom(result.result);
    if (!result.success || !task) return { message: failed("rename that task", result.error), blocks: [], context };
    rememberTask(context, task);
    return {
      message: `Renamed the existing task to “${task.title}”.`,
      blocks: [{ type: "tasks", title: "Updated task", tasks: [toTaskCard(task, board.projects, board.timezone)] }],
      context,
    };
  }
  return { message: "I couldn't tell what to change, so I left your data as it is.", blocks: [], context };
}

async function applyClarification(
  norm: string,
  raw: string,
  context: ConversationContext,
  board: Board,
  act: ToolHandler
): Promise<LocalCommandResult | null> {
  const pending = context.pendingClarification;
  if (!pending) return null;
  const option = pending.options.find(
    (item) => norm.includes(item.date) || normalizeCommand(item.label) === norm || norm.includes(normalizeCommand(item.label))
  );
  const parsed = resolveDatePhrase(norm, board.timezone, board.weekStartsOn, board.now);
  const date = option?.date ?? (parsed?.type === "day" ? parsed.date : null);
  if (!date) {
    return {
      message: pending.question,
      blocks: [],
      context,
    };
  }
  context.pendingClarification = null;
  if (pending.target.type === "create_task") {
    return createTaskCommand(
      `Add ${pending.target.title} for ${date}`,
      `add ${pending.target.title} for ${date}`,
      context,
      board,
      act
    );
  }
  if (pending.target.type === "project") {
    const result = await act("update_project", { id: pending.target.id, deadline: date });
    const project = result.result as Project | null;
    if (!result.success || !project) return { message: failed("set that deadline", result.error), blocks: [], context };
    rememberProject(context, project);
    return {
      message: `Set “${project.name}” to ${formatDateOnly(project.deadline)}.`,
      blocks: [{ type: "projects", title: "Updated project", projects: [toProjectCard(project, board.tasks, [])] }],
      context,
    };
  }
  const result = await act("update_task", { id: pending.target.id, due_date: date });
  const task = taskFrom(result.result);
  if (!result.success || !task) return { message: failed("set that date", result.error), blocks: [], context };
  rememberTask(context, task);
  return {
    message: `Set “${task.title}” to ${formatDateOnly(task.due_date)}.`,
    blocks: [{ type: "tasks", title: "Updated task", tasks: [toTaskCard(task, board.projects, board.timezone)] }],
    context,
  };
}

async function reschedule(
  subject: string,
  when: string,
  raw: string,
  context: ConversationContext,
  board: Board,
  act: ToolHandler
): Promise<LocalCommandResult> {
  const resolved = resolveDatePhrase(when, board.timezone, board.weekStartsOn, board.now);
  const projectHint = /project/.test(normalizeCommand(subject));
  if (resolved?.type === "ambiguous") {
    const project = projectHint ? resolveProjectPhrase(subject, board, context) : null;
    const task = project && "project" in project ? null : resolveTaskPhrase(subject, board, context);
    const target = project && "project" in project
      ? { type: "project" as const, id: project.project.id, field: "deadline" as const }
      : task && "tasks" in task
        ? { type: "task" as const, id: task.tasks[0].id, field: "due_date" as const }
        : null;
    if (!target) {
      return { message: resolved.question, blocks: [], context };
    }
    context.pendingClarification = { question: resolved.question, target, options: resolved.options };
    return { message: resolved.question, blocks: [], context };
  }
  if (!resolved || resolved.type === "range") {
    return {
      message: resolved?.type === "range"
        ? `${resolved.label} covers ${formatDateOnly(resolved.from)} to ${formatDateOnly(resolved.to)}. Which day should I use?`
        : `I couldn't resolve “${cleanPhrase(when)}” to a date, so I didn't change a deadline.`,
      blocks: [],
      context,
    };
  }
  if (projectHint) {
    const found = resolveProjectPhrase(subject, board, context);
    if ("ask" in found) return { message: found.ask, blocks: [], context };
    if ("none" in found) return { message: found.none, blocks: [], context };
    const result = await act("update_project", { id: found.project.id, deadline: resolved.date });
    const project = result.result as Project | null;
    if (!result.success || !project || project.deadline !== resolved.date) {
      return { message: failed(`change the deadline of “${found.project.name}”`, result.error), blocks: [], context };
    }
    rememberProject(context, project);
    return {
      message: `Changed the deadline of “${project.name}” to ${formatDateOnly(project.deadline)}.`,
      blocks: [{ type: "projects", title: "Updated project", projects: [toProjectCard(project, board.tasks, [])] }],
      context,
    };
  }
  const found = resolveTaskPhrase(subject, board, context);
  if ("ask" in found || "none" in found) {
    const asProject = resolveProjectPhrase(subject, board, context);
    if ("project" in asProject) {
      const result = await act("update_project", { id: asProject.project.id, deadline: resolved.date });
      const project = result.result as Project | null;
      if (!result.success || !project) return { message: failed("change that deadline", result.error), blocks: [], context };
      rememberProject(context, project);
      return {
        message: `Changed the deadline of “${project.name}” to ${formatDateOnly(project.deadline)}.`,
        blocks: [{ type: "projects", title: "Updated project", projects: [toProjectCard(project, projectTasks(project, board.tasks), [])] }],
        context,
      };
    }
    return { message: "ask" in found ? found.ask : found.none, blocks: [], context };
  }
  const result = await act("update_task", { id: found.tasks[0].id, due_date: resolved.date });
  const task = taskFrom(result.result);
  if (!result.success || !task || task.due_date !== resolved.date) {
    return { message: failed(`move “${found.tasks[0].title}”`, result.error), blocks: [], context };
  }
  rememberTask(context, task);
  return {
    message: `Moved “${task.title}” to ${formatDateOnly(task.due_date)}.`,
    blocks: [{ type: "tasks", title: "Updated task", tasks: [toTaskCard(task, board.projects, board.timezone)] }],
    context,
  };
}

async function completeChecklist(
  norm: string,
  raw: string,
  context: ConversationContext,
  board: Board,
  act: ToolHandler
): Promise<LocalCommandResult> {
  const named = norm.match(/on (?:my )?(.+?) checklist/)?.[1] ?? "";
  const found = resolveChecklist(named, board, context);
  if ("ask" in found) return { message: found.ask, blocks: [], context };
  if ("none" in found) return { message: found.none, blocks: [], context };
  const count = selectionCount(norm);
  const index = count ? null : ordinalIndex(norm);
  const ordered = [...found.checklist.items].sort((a, b) => a.position - b.position);
  const chosen = count
    ? ordered.slice(0, count)
    : index !== null && ordered[index]
      ? [ordered[index]]
      : [];
  if (!chosen.length) {
    return { message: "Which checklist items should I mark done?", blocks: [], context };
  }
  const result = await act("complete_checklist_items", {
    checklist_id: found.checklist.id,
    item_ids: chosen.map((item) => item.id),
  });
  if (!result.success) return { message: failed("update those checklist items", result.error), blocks: [], context };
  const payload = result.result as { checklist: { id: string; title: string; project_id: string | null }; items: ChecklistItem[] };
  rememberChecklist(context, payload.checklist, payload.items);
  const card = toChecklistCard(payload.checklist, payload.items, board.projects);
  return {
    message: `Marked ${chosen.length} item(s) complete on “${payload.checklist.title}”: ${chosen.map((item) => item.title).join(", ")}.`,
    blocks: [{ type: "checklists", title: payload.checklist.title, checklists: [card] }],
    context,
  };
}

function requestDelete(
  norm: string,
  context: ConversationContext,
  board: Board
): LocalCommandResult {
  if (/duplicate/.test(norm)) {
    const groups = new Map<string, Task[]>();
    for (const task of board.tasks) {
      const key = task.title.trim().toLowerCase();
      groups.set(key, [...(groups.get(key) ?? []), task]);
    }
    const duplicates = [...groups.values()].filter((group) => group.length > 1);
    if (duplicates.length !== 1) {
      return {
        message: duplicates.length
          ? "Several tasks look duplicated. Tell me the exact title to delete."
          : "I couldn't find a duplicate task, so I left your list unchanged.",
        blocks: [],
        context,
      };
    }
    const newest = [...duplicates[0]].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    return confirm(
      `Delete the later copy of “${newest.title}”? This cannot be undone from the list until you ask me to undo.`,
      { tool: "delete_task", args: { id: newest.id }, summary: `Delete “${newest.title}”?` },
      context
    );
  }
  const subject = norm.replace(/^delete\s+(?:the\s+)?/, "");
  if (/checklist/.test(norm) || context.focus?.kind === "checklist") {
    const checklist = resolveChecklist(subject.replace(/\s*checklist$/, ""), board, context);
    if ("ask" in checklist) return { message: checklist.ask, blocks: [], context };
    if ("checklist" in checklist) {
      return confirm(
        `Delete checklist “${checklist.checklist.title}”?`,
        {
          tool: "delete_checklist",
          args: { id: checklist.checklist.id },
          summary: `Delete checklist “${checklist.checklist.title}”?`,
        },
        context
      );
    }
    if ("none" in checklist && /checklist/.test(norm)) {
      return { message: checklist.none, blocks: [], context };
    }
  }
  const task = resolveTaskPhrase(subject.replace(/\s*task$/, ""), board, context);
  if ("tasks" in task) {
    const target = task.tasks[0];
    return confirm(
      `Delete “${target.title}”?`,
      { tool: "delete_task", args: { id: target.id }, summary: `Delete “${target.title}”?` },
      context
    );
  }
  const project = resolveProjectPhrase(subject.replace(/ project$/, ""), board, context);
  if ("project" in project && /project/.test(norm)) {
    return confirm(
      `Delete project “${project.project.name}”? Tasks already in it will stay, but lose this project link only if you delete them separately. Confirm to delete the project.`,
      { tool: "delete_project", args: { id: project.project.id }, summary: `Delete project “${project.project.name}”?` },
      context
    );
  }
  if ("ask" in task) return { message: task.ask, blocks: [], context };
  return { message: "none" in task ? task.none : "Tell me which record to delete.", blocks: [], context };
}

async function addItems(
  titles: string[],
  norm: string,
  context: ConversationContext,
  board: Board,
  act: ToolHandler
): Promise<LocalCommandResult | null> {
  const named = norm.match(/to (?:my )?(.+?) checklist/)?.[1] ?? (context.lastChecklist ? "it" : "");
  if (!named && !context.lastChecklist) return null;
  const found = resolveChecklist(named, board, context);
  if ("ask" in found) return { message: found.ask, blocks: [], context };
  if ("none" in found) return { message: found.none, blocks: [], context };
  const result = await act("add_checklist_items", {
    checklist_id: found.checklist.id,
    titles,
  });
  if (!result.success) return { message: failed("add those checklist items", result.error), blocks: [], context };
  const payload = result.result as {
    checklist: { id: string; title: string; project_id: string | null };
    items: ChecklistItem[];
    all_items: ChecklistItem[];
  };
  rememberChecklist(context, payload.checklist, payload.all_items);
  return {
    message: `Added ${payload.items.length} item(s) to “${payload.checklist.title}”: ${payload.items.map((item) => item.title).join(", ")}.`,
    blocks: [
      {
        type: "checklists",
        title: payload.checklist.title,
        checklists: [toChecklistCard(payload.checklist, payload.all_items, board.projects)],
      },
    ],
    context,
  };
}

async function createChecklistCommand(
  raw: string,
  norm: string,
  context: ConversationContext,
  board: Board,
  act: ToolHandler
): Promise<LocalCommandResult> {
  let projectId: string | null = null;
  const parsed = extractChecklistTitleAndItems(raw);
  let title = parsed.title;
  const items = parsed.items;

  if (/\bto it\b|\bto that\b|\bfor it\b/.test(norm) && context.lastProject) {
    const project = board.projects.find((item) => item.id === context.lastProject?.id);
    if (!project) return { message: "I lost track of which project you meant.", blocks: [], context };
    projectId = project.id;
    if (!title || title === "New Checklist" || title === "New checklist") {
      title = `${project.name} checklist`;
    }
  } else if (/next project/.test(norm)) {
    const today = calendarToday(board.timezone, board.now);
    const upcoming = board.projects
      .filter((project) => project.deadline && project.deadline >= today && project.status !== "completed")
      .sort((a, b) => (a.deadline ?? "").localeCompare(b.deadline ?? ""))[0];
    if (upcoming) {
      projectId = upcoming.id;
      if (!title || title === "New Checklist" || title === "New checklist") {
        title = `${upcoming.name} checklist`;
      }
    } else if (!title || title === "New Checklist" || title === "New checklist") {
      title = "Next project";
    }
  }

  // "checklist for my science exam with …" — attach to matching project when possible
  if (!projectId && /\bfor\b/.test(norm)) {
    const forPhrase = raw.match(/checklist\s+for\s+(?:my\s+)?(.+?)(?:\s+with\s+|$)/i)?.[1];
    if (forPhrase) {
      const found = resolveProjectPhrase(forPhrase, board, context);
      if ("project" in found) {
        projectId = found.project.id;
        if (!title || title === "New Checklist" || title === "New checklist") {
          title = `${found.project.name} checklist`;
        }
      }
    }
  }

  const result = await act("create_checklist", {
    title,
    project_id: projectId,
    items: items.map((itemTitle) => ({ title: itemTitle })),
  });
  if (!result.success) return { message: failed("create that checklist", result.error), blocks: [], context };
  const payload = result.result as {
    checklist: { id: string; title: string; project_id: string | null };
    items: ChecklistItem[];
  };

  // If create_checklist ignored items (older tool path), add them separately.
  let allItems = payload.items ?? [];
  if (items.length && allItems.length === 0) {
    const added = await act("add_checklist_items", {
      checklist_id: payload.checklist.id,
      titles: items,
    });
    if (added.success) {
      const addedPayload = added.result as {
        all_items?: ChecklistItem[];
        items?: ChecklistItem[];
      };
      allItems = addedPayload.all_items ?? addedPayload.items ?? [];
    }
  }

  rememberChecklist(context, payload.checklist, allItems);
  if (projectId) {
    const project = board.projects.find((item) => item.id === projectId);
    if (project) rememberProject(context, project);
  }
  const itemNote =
    allItems.length > 0
      ? ` with ${allItems.length} item(s): ${allItems.map((item) => item.title).join(", ")}`
      : "";
  return {
    message: `Created checklist “${payload.checklist.title}”${projectId ? " and attached it to the project" : ""}${itemNote}.`,
    blocks: [
      {
        type: "checklists",
        title: "New checklist",
        checklists: [toChecklistCard(payload.checklist, allItems, board.projects)],
      },
    ],
    context,
  };
}

async function createProjectCommand(
  raw: string,
  norm: string,
  context: ConversationContext,
  board: Board,
  act: ToolHandler
): Promise<LocalCommandResult> {
  const deadlinePhrase =
    raw.match(/\bwith\s+(?:a\s+)?(?:deadline|due date)\s+(.+)$/i)?.[1] ??
    raw.match(/\b(?:deadline|due)\s+(?:on\s+|by\s+)?(.+)$/i)?.[1] ??
    "";
  const called = raw.match(
    /project\s+(?:called|named|titled)\s+(.+?)(?:\s+with\s+(?:a\s+)?(?:deadline|due date)\b|\s+deadline\b|\s+due\b|$)/i
  )?.[1];
  const forPhrase = raw.match(
    /project\s+for\s+(.+?)(?:\s+with\s+(?:a\s+)?(?:deadline|due date)\b|\s+deadline\b|\s+due\b|$)/i
  )?.[1];
  const source = cleanPhrase(called || forPhrase?.replace(/^my\s+/i, "") || "");
  if (!source) return { message: "What should the project be called?", blocks: [], context };
  const name = called ? cleanPhrase(called) : titleCase(source);

  let deadline: string | null = null;
  if (deadlinePhrase) {
    const resolved = resolveDatePhrase(
      normalizeCommand(deadlinePhrase),
      board.timezone,
      board.weekStartsOn,
      board.now
    );
    if (resolved?.type === "ambiguous") {
      return { message: resolved.question, blocks: [], context };
    }
    if (!resolved || resolved.type !== "day") {
      return {
        message: "That deadline needs a specific day before I create the project. I did not save one.",
        blocks: [],
        context,
      };
    }
    deadline = resolved.date;
  }

  const existing = board.projects.find((project) => project.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    rememberProject(context, existing);
    return {
      message: `“${existing.name}” already exists, so I did not create a duplicate.`,
      blocks: [{ type: "projects", title: "Existing project", projects: [toProjectCard(existing, board.tasks, [])] }],
      context,
    };
  }
  const result = await act("create_project", { name, deadline });
  const project = result.result as Project | null;
  if (!result.success || !project) return { message: failed("create that project", result.error), blocks: [], context };
  rememberProject(context, project);
  return {
    message: `Created project “${project.name}”${project.deadline ? ` with deadline ${formatDateOnly(project.deadline)}` : ""}.`,
    blocks: [{ type: "projects", title: "New project", projects: [toProjectCard(project, [], [])] }],
    context,
  };
}

async function createTaskCommand(
  raw: string,
  norm: string,
  context: ConversationContext,
  board: Board,
  act: ToolHandler
): Promise<LocalCommandResult> {
  const cleanedRaw = cleanPhrase(raw);
  const match =
    cleanedRaw.match(
      /^(?:please\s+)?(?:add|create|make|new)\s+(?:a\s+)?(?:task\s+)?(?:called\s+|named\s+)?(.+?)(?:\s+(?:for|due|by|on|before)\s+(.+))?$/i
    ) ||
    cleanedRaw.match(
      /^(?:please\s+)?(?:add|create|make|new)\s+(?:a\s+)?(?:task\s+)?(?:called\s+|named\s+)?(.+)$/i
    ) ||
    norm.match(
      /^(?:please\s+)?(?:add|create|make|new)\s+(?:a\s+)?(?:task\s+)?(?:called\s+|named\s+)?(.+?)(?:\s+(?:for|due|by|on|before)\s+(.+))?$/
    ) ||
    norm.match(
      /^(?:please\s+)?(?:add|create|make|new)\s+(?:a\s+)?(?:task\s+)?(?:called\s+|named\s+)?(.+)$/
    );
  let title = cleanPhrase(match?.[1] || "");
  let when = match?.[2] ? normalizeCommand(match[2]) : "";

  // "add buy milk tomorrow" (date glued without for/due/by)
  if (!when) {
    const glued = title.match(
      /^(.+?)\s+(today|tonight|tomorrow|yesterday|this\s+\w+|next\s+\w+|\d{4}-\d{2}-\d{2})$/i
    );
    if (glued) {
      title = cleanPhrase(glued[1]);
      when = normalizeCommand(glued[2]);
    }
  }

  // Strip leftover "to " / "do my " from remind/need rewrites
  title = title
    .replace(/^to\s+/i, "")
    .replace(/^do\s+(?:my\s+|the\s+)?/i, "")
    .trim();

  if (!title || /^(a )?(checklist|project)\b/i.test(title)) {
    return { message: "What should I call the task?", blocks: [], context };
  }
  let due: string | null = null;
  if (when) {
    const resolved = resolveDatePhrase(when, board.timezone, board.weekStartsOn, board.now);
    if (resolved?.type === "ambiguous") {
      context.pendingClarification = {
        question: resolved.question,
        target: { type: "create_task", title },
        options: resolved.options,
      };
      return { message: resolved.question, blocks: [], context };
    }
    if (!resolved || resolved.type !== "day") {
      return {
        message: "That due date needs a specific day before I create the task. I did not save one.",
        blocks: [],
        context,
      };
    }
    due = resolved.date;
  }
  const duplicate = board.tasks.find(
    (task) =>
      task.title.toLowerCase() === title.toLowerCase() &&
      (task.due_date ?? null) === due &&
      task.status !== "cancelled"
  );
  if (duplicate) {
    rememberTask(context, duplicate);
    return {
      message: `“${duplicate.title}” is already on your list${due ? ` for ${formatDateOnly(due)}` : ""}, so I did not create a duplicate.`,
      blocks: [{ type: "tasks", title: "Existing task", tasks: [toTaskCard(duplicate, board.projects, board.timezone)] }],
      context,
    };
  }
  const priority = /urgent/.test(norm) ? "urgent" : /high priority/.test(norm) ? "high" : "medium";
  const result = await act("create_task", { title, due_date: due, priority });
  const task = taskFrom(result.result);
  if (!result.success || !task) return { message: failed("create that task", result.error), blocks: [], context };
  rememberTask(context, task);
  return {
    message: `Created task “${task.title}”${task.due_date ? ` due ${formatDateOnly(task.due_date)}` : " with no deadline"}.`,
    blocks: [{ type: "tasks", title: "Created", tasks: [toTaskCard(task, board.projects, board.timezone)] }],
    context,
  };
}

async function createEventCommand(
  raw: string,
  norm: string,
  context: ConversationContext,
  board: Board,
  act: ToolHandler
): Promise<LocalCommandResult> {
  const timeMatch = raw.match(/\bat\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
  const clock = timeMatch ? parseClock(timeMatch[1]) : null;
  if (clock === "ambiguous") {
    return {
      message: `Should “${timeMatch?.[1]}” be morning or afternoon? I did not save an event.`,
      blocks: [],
      context,
    };
  }
  const dated =
    raw.match(/\b(?:on|for)\s+(.+?)(?:\s+at\s+\d|$)/i) ??
    raw.match(/\b(today|tomorrow|tonight|yesterday|next\s+\w+|this\s+\w+)\b(?=\s+at\s+\d|$)/i);
  const datePhrase = dated ? normalizeCommand(dated[1]) : "";
  let day = calendarToday(board.timezone, board.now);
  if (datePhrase) {
    const resolved = resolveDatePhrase(datePhrase, board.timezone, board.weekStartsOn, board.now);
    if (resolved?.type === "ambiguous") {
      return { message: resolved.question, blocks: [], context };
    }
    if (!resolved || resolved.type !== "day") {
      return {
        message: "I need a specific day before I save that event.",
        blocks: [],
        context,
      };
    }
    day = resolved.date;
  }
  const title = cleanPhrase(
    raw
      .replace(/^(?:please\s+)?(?:add|create|schedule|make)\s+(?:an?\s+)?(?:new\s+)?(?:event|meeting|appointment|exam)\s+(?:called\s+|named\s+)?/i, "")
      .replace(/\s+\b(?:on|for)\s+.+$/i, "")
      .replace(/\s+\b(?:today|tomorrow|tonight|yesterday|next\s+\w+|this\s+\w+)\b/i, "")
      .replace(/\s+\bat\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?/i, "")
  );
  if (!title) return { message: "What should I call the event?", blocks: [], context };
  const start = fromZonedTime(`${day}T${clock ?? "00:00"}:00`, board.timezone);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const eventType = /exam/.test(norm)
    ? "exam"
    : /meeting/.test(norm)
      ? "meeting"
      : /appointment/.test(norm)
        ? "appointment"
        : "event";
  const result = await act("create_event", {
    title,
    start_at: start.toISOString(),
    end_at: end.toISOString(),
    all_day: !clock,
    event_type: eventType,
  });
  const event = result.result as CalendarEvent | null;
  if (!result.success || !event?.id) {
    return { message: failed("save that event", result.error), blocks: [], context };
  }
  context.focus = { kind: "event", id: event.id, label: event.title, detail: day };
  return {
    message: `Saved ${event.event_type} “${event.title}” on ${formatDateOnly(day)}${clock ? ` at ${clock}` : " as an all-day event"}.`,
    blocks: [{ type: "events", title: "Saved event", events: [toEventCard(event)] }],
    context,
  };
}
