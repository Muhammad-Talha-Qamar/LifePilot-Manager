import type {
  CalendarEvent,
  Checklist,
  ChecklistItem,
  Project,
  Task,
  UserMemory,
} from "@/types";

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

/**
 * Unresolved action waiting for the user to name a record
 * (e.g. "Which task should I move to Friday?" → "The science assignment.").
 */
export interface PendingRequest {
  kind: "reschedule" | "complete" | "delete" | "priority" | "show" | "update_title" | "replay";
  question: string;
  when?: string | null;
  priority?: string | null;
  titleHint?: string | null;
  candidateIds?: string[];
  replay?: {
    tool: string;
    templateArgs: Record<string, unknown>;
    label: string;
  } | null;
}

/** Snapshot of the last successful conversational action for ellipsis / "do the same". */
export interface LastTurn {
  action:
    | "create_task"
    | "update_task"
    | "complete_task"
    | "delete_task"
    | "query"
    | "create_checklist"
    | "other";
  title?: string;
  dueDate?: string | null;
  categoryHint?: string | null;
  replay?: {
    tool: string;
    templateArgs: Record<string, unknown>;
    label: string;
  } | null;
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
  /** Ambiguous spelling / intent awaiting a yes/no (Google-like confirm). */
  pendingInterpretation?: {
    question: string;
    acceptedText: string;
  } | null;
  /** Action awaiting an entity answer (not a date option list). */
  pendingRequest?: PendingRequest | null;
  /** Last successful turn — used for elliptical follow-ups and corrections. */
  lastTurn?: LastTurn | null;
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

export interface AgentStep {
  name: string;
  label: string;
  status: "running" | "done" | "error";
}

export type AssistantBlock =
  | { type: "tasks"; title: string; tasks: TaskCardData[] }
  | { type: "events"; title: string; events: EventCardData[] }
  | { type: "checklists"; title: string; checklists: ChecklistCardData[] }
  | { type: "projects"; title: string; projects: ProjectCardData[] }
  | { type: "schedule"; title: string; saved: false; note: string; slots: ScheduleSlot[] }
  | { type: "confirm"; prompt: string; action: PendingAction }
  | { type: "notice"; tone: "info" | "success" | "error"; text: string }
  | {
      type: "interpretation";
      /** Short label, e.g. "I think you mean" or "Did you mean". */
      label: string;
      /** Corrected / interpreted sentence. */
      text: string;
      /** True when asking for confirmation instead of proceeding. */
      uncertain?: boolean;
    }
  | { type: "steps"; title: string; steps: AgentStep[] }
  | { type: "followups"; suggestions: string[] };

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
  /** Relevant persistent memories for this turn (not live task state). */
  memories?: UserMemory[];
}

export function emptyContext(): ConversationContext {
  return {
    lastTasks: [],
    lastItems: [],
    undo: [],
    pendingRequest: null,
    lastTurn: null,
  };
}
