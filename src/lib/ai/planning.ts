/**
 * Workload planning: prioritize, schedule, break down goals, detect overload,
 * and apply conversational plan follow-ups — grounded in real task/calendar data.
 */

import { formatInTimeZone } from "date-fns-tz";
import type { CalendarEvent, Project, Task } from "@/types";
import {
  addCalendarDays,
  calendarToday,
  formatDateOnly,
  priorityWeight,
  type PeriodKind,
} from "@/lib/utils/dates";
import type { AssistantBlock, Board, ConversationContext, ScheduleSlot } from "./types";

export type PlanHorizon = "day" | "week" | "month" | "priority" | "project" | "feasibility";

export interface PlanSlot extends ScheduleSlot {
  reason?: string;
  estimated?: boolean;
  due_date?: string | null;
  priority?: string;
}

export interface SuggestedPlan {
  horizon: PlanHorizon;
  periodKind: PeriodKind | "custom";
  periodLabel: string;
  slots: PlanSlot[];
  explanations: string[];
  overloaded: boolean;
  overloadNote: string | null;
  totalTaskMinutes: number;
  availableMinutes: number | null;
  usedEstimates: boolean;
  workStart: string;
  workEnd: string;
  /** True when durations came from defaults rather than user-set estimates. */
  defaultDurationUsed: boolean;
}

export interface RankedTask {
  task: Task;
  score: number;
  reasons: string[];
  minutes: number;
  estimated: boolean;
}

export interface BreakdownStep {
  title: string;
  hint?: string;
}

const PRIORITY_SCORE: Record<string, number> = {
  urgent: 100,
  high: 70,
  medium: 35,
  low: 10,
};

function incomplete(task: Task): boolean {
  return task.status !== "done" && task.status !== "cancelled";
}

function parseHm(value: string | null | undefined, fallback: string): number {
  const raw = (value && /^\d{1,2}:\d{2}/.test(value) ? value : fallback).slice(0, 5);
  const [h, m] = raw.split(":").map(Number);
  return h * 60 + (m || 0);
}

