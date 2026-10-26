import type { CalendarEvent, Checklist, ChecklistItem, Project, Task } from "@/types";

export interface EntityRef {
  id: string;
  title: string;
}

export interface UndoEntry {
  label: string;
  tool: string;
  args: Record<string, unknown>;
}

export interface PendingAction {
  tool: string;
  args: Record<string, unknown>;
  summary: string;
}

export interface PendingClarification {
  question: string;
  target:
    | { type: "task"; id: string; field: "due_date" }
    | { type: "project"; id: string; field: "deadline" }
    | { type: "create_task"; title: string; priority?: string };
  options: { label: string; date: string }[];
}

export interface ConversationContext {
  lastProject?: { id: string; name: string } | null;
  lastChecklist?: { id: string; title: string } | null;
  lastTasks?: EntityRef[];
  lastItems?: { id: string; title: string; checklist_id: string }[];
  focus?: {
    kind: "task" | "project" | "checklist" | "event";
    id: string;
    label: string;
    detail?: string | null;
  } | null;
  pending?: PendingAction | null;
  pendingClarification?: PendingClarification | null;
  undo?: UndoEntry[];
}

export interface TaskCardData {
  id: string;
  title: string;
  priority: string;
  due_date: string | null;
  due_time: string | null;
  status: string;
  project_id: string | null;
  project_name: string | null;
  estimated_minutes: number | null;
  overdue: boolean;
}

export interface EventCardData {
  id: string;
  title: string;
  event_type: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
  location: string | null;
  project_id: string | null;
}

export interface ChecklistCardData {
  id: string;
  title: string;
  project_id: string | null;
  project_name: string | null;
  items: {
    id: string;
    title: string;
    is_completed: boolean;
    position: number;
  }[];
}

export interface ProjectCardData {
  id: string;
  name: string;
  description: string | null;
  status: string;
  priority: string;
  deadline: string | null;
  progress_percent: number;
  tasks: { id: string; title: string; status: string; due_date: string | null }[];
}

export interface ScheduleSlot {
  time_label: string;
  title: string;
  minutes: number;
  task_id?: string;
  kind: "task" | "event";
}

export type AssistantBlock =
  | { type: "tasks"; title: string; tasks: TaskCardData[] }
  | { type: "events"; title: string; events: EventCardData[] }
  | { type: "checklists"; title: string; checklists: ChecklistCardData[] }
  | { type: "projects"; title: string; projects: ProjectCardData[] }
  | { type: "schedule"; title: string; saved: false; note: string; slots: ScheduleSlot[] }
  | { type: "confirm"; prompt: string; action: PendingAction }
  | { type: "notice"; tone: "info" | "success" | "error"; text: string };

export interface ScheduleQueryResult {
  period: { kind: string; label: string; from: string | null; to: string | null };
  timezone: string;
  tasks: Task[];
  overdue_tasks: Task[];
  events: CalendarEvent[];
  projects: Project[];
  completed_omitted: number;
  estimated_minutes: number;
}

export interface Board {
  tasks: Task[];
  projects: Project[];
  checklists: (Checklist & { items: ChecklistItem[] })[];
  events: CalendarEvent[];
  timezone: string;
  weekStartsOn: 0 | 1;
  now: Date;
  defaultDuration: number;
  workStart: string | null;
  workEnd: string | null;
}

export function emptyContext(): ConversationContext {
  return { lastTasks: [], lastItems: [], undo: [] };
}
