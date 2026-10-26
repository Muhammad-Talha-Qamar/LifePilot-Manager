import { addDays, format } from "date-fns";
import { DEFAULT_TIMEZONE, DEMO_USER_EMAIL, DEMO_USER_ID } from "@/lib/config";
import type {
  CalendarEvent,
  Checklist,
  ChecklistItem,
  ProductivityPreferences,
  Profile,
  Project,
  Reminder,
  Task,
} from "@/types";

function isoDaysFromNow(days: number, time = "09:00:00"): string {
  const d = addDays(new Date(), days);
  return `${format(d, "yyyy-MM-dd")}T${time}.000Z`;
}

function dateDaysFromNow(days: number): string {
  return format(addDays(new Date(), days), "yyyy-MM-dd");
}

export interface DemoStore {
  profile: Profile;
  preferences: ProductivityPreferences;
  projects: Project[];
  tasks: Task[];
  checklists: Checklist[];
  checklist_items: ChecklistItem[];
  events: CalendarEvent[];
  reminders: Reminder[];
}

export function createSeedStore(): DemoStore {
  const now = new Date().toISOString();
  const projectId = "11111111-1111-4111-8111-111111111111";
  const checklistId = "22222222-2222-4222-8222-222222222222";

  const profile: Profile = {
    id: DEMO_USER_ID,
    email: DEMO_USER_EMAIL,
    full_name: "Demo User",
    avatar_url: null,
    timezone: DEFAULT_TIMEZONE,
    created_at: now,
    updated_at: now,
  };

  const preferences: ProductivityPreferences = {
    id: "33333333-3333-4333-8333-333333333333",
    user_id: DEMO_USER_ID,
    preferred_working_hours_start: "09:00",
    preferred_working_hours_end: "17:00",
    planning_style: "priority_first",
    default_task_duration_minutes: 45,
    timezone: profile.timezone,
    week_starts_on: 1,
    reminder_lead_minutes: 60,
    categories: ["Homework", "Exams", "Personal", "Health"],
    created_at: now,
    updated_at: now,
  };

  const projects: Project[] = [
    {
      id: projectId,
      user_id: DEMO_USER_ID,
      name: "History Research Project",
      description: "Organize research, outline, and final draft for history class.",
      status: "active",
      priority: "high",
      start_date: dateDaysFromNow(-7),
      deadline: dateDaysFromNow(7),
      is_archived: false,
      created_at: now,
      updated_at: now,
    },
  ];

  const tasks: Task[] = [
    {
      id: "44444444-4444-4444-8444-444444444401",
      user_id: DEMO_USER_ID,
      title: "Finish maths homework",
      description: "Chapter 5 problems 1–20",
      status: "todo",
      priority: "high",
      due_date: dateDaysFromNow(0),
      due_time: "18:00",
      category: "Homework",
      project_id: null,
      checklist_id: null,
      tags: ["maths", "school"],
      estimated_minutes: 45,
      completed_at: null,
      created_at: now,
      updated_at: now,
    },
    {
      id: "44444444-4444-4444-8444-444444444402",
      user_id: DEMO_USER_ID,
      title: "Read history sources",
      description: "Primary sources for research paper",
      status: "in_progress",
      priority: "medium",
      due_date: dateDaysFromNow(2),
      due_time: null,
      category: "Homework",
      project_id: projectId,
      checklist_id: null,
      tags: ["history"],
      estimated_minutes: 60,
      completed_at: null,
      created_at: now,
      updated_at: now,
    },
    {
      id: "44444444-4444-4444-8444-444444444403",
      user_id: DEMO_USER_ID,
      title: "Submit science lab report",
      description: null,
      status: "todo",
      priority: "urgent",
      due_date: dateDaysFromNow(-1),
      due_time: null,
      category: "Homework",
      project_id: null,
      checklist_id: null,
      tags: ["science"],
      estimated_minutes: 30,
      completed_at: null,
      created_at: now,
      updated_at: now,
    },
    {
      id: "44444444-4444-4444-8444-444444444404",
      user_id: DEMO_USER_ID,
      title: "Outline history paper",
      description: "Create section outline",
      status: "todo",
      priority: "high",
      due_date: dateDaysFromNow(4),
      due_time: null,
      category: "Homework",
      project_id: projectId,
      checklist_id: null,
      tags: ["history"],
      estimated_minutes: 40,
      completed_at: null,
      created_at: now,
      updated_at: now,
    },
  ];

  const checklists: Checklist[] = [
    {
      id: checklistId,
      user_id: DEMO_USER_ID,
      title: "Science exam prep",
      description: "Checklist for upcoming science exam",
      category: "Exams",
      project_id: null,
      is_template: false,
      is_archived: false,
      created_at: now,
      updated_at: now,
    },
  ];

  const checklist_items: ChecklistItem[] = [
    {
      id: "55555555-5555-4555-8555-555555555501",
      checklist_id: checklistId,
      user_id: DEMO_USER_ID,
      title: "Review chapter notes",
      is_completed: true,
      due_date: dateDaysFromNow(-2),
      position: 0,
      completed_at: now,
      created_at: now,
      updated_at: now,
    },
    {
      id: "55555555-5555-4555-8555-555555555502",
      checklist_id: checklistId,
      user_id: DEMO_USER_ID,
      title: "Practice past paper",
      is_completed: false,
      due_date: dateDaysFromNow(1),
      position: 1,
      completed_at: null,
      created_at: now,
      updated_at: now,
    },
    {
      id: "55555555-5555-4555-8555-555555555503",
      checklist_id: checklistId,
      user_id: DEMO_USER_ID,
      title: "Memorize key formulas",
      is_completed: false,
      due_date: dateDaysFromNow(2),
      position: 2,
      completed_at: null,
      created_at: now,
      updated_at: now,
    },
  ];

  const events: CalendarEvent[] = [
    {
      id: "66666666-6666-4666-8666-666666666601",
      user_id: DEMO_USER_ID,
      title: "Science exam",
      description: "Room 204",
      location: "School — Room 204",
      event_type: "exam",
      start_at: isoDaysFromNow(3, "10:00:00"),
      end_at: isoDaysFromNow(3, "11:30:00"),
      all_day: false,
      project_id: null,
      created_at: now,
      updated_at: now,
    },
    {
      id: "66666666-6666-4666-8666-666666666602",
      user_id: DEMO_USER_ID,
      title: "History project deadline",
      description: "Final submission",
      location: null,
      event_type: "deadline",
      start_at: isoDaysFromNow(7, "00:00:00"),
      end_at: isoDaysFromNow(7, "23:59:00"),
      all_day: true,
      project_id: projectId,
      created_at: now,
      updated_at: now,
    },
  ];

  const reminders: Reminder[] = [
    {
      id: "77777777-7777-4777-8777-777777777701",
      user_id: DEMO_USER_ID,
      title: "Science lab report is overdue",
      body: "Submit your science lab report as soon as possible.",
      remind_at: now,
      related_type: "task",
      related_id: "44444444-4444-4444-8444-444444444403",
      is_read: false,
      is_delivered: true,
      delivered_at: now,
      created_at: now,
    },
  ];

  return {
    profile,
    preferences,
    projects,
    tasks,
    checklists,
    checklist_items,
    events,
    reminders,
  };
}