function formatHm(minutes: number): string {
  const wrapped = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function daysUntil(due: string | null, today: string): number | null {
  if (!due) return null;
  const a = Date.parse(`${today}T12:00:00Z`);
  const b = Date.parse(`${due.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

function taskMinutes(task: Task, defaultDuration: number): { minutes: number; estimated: boolean } {
  if (task.estimated_minutes != null && task.estimated_minutes > 0) {
    return { minutes: task.estimated_minutes, estimated: false };
  }
  return { minutes: defaultDuration, estimated: true };
}

function projectFor(task: Task, projects: Project[]): Project | null {
  if (!task.project_id) return null;
  return projects.find((p) => p.id === task.project_id) ?? null;
}

/**
 * Multi-factor score. Earliest deadline alone does not win when user priority,
 * project significance, or overdue status points elsewhere.
 */
export function scoreTaskForPlanning(
  task: Task,
  opts: {
    today: string;
    projects: Project[];
    defaultDuration: number;
    planningStyle?: string | null;
    preferProjectId?: string | null;
  }
): RankedTask {
  const reasons: string[] = [];
  let score = 0;
  const { minutes, estimated } = taskMinutes(task, opts.defaultDuration);
  const pScore = PRIORITY_SCORE[task.priority] ?? 20;
  score += pScore;
  if (task.priority === "urgent" || task.priority === "high") {
    reasons.push(`${task.priority} priority`);
  }

  const until = daysUntil(task.due_date, opts.today);
  if (until !== null) {
    if (until < 0) {
      score += 90 + Math.min(40, Math.abs(until) * 5);
      reasons.push(`overdue since ${formatDateOnly(task.due_date)}`);
    } else if (until === 0) {
      score += 55;
      reasons.push("due today");
    } else if (until === 1) {
      score += 40;
      reasons.push("due tomorrow");
    } else if (until <= 3) {
      score += 28;
      reasons.push(`due in ${until} days`);
    } else if (until <= 7) {
      score += 14;
      reasons.push(`due ${formatDateOnly(task.due_date)}`);
    } else {
      score += Math.max(0, 10 - until);
    }
  } else {
    score -= 5;
  }

  const project = projectFor(task, opts.projects);
  if (project) {
    score += (PRIORITY_SCORE[project.priority] ?? 0) * 0.35;
    if (project.priority === "urgent" || project.priority === "high") {
      reasons.push(`part of ${project.name} (${project.priority})`);
    }
    if (project.deadline) {
      const pUntil = daysUntil(project.deadline, opts.today);
      if (pUntil !== null && pUntil <= 7) {
        score += 18;
        reasons.push(`project deadline ${formatDateOnly(project.deadline)}`);
      }
    }
    if (opts.preferProjectId && project.id === opts.preferProjectId) {
      score += 50;
      reasons.push("you asked to finish this project first");
    }
  }

  if (task.status === "in_progress") {
    score += 12;
    reasons.push("already in progress");
  }

  // planning_style nudges — never invent availability
  if (opts.planningStyle === "priority_first") {
    score += pScore * 0.15;
  } else if (opts.planningStyle === "flexible" && minutes <= 30) {
    score += 6;
  }

  // Mild preference for finishing shorter work when scores are close —
  // does not override urgency/priority.
  score -= Math.min(8, minutes / 60);

  if (reasons.length === 0) {
    reasons.push(task.due_date ? `due ${formatDateOnly(task.due_date)}` : "open work");
  }

  return { task, score, reasons, minutes, estimated };
}

export function rankTasksForPlanning(
  tasks: Task[],
  opts: {
    today: string;
    projects: Project[];
    defaultDuration: number;
    planningStyle?: string | null;
    preferProjectId?: string | null;
  }
): RankedTask[] {
  return tasks
    .filter(incomplete)
    .map((task) => scoreTaskForPlanning(task, opts))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Tie-break: higher user priority, then earlier due, then title
      const pw = priorityWeight(b.task.priority) - priorityWeight(a.task.priority);
      if (pw) return pw;
      return (a.task.due_date ?? "9999").localeCompare(b.task.due_date ?? "9999");
    });
}

interface BusyBlock {
  start: number;
  end: number;
  title: string;
  kind: "event";
}

function eventBlocksForDay(
  events: CalendarEvent[],
  day: string,
  timezone: string,
  workStartMin: number,
  workEndMin: number
): BusyBlock[] {
  const blocks: BusyBlock[] = [];
  for (const event of events) {
    const localDay = formatInTimeZone(new Date(event.start_at), timezone, "yyyy-MM-dd");
    if (localDay !== day) continue;
    if (event.all_day) {
      blocks.push({
        start: workStartMin,
        end: Math.min(workEndMin, workStartMin + 60),
        title: event.title,
        kind: "event",
      });
      continue;
    }
    const startMin =
      Number(formatInTimeZone(new Date(event.start_at), timezone, "H")) * 60 +
      Number(formatInTimeZone(new Date(event.start_at), timezone, "m"));
    const endMin =
      Number(formatInTimeZone(new Date(event.end_at), timezone, "H")) * 60 +
      Number(formatInTimeZone(new Date(event.end_at), timezone, "m"));
    blocks.push({
      start: Math.max(workStartMin, startMin),
      end: Math.min(workEndMin, Math.max(startMin + 15, endMin)),
      title: event.title,
      kind: "event",
    });
  }
  return blocks.sort((a, b) => a.start - b.start);
}

function freeGaps(
  busy: BusyBlock[],
  workStartMin: number,
  workEndMin: number
): { start: number; end: number }[] {
  const gaps: { start: number; end: number }[] = [];
  let cursor = workStartMin;
  for (const block of busy) {
    if (block.start > cursor) gaps.push({ start: cursor, end: block.start });
    cursor = Math.max(cursor, block.end);
  }
  if (cursor < workEndMin) gaps.push({ start: cursor, end: workEndMin });
  return gaps.filter((g) => g.end - g.start >= 10);
}

export function assessOverload(input: {
  totalTaskMinutes: number;
  availableMinutes: number | null;
  taskCount: number;
  overdueCount: number;
}): { overloaded: boolean; note: string | null } {
  if (input.availableMinutes == null) {
    if (input.taskCount >= 8 || input.overdueCount >= 3) {
      return {
        overloaded: true,
        note: `You have ${input.taskCount} open tasks${input.overdueCount ? ` (${input.overdueCount} overdue)` : ""}. Working hours aren't set, so I can't confirm they fit a single day — say when you start/finish, or ask me to reorder or move flexible work.`,
      };
    }
    return { overloaded: false, note: null };
  }
  if (input.totalTaskMinutes > input.availableMinutes * 1.05) {
    const over = input.totalTaskMinutes - input.availableMinutes;
    return {
      overloaded: true,
      note: `This looks tight: about ${input.totalTaskMinutes} minutes of work vs roughly ${input.availableMinutes} minutes free (≈${over} min over). Options: reorder by priority, split a large task, move flexible work, or tell me which deadlines are fixed.`,
    };
  }
  if (input.overdueCount >= 2 && input.totalTaskMinutes > input.availableMinutes * 0.7) {
    return {
      overloaded: true,
      note: `You have ${input.overdueCount} overdue items plus today's load. Consider finishing the most important overdue work first and parking lower-priority tasks.`,
    };
  }
  return { overloaded: false, note: null };
}

