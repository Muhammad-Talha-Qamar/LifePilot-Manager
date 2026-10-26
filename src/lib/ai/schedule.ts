import type { AuthContext } from "@/lib/data/auth";
import {
  getPreferences,
  listEvents,
  listProjects,
  listTasks,
} from "@/lib/data/repository";
import { DEFAULT_TIMEZONE } from "@/lib/config";
import {
  calendarToday,
  eventLocalDate,
  isOverdue,
  periodWindow,
  type PeriodKind,
} from "@/lib/utils/dates";
import type { CalendarEvent, Project, Task } from "@/types";
import type { ScheduleQueryResult } from "./types";

function incomplete(task: Task): boolean {
  return task.status !== "done" && task.status !== "cancelled";
}

export function buildScheduleResult(input: {
  tasks: Task[];
  events: CalendarEvent[];
  projects: Project[];
  kind: PeriodKind;
  timezone: string;
  weekStartsOn: 0 | 1;
  now?: Date;
  from?: string;
  to?: string;
  defaultDuration?: number;
}): ScheduleQueryResult {
  const now = input.now ?? new Date();
  const period = periodWindow(
    input.kind,
    input.timezone,
    input.weekStartsOn,
    now,
    { from: input.from, to: input.to }
  );
  const today = calendarToday(input.timezone, now);
  const duration = input.defaultDuration ?? 45;

  const inWindow = (day: string | null) => {
    if (!day) return false;
    const value = day.slice(0, 10);
    if (period.from && value < period.from) return false;
    if (period.to && value > period.to) return false;
    return Boolean(period.from || period.to);
  };

  let tasks: Task[] = [];
  let completedOmitted = 0;

  if (input.kind === "overdue") {
    tasks = input.tasks.filter((task) =>
      isOverdue(task.due_date, task.due_time, input.timezone, task.status, now)
    );
  } else if (input.kind === "no_deadline") {
    tasks = input.tasks.filter((task) => incomplete(task) && !task.due_date);
  } else {
    for (const task of input.tasks) {
      if (!task.due_date || !inWindow(task.due_date)) continue;
      if (!incomplete(task)) {
        completedOmitted += 1;
        continue;
      }
      tasks.push(task);
    }
  }

  const overdueTasks =
    input.kind === "today" || input.kind === "this_week"
      ? input.tasks.filter(
          (task) =>
            incomplete(task) &&
            task.due_date &&
            task.due_date.slice(0, 10) < today &&
            isOverdue(task.due_date, task.due_time, input.timezone, task.status, now)
        )
      : [];

  const overdueIds = new Set(overdueTasks.map((task) => task.id));
  tasks = tasks.filter((task) => !overdueIds.has(task.id));

  const events =
    input.kind === "overdue" || input.kind === "no_deadline"
      ? []
      : input.events.filter((event) => inWindow(eventLocalDate(event.start_at, input.timezone)));

  const projects =
    input.kind === "overdue" || input.kind === "no_deadline"
      ? []
      : input.projects.filter(
          (project) =>
            project.status !== "completed" &&
            project.status !== "archived" &&
            inWindow(project.deadline)
        );

  const estimated = tasks.reduce(
    (sum, task) => sum + (task.estimated_minutes ?? duration),
    0
  );

  return {
    period,
    timezone: input.timezone,
    tasks,
    overdue_tasks: overdueTasks,
    events,
    projects,
    completed_omitted: completedOmitted,
    estimated_minutes: estimated,
  };
}

export async function querySchedule(
  auth: AuthContext,
  raw: { period?: string; from?: string; to?: string }
): Promise<ScheduleQueryResult> {
  const prefs = await getPreferences(auth);
  const timezone = prefs.timezone || auth.profile.timezone || DEFAULT_TIMEZONE;
  const kind = (raw.period || "range") as PeriodKind;
  const [tasks, events, projects] = await Promise.all([
    listTasks({ limit: 200 }, auth),
    listEvents({ limit: 200 }, auth),
    listProjects(auth),
  ]);
  return buildScheduleResult({
    tasks,
    events,
    projects,
    kind,
    timezone,
    weekStartsOn: prefs.week_starts_on ?? 1,
    from: raw.from,
    to: raw.to,
    defaultDuration: prefs.default_task_duration_minutes ?? 45,
  });
}
