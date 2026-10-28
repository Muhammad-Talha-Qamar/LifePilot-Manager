import type { CalendarEvent, ChecklistItem, Project, Task } from "@/types";
import { isOverdue } from "@/lib/utils/dates";
import { checklistProgress, projectProgress } from "@/lib/utils/progress";
import type {
  AssistantBlock,
  ChecklistCardData,
  EventCardData,
  ProjectCardData,
  ScheduleQueryResult,
  TaskCardData,
} from "./types";

export function toTaskCard(
  task: Task,
  projects: Project[],
  timezone: string
): TaskCardData {
  const project = projects.find((item) => item.id === task.project_id);
  return {
    id: task.id,
    title: task.title,
    priority: task.priority,
    due_date: task.due_date,
    due_time: task.due_time,
    status: task.status,
    project_id: task.project_id,
    project_name: project?.name ?? null,
    estimated_minutes: task.estimated_minutes,
    overdue: isOverdue(task.due_date, task.due_time, timezone, task.status),
  };
}

export function toEventCard(event: CalendarEvent): EventCardData {
  return {
    id: event.id,
    title: event.title,
    event_type: event.event_type,
    start_at: event.start_at,
    end_at: event.end_at,
    all_day: event.all_day,
    location: event.location,
    project_id: event.project_id,
  };
}

export function toChecklistCard(
  checklist: { id: string; title: string; project_id: string | null },
  items: ChecklistItem[],
  projects: Project[]
): ChecklistCardData {
  const project = projects.find((item) => item.id === checklist.project_id);
  return {
    id: checklist.id,
    title: checklist.title,
    project_id: checklist.project_id,
    project_name: project?.name ?? null,
    items: [...items]
      .sort((a, b) => a.position - b.position)
      .map((item) => ({
        id: item.id,
        title: item.title,
        is_completed: item.is_completed,
        position: item.position,
      })),
  };
}

export function toProjectCard(
  project: Project,
  tasks: Task[],
  items: ChecklistItem[]
): ProjectCardData {
  const related = tasks.filter((task) => task.project_id === project.id);
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    status: project.status,
    priority: project.priority,
    deadline: project.deadline,
    progress_percent: projectProgress(related, items).percent,
    tasks: related.slice(0, 8).map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      due_date: task.due_date,
    })),
  };
}

export function scheduleBlocks(
  result: ScheduleQueryResult,
  projects: Project[]
): AssistantBlock[] {
  const blocks: AssistantBlock[] = [];
  if (result.tasks.length || result.period.kind !== "overdue") {
    blocks.push({
      type: "tasks",
      title: result.period.kind === "overdue" ? "Overdue tasks" : `Tasks · ${result.period.label}`,
      tasks: result.tasks.map((task) => toTaskCard(task, projects, result.timezone)),
    });
  }
  if (result.overdue_tasks.length) {
    blocks.push({
      type: "tasks",
      title: "Overdue",
      tasks: result.overdue_tasks.map((task) => toTaskCard(task, projects, result.timezone)),
    });
  }
  if (result.events.length) {
    blocks.push({
      type: "events",
      title: `Events · ${result.period.label}`,
      events: result.events.map(toEventCard),
    });
  }
  if (result.projects.length) {
    blocks.push({
      type: "projects",
      title: `Project deadlines · ${result.period.label}`,
      projects: result.projects.map((project) => toProjectCard(project, result.tasks, [])),
    });
  }
  return blocks;
}

export function blocksFromToolCalls(
  calls: { name: string; success: boolean; result: unknown }[],
  timezone: string
): AssistantBlock[] {
  const blocks: AssistantBlock[] = [];
  for (const call of calls) {
    if (!call.success || call.result == null) continue;
    if (call.name === "query_schedule") {
      const schedule = call.result as ScheduleQueryResult;
      blocks.push(...scheduleBlocks(schedule, schedule.projects));
      continue;
    }
    if (
      call.name === "create_task" ||
      call.name === "update_task" ||
      call.name === "complete_task" ||
      call.name === "get_task"
    ) {
      blocks.push({
        type: "tasks",
        title: "Task",
        tasks: [toTaskCard(call.result as Task, [], timezone)],
      });
      continue;
    }
    if (call.name === "list_tasks" && Array.isArray(call.result)) {
      blocks.push({
        type: "tasks",
        title: "Tasks",
        tasks: (call.result as Task[]).map((task) => toTaskCard(task, [], timezone)),
      });
      continue;
    }
    if (call.name === "move_tasks_to_project") {
      const payload = call.result as { updated?: Task[]; project?: Project };
      if (payload.updated?.length) {
        blocks.push({
          type: "tasks",
          title: payload.project?.name ?? "Moved tasks",
          tasks: payload.updated.map((task) =>
            toTaskCard(task, payload.project ? [payload.project] : [], timezone)
          ),
        });
      }
      continue;
    }
    if (call.name === "create_project" || call.name === "update_project") {
      blocks.push({
        type: "projects",
        title: "Project",
        projects: [toProjectCard(call.result as Project, [], [])],
      });
      continue;
    }
    if (call.name === "list_projects" && Array.isArray(call.result)) {
      blocks.push({
        type: "projects",
        title: "Projects",
        projects: (call.result as Project[]).map((project) =>
          toProjectCard(project, [], [])
        ),
      });
      continue;
    }
    if (call.name === "create_checklist" || call.name === "add_checklist_items" || call.name === "complete_checklist_items") {
      const payload = call.result as {
        checklist: { id: string; title: string; project_id: string | null };
        items?: ChecklistItem[];
        all_items?: ChecklistItem[];
      };
      const items = payload.all_items ?? payload.items ?? [];
      if (payload.checklist) {
        blocks.push({
          type: "checklists",
          title: payload.checklist.title,
          checklists: [toChecklistCard(payload.checklist, items, [])],
        });
      }
    }
    if (call.name === "create_event" || call.name === "update_event") {
      blocks.push({
        type: "events",
        title: "Event",
        events: [toEventCard(call.result as CalendarEvent)],
      });
      continue;
    }
    if (call.name === "propose_daily_plan") {
      const plan = call.result as {
        plan: { task_id: string; title: string; estimated_minutes: number }[];
        available_minutes: number;
      };
      blocks.push({
        type: "schedule",
        title: "Suggested plan",
        saved: false,
        note: "This suggestion has not been saved to the calendar.",
        slots: plan.plan.map((slot, index) => ({
          time_label: `Block ${index + 1}`,
          title: slot.title,
          minutes: slot.estimated_minutes,
          task_id: slot.task_id,
          kind: "task" as const,
        })),
      });
    }
  }
  return blocks;
}

export function checklistProgressLabel(card: ChecklistCardData): string {
  const progress = checklistProgress(
    card.items.map((item) => ({
      ...item,
      checklist_id: card.id,
      user_id: "",
      due_date: null,
      completed_at: null,
      created_at: "",
      updated_at: "",
    }))
  );
  return `${progress.completed}/${progress.total} complete · ${progress.percent}%`;
}