export function buildDayPlan(input: {
  tasks: Task[];
  overdueTasks?: Task[];
  events: CalendarEvent[];
  projects: Project[];
  day: string;
  periodLabel: string;
  timezone: string;
  workStart?: string | null;
  workEnd?: string | null;
  defaultDuration: number;
  planningStyle?: string | null;
  preferProjectId?: string | null;
  startAtOverride?: string | null;
  maxSlots?: number;
}): SuggestedPlan {
  const workStart = input.startAtOverride?.slice(0, 5) || input.workStart || "09:00";
  const workEnd = input.workEnd || "17:00";
  const workStartMin = parseHm(workStart, "09:00");
  let workEndMin = parseHm(workEnd, "17:00");
  if (workEndMin <= workStartMin) workEndMin = workStartMin + 8 * 60;

  const busy = eventBlocksForDay(
    input.events,
    input.day,
    input.timezone,
    workStartMin,
    workEndMin
  );
  const gaps = freeGaps(busy, workStartMin, workEndMin);
  const availableMinutes = gaps.reduce((sum, g) => sum + (g.end - g.start), 0);

  const pool = [
    ...(input.overdueTasks ?? []).filter(incomplete),
    ...input.tasks.filter(incomplete),
  ];
  // Dedupe by id
  const seen = new Set<string>();
  const unique = pool.filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });

  const ranked = rankTasksForPlanning(unique, {
    today: input.day,
    projects: input.projects,
    defaultDuration: input.defaultDuration,
    planningStyle: input.planningStyle,
    preferProjectId: input.preferProjectId,
  });

  const slots: PlanSlot[] = [];
  for (const block of busy) {
    slots.push({
      time_label: formatHm(block.start),
      title: block.title,
      minutes: Math.max(0, block.end - block.start),
      kind: "event",
      reason: "Existing calendar commitment",
    });
  }

  const gapCursors = gaps.map((g) => ({ ...g, cursor: g.start }));
  const placed: RankedTask[] = [];
  const deferred: RankedTask[] = [];
  const maxSlots = input.maxSlots ?? 12;

  for (const rankedTask of ranked) {
    if (placed.length >= maxSlots) {
      deferred.push(rankedTask);
      continue;
    }
    let fitted = false;
    for (const gap of gapCursors) {
      const remaining = gap.end - gap.cursor;
      if (remaining < Math.min(15, rankedTask.minutes)) continue;
      const use = Math.min(rankedTask.minutes, remaining);
      slots.push({
        time_label: formatHm(gap.cursor),
        title: rankedTask.task.title,
        minutes: use,
        task_id: rankedTask.task.id,
        kind: "task",
        reason: rankedTask.reasons.slice(0, 2).join("; "),
        estimated: rankedTask.estimated,
        due_date: rankedTask.task.due_date,
        priority: rankedTask.task.priority,
      });
      gap.cursor += use;
      placed.push(rankedTask);
      fitted = true;
      break;
    }
    if (!fitted) deferred.push(rankedTask);
  }

  slots.sort((a, b) => a.time_label.localeCompare(b.time_label));

  const totalTaskMinutes = ranked.reduce((s, r) => s + r.minutes, 0);
  const overload = assessOverload({
    totalTaskMinutes: placed.reduce((s, r) => s + r.minutes, 0) + deferred.reduce((s, r) => s + r.minutes, 0),
    availableMinutes,
    taskCount: unique.length,
    overdueCount: (input.overdueTasks ?? []).filter(incomplete).length,
  });

  const explanations: string[] = [];
  if (placed[0]) {
    explanations.push(
      `Start with “${placed[0].task.title}” — ${placed[0].reasons[0] ?? "highest combined priority"}.`
    );
  }
  if (busy.length) {
    explanations.push(
      `Kept ${busy.length} calendar event${busy.length === 1 ? "" : "s"} fixed so tasks don't overlap.`
    );
  }
  const usedEstimates = ranked.some((r) => r.estimated);
  if (usedEstimates) {
    explanations.push(
      `Some durations use your default (${input.defaultDuration} min) because those tasks have no estimate.`
    );
  }
  if (deferred.length) {
    explanations.push(
      `${deferred.length} task${deferred.length === 1 ? "" : "s"} didn't fit free time: ${deferred
        .slice(0, 3)
        .map((d) => d.task.title)
        .join(", ")}${deferred.length > 3 ? "…" : ""}.`
    );
    overload.overloaded = true;
    overload.note =
      overload.note ??
      `Not everything fits. I scheduled the highest-priority work first and left ${deferred.length} for later — say if you want to move flexible items or split a large task.`;
  }

  return {
    horizon: "day",
    periodKind: "today",
    periodLabel: input.periodLabel,
    slots,
    explanations,
    overloaded: overload.overloaded,
    overloadNote: overload.note,
    totalTaskMinutes,
    availableMinutes,
    usedEstimates,
    workStart,
    workEnd,
    defaultDurationUsed: usedEstimates,
  };
}

