export type TaskStatus = "todo" | "in_progress" | "done" | "cancelled";
export type Priority = "low" | "medium" | "high" | "urgent";
export type ProjectStatus = "active" | "on_hold" | "completed" | "archived";
export type EventType =
  | "event"
  | "meeting"
  | "appointment"
  | "exam"
  | "deadline"
  | "important_date";

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  timezone: string;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  due_date: string | null;
  due_time: string | null;
  category: string | null;
  project_id: string | null;
  checklist_id: string | null;
  tags: string[];
  estimated_minutes: number | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Checklist {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  category: string | null;
  project_id: string | null;
  is_template: boolean;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface ChecklistItem {
  id: string;
  checklist_id: string;
  user_id: string;
  title: string;
  is_completed: boolean;
  due_date: string | null;
  position: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  priority: Priority;
  start_date: string | null;
  deadline: string | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface CalendarEvent {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  location: string | null;
  event_type: EventType;
  start_at: string;
  end_at: string;
  all_day: boolean;
  project_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Reminder {
  id: string;
  user_id: string;
  title: string;
  body: string | null;
  remind_at: string;
  related_type: "task" | "event" | "checklist_item" | "project" | "custom";
  related_id: string | null;
  is_read: boolean;
  is_delivered: boolean;
  delivered_at: string | null;
  created_at: string;
}

export interface ProductivityPreferences {
  id: string;
  user_id: string;
  preferred_working_hours_start: string | null;
  preferred_working_hours_end: string | null;
  planning_style: "time_blocked" | "priority_first" | "flexible" | null;
  default_task_duration_minutes: number | null;
  timezone: string;
  week_starts_on: 0 | 1;
  reminder_lead_minutes: number;
  categories: string[];
  created_at: string;
  updated_at: string;
}

export interface AiMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  tool_calls?: AiToolCallRecord[];
  created_at: string;
}

export interface AiToolCallRecord {
  name: string;
  arguments: Record<string, unknown>;
  result: unknown;
  success: boolean;
}

export interface ProductivitySummary {
  today_tasks: Task[];
  overdue_tasks: Task[];
  upcoming_deadlines: Task[];
  upcoming_events: CalendarEvent[];
  active_projects: Project[];
  incomplete_checklist_items: number;
  completion_rate_7d: number;
  unread_reminders: number;
}