export function buildPeriodPlan(input: {
  tasks: Task[];
  overdueTasks?: Task[];
  projects: Project[];
  events?: CalendarEvent[];
  today: string;
  periodLabel: string;
  periodKind: PeriodKind;
  horizon: PlanHorizon;
  defaultDuration: number;
  planningStyle?: string | null;
  preferProjectId?: string | null;
}): SuggestedPlan {
  const pool = [
    ...(input.overdueTasks ?? []).filter(incomplete),
    ...input.tasks.filter(incomplete),
  ];
  const seen = new Set<string>();
  const unique = pool.filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
  const ranked = rankTasksForPlanning(unique, {
    today: input.today,
    projects: input.projects,
    defaultDuration: input.defaultDuration,
    planningStyle: input.planningStyle,
    preferProjectId: input.preferProjectId,
  });

  const slots: PlanSlot[] = ranked.map((r) => ({
    time_label: r.task.due_date ? formatDateOnly(r.task.due_date) : "Flexible",
    title: r.task.title,
    minutes: r.minutes,
    task_id: r.task.id,
    kind: "task" as const,
    reason: r.reasons.slice(0, 2).join("; "),
    estimated: r.estimated,
    due_date: r.task.due_date,
    priority: r.task.priority,
  }));

  const totalTaskMinutes = ranked.reduce((s, r) => s + r.minutes, 0);
  const workDaysApprox =
    input.horizon === "week" ? 5 : input.horizon === "month" ? 20 : 1;
  const availableMinutes = workDaysApprox * 8 * 60;
  const overload = assessOverload({
    totalTaskMinutes,
    availableMinutes,
    taskCount: unique.length,
    overdueCount: (input.overdueTasks ?? []).filter(incomplete).length,
  });

  const explanations: string[] = [];
  if (ranked[0]) {
    explanations.push(
      `Highest priority: “${ranked[0].task.title}” (${ranked[0].reasons[0]}).`
    );
  }
  if (ranked[1] && ranked[0] && ranked[0].task.due_date && ranked[1].task.due_date) {
    const firstDue = ranked[0].task.due_date;
    const secondDue = ranked[1].task.due_date;
    if (secondDue < firstDue && priorityWeight(ranked[0].task.priority) > priorityWeight(ranked[1].task.priority)) {
      explanations.push(
        `“${ranked[0].task.title}” ranks above “${ranked[1].task.title}” despite a later deadline because of higher importance.`
      );
    }
  }
  if (ranked.some((r) => r.estimated)) {
    explanations.push(
      `Durations marked with defaults (~${input.defaultDuration} min) are estimates, not confirmed facts.`
    );
  }
  if (input.events?.length) {
    explanations.push(
      `${input.events.length} calendar event${input.events.length === 1 ? "" : "s"} fall in this period — keep those commitments in mind.`
    );
  }

  return {
    horizon: input.horizon,
    periodKind: input.periodKind,
    periodLabel: input.periodLabel,
    slots,
    explanations,
    overloaded: overload.overloaded,
    overloadNote: overload.note,
    totalTaskMinutes,
    availableMinutes,
    usedEstimates: ranked.some((r) => r.estimated),
    workStart: "09:00",
    workEnd: "17:00",
    defaultDurationUsed: ranked.some((r) => r.estimated),
  };
}

/** Suggest manageable steps for a large goal — does not write to the database. */
export function suggestBreakdown(goal: string): BreakdownStep[] {
  const g = goal.trim().replace(/[.!?]+$/g, "");
  const lower = g.toLowerCase();

  if (/science\s+(fair|exhibition|project)|exhibition|science fair/i.test(lower)) {
    return [
      { title: "Research the topic and gather sources", hint: "Decide the question or theme" },
      { title: "Plan the display layout", hint: "Sketch boards, demos, and labels" },
      { title: "Prepare materials and props", hint: "List what you need to buy or build" },
      { title: "Assemble the project", hint: "Build the core experiment or model" },
      { title: "Review and practice the presentation", hint: "Check timing and clarity" },
    ];
  }
  if (/essay|paper|report|write-?up/i.test(lower)) {
    return [
      { title: `Outline “${g}”`, hint: "Main points and structure" },
      { title: "Research and gather notes" },
      { title: "Write the first draft" },
      { title: "Revise and edit" },
      { title: "Final proofread and submit" },
    ];
  }
  if (/exam|test|quiz|midterm|final/i.test(lower)) {
    return [
      { title: "List topics and weak areas" },
      { title: "Review notes and key chapters" },
      { title: "Practice past questions" },
      { title: "Memorize formulas / key facts" },
      { title: "Light review the day before" },
    ];
  }
  if (/presentation|talk|speech|pitch/i.test(lower)) {
    return [
      { title: "Define the audience and key message" },
      { title: "Outline slides / talking points" },
      { title: "Build the draft deck" },
      { title: "Practice aloud and time it" },
      { title: "Polish visuals and Q&A notes" },
    ];
  }
  if (/launch|release|ship|deploy/i.test(lower)) {
    return [
      { title: "Define must-have scope" },
      { title: "Build core features" },
      { title: "Test and fix blockers" },
      { title: "Prepare release notes / checklist" },
      { title: "Ship and verify" },
    ];
  }

  // Generic adaptive breakdown
  const short = g.length > 48 ? `${g.slice(0, 45)}…` : g;
  return [
    { title: `Clarify the goal for “${short}”`, hint: "What done looks like" },
    { title: "List materials, people, or info you need" },
    { title: "Do the main body of work" },
    { title: "Review and fix gaps" },
    { title: "Final check and wrap-up" },
  ];
}

export function feasibilityBefore(
  tasks: Task[],
  opts: {
    today: string;
    beforeDate: string;
    defaultDuration: number;
    workStart?: string | null;
    workEnd?: string | null;
    projects?: Project[];
  }
): {
  ok: boolean;
  message: string;
  totalMinutes: number;
  availableMinutes: number;
  ranked: RankedTask[];
} {
  const open = tasks.filter(
    (t) =>
      incomplete(t) &&
      (!t.due_date || t.due_date.slice(0, 10) <= opts.beforeDate)
  );
  const ranked = rankTasksForPlanning(open, {
    today: opts.today,
    projects: opts.projects ?? [],
    defaultDuration: opts.defaultDuration,
  });
  const totalMinutes = ranked.reduce((s, r) => s + r.minutes, 0);
  const start = parseHm(opts.workStart, "09:00");
  const end = parseHm(opts.workEnd, "17:00");
  const dayMinutes = Math.max(60, (end > start ? end : start + 8 * 60) - start);
  let days = 0;
  for (let d = opts.today; d <= opts.beforeDate; d = addCalendarDays(d, 1)) {
    const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (wd !== 0 && wd !== 6) days += 1;
  }
  const availableMinutes = Math.max(dayMinutes, days * dayMinutes);
  const usedEstimates = ranked.some((r) => r.estimated);
  const ok = totalMinutes <= availableMinutes;
  const estimateNote = usedEstimates
    ? " Some task lengths are default estimates, not confirmed times."
    : "";
  const message = ok
    ? `Yes — roughly ${totalMinutes} minutes of open work before ${formatDateOnly(opts.beforeDate)}, against about ${availableMinutes} minutes of weekday working time.${estimateNote}`
    : `It's tight: about ${totalMinutes} minutes of work before ${formatDateOnly(opts.beforeDate)} vs ~${availableMinutes} minutes of weekday time.${estimateNote} Consider moving flexible tasks, splitting large ones, or confirming which deadlines are fixed.`;
  return { ok, message, totalMinutes, availableMinutes, ranked };
}

export type PlanningCommand =
  | { kind: "plan"; period: PeriodKind; horizon: PlanHorizon }
  | { kind: "priority_first" }
  | { kind: "deadlines" }
  | { kind: "coming_up" }
  | { kind: "breakdown"; goal: string }
  | { kind: "feasibility"; beforePhrase: string }
  | { kind: "defer_low"; when: string }
  | { kind: "finish_project"; hint: string | null }
  | { kind: "overload"; period: PeriodKind };

/**
 * Map natural planning language to a canonical planning command.
 * Returns null when the text is not a planning request.
 */
export function detectPlanningCommand(raw: string): PlanningCommand | null {
  const text = raw.replace(/[.!?…]+$/g, "").trim();
  const n = text.toLowerCase();

  // Breakdown
  const breakMatch = text.match(
    /^(?:help me\s+)?(?:break(?:\s+this|\s+it|\s+that)?\s+(?:down|up|into\s+smaller\s+steps)|split\s+(?:this|it|that)|make\s+(?:a\s+)?(?:step[- ]?by[- ]?step|checklist)\s+(?:for|of))\s*(.+)?$/i
  );
  if (
    /break(?:\s+\w+)?\s+into\s+smaller/i.test(n) ||
    /^break\s+(?:this|it|that)\b/i.test(n) ||
    /^(?:help me\s+)?split\s+(?:this|it|that)\b/i.test(n)
  ) {
    const goal =
      text
        .replace(
          /^(?:help me\s+)?(?:break(?:\s+\w+)?\s+(?:down|up|into\s+smaller\s+steps?)|split)\s*(?:this|it|that)?\s*(?:into\s+smaller\s+steps?)?\s*(?:for|of|:)?\s*/i,
          ""
        )
        .trim() || "this goal";
    return { kind: "breakdown", goal };
  }
  if (breakMatch) {
    return { kind: "breakdown", goal: (breakMatch[1] || "this goal").trim() };
  }

  // Feasibility
  const finishBefore = text.match(
    /^(?:can i|could i|will i be able to|is it (?:possible|realistic) to)\s+finish\s+(?:everything|all(?:\s+(?:of\s+)?(?:this|that|my\s+work))?|it)?\s*(?:before|by)\s+(.+)$/i
  );
  if (finishBefore) return { kind: "feasibility", beforePhrase: finishBefore[1].trim() };
  if (/^(?:can i|could i)\s+finish\b/i.test(n) && /\b(?:before|by)\b/i.test(n)) {
    const m = text.match(/\b(?:before|by)\s+(.+)$/i);
    if (m) return { kind: "feasibility", beforePhrase: m[1].trim() };
  }

  // Defer low-priority
  if (
    /move\s+(?:the\s+)?(?:less|low)\s+important/i.test(n) ||
    /(?:defer|push|park)\s+(?:the\s+)?(?:less|low)[\s-]important/i.test(n) ||
    /move\s+(?:flexible|low[\s-]priority)\s+(?:work|tasks?)/i.test(n)
  ) {
    const when = /\bnext week\b/i.test(n)
      ? "next week"
      : /\btomorrow\b/i.test(n)
        ? "tomorrow"
        : "next week";
    return { kind: "defer_low", when };
  }

  // Finish project on time
  if (
    /(?:help me\s+)?finish\s+(?:my\s+)?(?:the\s+)?project\b/i.test(n) ||
    /(?:on time|before the deadline).*(?:project)|(?:project).*(?:on time|before the deadline)/i.test(
      n
    )
  ) {
    const hint = text.match(/(?:project|finish)\s+(?:for\s+|on\s+)?(.+?)(?:\s+on time)?$/i)?.[1];
    return {
      kind: "finish_project",
      hint: hint && !/^(?:on time|my project|the project|project)$/i.test(hint) ? hint : null,
    };
  }

  // What first / prioritize
  if (
    /what should i (?:work on|do|focus on|start with|prioriti[sz]e)\s+first/i.test(n) ||
    /(?:which|what)\s+(?:task|thing)\s+(?:should i|to)\s+(?:do|start|tackle)\s+first/i.test(n) ||
    /^prioriti[sz]e\s+my\s+(?:tasks?|work|day|week)\b/i.test(n) ||
    /^what(?:'s| is) (?:most )?(?:important|urgent)(?:\s+right now)?\??$/i.test(n)
  ) {
    return { kind: "priority_first" };
  }

  // Deadlines to worry about
  if (
    /which deadlines?\s+(?:should i|to)\s+(?:worry|care|focus|watch)/i.test(n) ||
    /(?:what|which)\s+deadlines?\s+(?:matter|are\s+(?:close|coming|urgent))/i.test(n) ||
    /deadlines?\s+should i worry/i.test(n)
  ) {
    return { kind: "deadlines" };
  }

  // Coming up
  if (
    /what(?:'s| is|s)?\s+coming\s+up\??$/i.test(n) ||
    /^(?:anything|what(?:'s| is)?)\s+coming\s+up\b/i.test(n) ||
    /^upcoming\??$/i.test(n)
  ) {
    return { kind: "coming_up" };
  }

  // Overload / too much (tolerate rare spell near-misses like "too such")
  if (
    /(?:too\s+(?:much|such)|swamped|overwhelmed|overloaded|can'?t keep up|drowning)\b/i.test(n) ||
    /(?:got|have)\s+too\s+(?:much|such)\s+to\s+do/i.test(n) ||
    /help me\s+(?:deal with|handle|manage)\s+(?:my\s+)?(?:workload|overload)/i.test(n)
  ) {
    const period: PeriodKind = /\bnext week\b/i.test(n)
      ? "next_week"
      : /\btomorrow\b/i.test(n)
        ? "tomorrow"
        : /\bthis month\b|\bmonth\b/i.test(n)
          ? "this_month"
          : "this_week";
    return { kind: "overload", period };
  }

  // Explicit plan requests — never treat "schedule a meeting/event" as planning.
  if (
    /^(?:help me\s+)?(?:plan|organize|structure|map out)\b/i.test(n) ||
    /^(?:help me\s+)?schedule\s+(?:out\s+)?(?:my\s+|the\s+)?(?:day|today|tomorrow|week|month|morning|afternoon|evening)\b/i.test(
      n
    ) ||
    /build me a\s+(?:day|daily|week|weekly|month|monthly)\s+plan/i.test(n) ||
    /what should i (?:do|focus on|work on|prioriti[sz]e)(?:\s+today|\s+tomorrow|\s+this week)?$/i.test(
      n
    ) ||
    /help me (?:get|stay) organized/i.test(n) ||
    /^plan\s+(?:my\s+|the\s+)?(?:day|today|tomorrow|week|month|morning|afternoon|evening)\b/i.test(
      n
    )
  ) {
    let period: PeriodKind = "today";
    let horizon: PlanHorizon = "day";
    if (/\btomorrow\b/i.test(n)) {
      period = "tomorrow";
      horizon = "day";
    } else if (/\bnext week\b/i.test(n)) {
      period = "next_week";
      horizon = "week";
    } else if (/\bthis week\b|\bweek\b/i.test(n) && !/\bweekday\b/i.test(n)) {
      period = "this_week";
      horizon = "week";
    } else if (/\bnext month\b/i.test(n)) {
      period = "next_month";
      horizon = "month";
    } else if (/\bthis month\b|\bmonth\b/i.test(n)) {
      period = "this_month";
      horizon = "month";
    } else if (/\bmorning|afternoon|evening|today|day\b/i.test(n)) {
      period = "today";
      horizon = "day";
    }
    return { kind: "plan", period, horizon };
  }

  return null;
}

/** Canonical rewrite used by understand/intent layers. */
export function planningCommandToText(cmd: PlanningCommand): string {
  switch (cmd.kind) {
    case "plan":
      if (cmd.period === "tomorrow") return "plan my tomorrow";
      if (cmd.period === "this_week") return "plan my week";
      if (cmd.period === "next_week") return "plan my next week";
      if (cmd.period === "this_month") return "plan my month";
      if (cmd.period === "next_month") return "plan my next month";
      return "plan my day";
    case "priority_first":
      return "what should I work on first";
    case "deadlines":
      return "which deadlines should I worry about";
    case "coming_up":
      return "what's coming up";
    case "breakdown":
      return `break down ${cmd.goal}`;
    case "feasibility":
      return `can I finish everything before ${cmd.beforePhrase}`;
    case "defer_low":
      return `move less important work to ${cmd.when}`;
    case "finish_project":
      return cmd.hint ? `help me finish ${cmd.hint} on time` : "help me finish my project on time";
    case "overload":
      if (cmd.period === "tomorrow") return "too much to do tomorrow";
      if (cmd.period === "this_month") return "too much to do this month";
      return "too much to do this week";
  }
}

export function planToBlock(plan: SuggestedPlan, title?: string): Extract<AssistantBlock, { type: "schedule" }> {
  return {
    type: "schedule",
    title: title ?? `Suggested plan · ${plan.periodLabel}`,
    saved: false,
    note: plan.overloaded
      ? plan.overloadNote ?? "Workload may be unrealistic — see message for options."
      : "This is a suggestion. It has not been saved to your calendar.",
    slots: plan.slots.map((s) => ({
      time_label: s.time_label,
      title: s.title,
      minutes: s.minutes,
      task_id: s.task_id,
      kind: s.kind,
    })),
  };
}

export function describePlan(plan: SuggestedPlan): string {
  const lines: string[] = [];
  if (plan.slots.filter((s) => s.kind === "task").length === 0) {
    lines.push(`Nothing open to plan for ${plan.periodLabel}.`);
  } else if (plan.horizon === "day") {
    lines.push(
      `Here’s a suggested plan for ${plan.periodLabel} (${plan.workStart}–${plan.workEnd}):`
    );
  } else {
    lines.push(`Here’s a prioritized order for ${plan.periodLabel}:`);
  }

  for (const slot of plan.slots) {
    const extra =
      slot.kind === "task" && slot.reason ? ` — ${slot.reason}` : slot.kind === "event" ? " (calendar)" : "";
    const est =
      slot.kind === "task" && slot.estimated ? ` ~${slot.minutes}m est.` : slot.minutes ? ` ${slot.minutes}m` : "";
    lines.push(`• ${slot.time_label} ${slot.title}${est}${extra}`);
  }

  for (const exp of plan.explanations) lines.push(exp);
  if (plan.overloaded && plan.overloadNote) lines.push(plan.overloadNote);
  lines.push("Nothing was saved. Say “save this plan” if you want calendar blocks created.");
  return lines.join("\n");
}

export function storePlanInContext(context: ConversationContext, plan: SuggestedPlan): void {
  context.lastPlan = {
    horizon: plan.horizon,
    periodLabel: plan.periodLabel,
    workStart: plan.workStart,
    workEnd: plan.workEnd,
    overloaded: plan.overloaded,
    slots: plan.slots.map((s) => ({
      time_label: s.time_label,
      title: s.title,
      minutes: s.minutes,
      task_id: s.task_id,
      kind: s.kind,
    })),
  };
  const taskSlots = plan.slots.filter((s) => s.kind === "task" && s.task_id);
  if (taskSlots.length) {
    context.lastTasks = taskSlots.slice(0, 20).map((s) => ({
      id: s.task_id!,
      title: s.title,
    }));
    const first = taskSlots[0];
    if (first.task_id) {
      context.focus = {
        kind: "task",
        id: first.task_id,
        label: first.title,
        detail: null,
      };
    }
  }
}

function rebuildFromSlots(
  context: ConversationContext,
  slots: ScheduleSlot[],
  patch?: Partial<NonNullable<ConversationContext["lastPlan"]>>
): SuggestedPlan {
  const prev = context.lastPlan;
  const plan: SuggestedPlan = {
    horizon: (patch?.horizon as PlanHorizon) ?? (prev?.horizon as PlanHorizon) ?? "day",
    periodKind: "today",
    periodLabel: patch?.periodLabel ?? prev?.periodLabel ?? "Plan",
    slots: slots.map((s) => ({ ...s })),
    explanations: ["Updated from your follow-up."],
    overloaded: patch?.overloaded ?? prev?.overloaded ?? false,
    overloadNote: null,
    totalTaskMinutes: slots.filter((s) => s.kind === "task").reduce((a, s) => a + s.minutes, 0),
    availableMinutes: null,
    usedEstimates: true,
    workStart: patch?.workStart ?? prev?.workStart ?? "09:00",
    workEnd: patch?.workEnd ?? prev?.workEnd ?? "17:00",
    defaultDurationUsed: true,
  };
  storePlanInContext(context, plan);
  return plan;
}

/**
 * Apply natural follow-ups to the last suggested plan.
 * Returns null when the utterance is not a plan follow-up.
 */
export function applyPlanFollowUp(
  raw: string,
  context: ConversationContext,
  board: Board
): { plan: SuggestedPlan; message: string; saveRequested?: boolean; preferProjectId?: string } | null {
  if (!context.lastPlan?.slots?.length) return null;
  const cleaned = raw.replace(/[.!?…]+$/g, "").trim();
  const norm = cleaned.toLowerCase();
  const slots = [...context.lastPlan.slots];

  // Save
  if (
    /^(?:save(?:\s+this)?\s+plan|keep\s+this\s+plan|add\s+(?:this\s+)?(?:plan|schedule)\s+to\s+(?:my\s+)?calendar)\b/i.test(
      norm
    )
  ) {
    return {
      plan: rebuildFromSlots(context, slots),
      message: "save",
      saveRequested: true,
    };
  }

  // Make plan shorter / compress
  if (
    /^(?:make it shorter|shorten (?:the )?plan|fewer tasks|cut (?:it|the plan) down|less work)\b/i.test(
      norm
    )
  ) {
    const tasks = slots.filter((s) => s.kind === "task");
    const events = slots.filter((s) => s.kind === "event");
    const keep = Math.max(1, Math.ceil(tasks.length * 0.6));
    const next = [...events, ...tasks.slice(0, keep)];
    const plan = rebuildFromSlots(context, next);
    return {
      plan,
      message: describePlan({
        ...plan,
        explanations: [
          `Shortened the plan to the top ${keep} task${keep === 1 ? "" : "s"} (plus calendar events).`,
        ],
      }),
    };
  }

  // Start at time
  const startAt = cleaned.match(
    /^(?:what if i |can we |could we )?(?:start(?:\s+at)?|begin(?:\s+at)?)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i
  );
  if (startAt) {
    let h = Number(startAt[1]);
    const m = Number(startAt[2] ?? 0);
    const meridiem = (startAt[3] || "").toLowerCase();
    if (meridiem === "pm" && h < 12) h += 12;
    if (meridiem === "am" && h === 12) h = 0;
    const startMin = h * 60 + m;
    const workStart = formatHm(startMin);
    let cursor = startMin;
    const next = slots.map((s) => {
      if (s.kind === "event") return s;
      const label = formatHm(cursor);
      cursor += s.minutes || board.defaultDuration;
      return { ...s, time_label: label };
    });
    const plan = rebuildFromSlots(context, next, { workStart });
    return {
      plan,
      message: describePlan({
        ...plan,
        explanations: [`Rescheduled task blocks to start at ${workStart}. Calendar events stayed put.`],
      }),
    };
  }

  // Move Nth task to afternoon / morning / evening / time
  const moveNth = cleaned.match(
    /^(?:move\s+)?(?:the\s+)?(first|second|third|fourth|1st|2nd|3rd|4th|\d+)(?:st|nd|rd|th)?\s+task\s+to\s+(?:the\s+)?(afternoon|morning|evening|\d{1,2}(?::\d{2})?\s*(?:am|pm)?)$/i
  );
  if (moveNth) {
    const ord = moveNth[1].toLowerCase();
    const ordMap: Record<string, number> = {
      first: 0,
      "1st": 0,
      "1": 0,
      second: 1,
      "2nd": 1,
      "2": 1,
      third: 2,
      "3rd": 2,
      "3": 2,
      fourth: 3,
      "4th": 3,
      "4": 3,
    };
    const idx = ordMap[ord] ?? Math.max(0, Number(ord) - 1);
    const when = moveNth[2].toLowerCase();
    const timeLabel = /afternoon/.test(when)
      ? "13:00"
      : /morning/.test(when)
        ? "09:00"
        : /evening/.test(when)
          ? "17:00"
          : when.replace(/\s+/g, "").replace(/(am|pm)/i, (m) => m.toLowerCase());
    const tasks = slots.filter((s) => s.kind === "task");
    if (tasks[idx]) {
      tasks[idx] = { ...tasks[idx], time_label: timeLabel.slice(0, 5) };
      const events = slots.filter((s) => s.kind === "event");
      const plan = rebuildFromSlots(context, [...events, ...tasks]);
      return {
        plan,
        message: describePlan({
          ...plan,
          explanations: [`Moved “${tasks[idx].title}” to ${tasks[idx].time_label}.`],
        }),
      };
    }
  }

  // Remove finished / remove one I've finished
  if (
    /remove\s+(?:the\s+)?(?:one\s+)?(?:i(?:'ve| have)\s+)?finished/i.test(norm) ||
    /remove\s+(?:completed|done)\s+tasks?/i.test(norm) ||
    /^drop\s+(?:what(?:'s| is)\s+)?(?:already\s+)?done\b/i.test(norm)
  ) {
    const next = slots.filter((s) => {
      if (s.kind !== "task" || !s.task_id) return true;
      const task = board.tasks.find((t) => t.id === s.task_id);
      return !task || incomplete(task);
    });
    const removed = slots.length - next.length;
    const plan = rebuildFromSlots(context, next);
    return {
      plan,
      message: describePlan({
        ...plan,
        explanations: [
          removed
            ? `Removed ${removed} finished item${removed === 1 ? "" : "s"} from the plan.`
            : "Nothing in the plan is marked done yet — tell me which title to drop.",
        ],
      }),
    };
  }

  // Actually finish project first
  if (
    /(?:actually[, ]+)?(?:i need to |let'?s |please )?finish\s+(?:the\s+|my\s+)?project\s+first/i.test(
      norm
    ) ||
    /(?:project|that project)\s+first\b/i.test(norm)
  ) {
    const projectId =
      context.lastProject?.id ??
      board.projects.find((p) => p.status === "active")?.id ??
      null;
    if (projectId) {
      const projectTasks = new Set(
        board.tasks.filter((t) => t.project_id === projectId && incomplete(t)).map((t) => t.id)
      );
      const tasks = slots.filter((s) => s.kind === "task");
      const events = slots.filter((s) => s.kind === "event");
      const prioritized = [
        ...tasks.filter((s) => s.task_id && projectTasks.has(s.task_id)),
        ...tasks.filter((s) => !s.task_id || !projectTasks.has(s.task_id)),
      ];
      // Re-stamp times from work start
      let cursor = parseHm(context.lastPlan.workStart, "09:00");
      const restamped = prioritized.map((s) => {
        const label = formatHm(cursor);
        cursor += s.minutes || board.defaultDuration;
        return { ...s, time_label: label };
      });
      const plan = rebuildFromSlots(context, [...events, ...restamped]);
      return {
        plan,
        message: describePlan({
          ...plan,
          explanations: ["Put project-related tasks first, then the rest."],
        }),
        preferProjectId: projectId,
      };
    }
  }

  return null;
}

export function planningStyleFromBoard(board: Board): string | null {
  const mem = board.memories?.find(
    (m) => m.key === "planning_style" || /priority.?first|time.?blocked|flexible/i.test(m.content)
  );
  if (!mem) return null;
  if (/priority/i.test(mem.content)) return "priority_first";
  if (/time/i.test(mem.content)) return "time_blocked";
  if (/flexible/i.test(mem.content)) return "flexible";
  return null;
}

export function todayInBoard(board: Board): string {
  return calendarToday(board.timezone, board.now);
}
