import { z } from "zod";

export const prioritySchema = z.enum(["low", "medium", "high", "urgent"]);
export const taskStatusSchema = z.enum([
  "todo",
  "in_progress",
  "done",
  "cancelled",
]);
export const projectStatusSchema = z.enum([
  "active",
  "on_hold",
  "completed",
  "archived",
]);
export const eventTypeSchema = z.enum([
  "event",
  "meeting",
  "appointment",
  "exam",
  "deadline",
  "important_date",
]);

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .nullable()
  .optional();

const timeOnly = z
  .string()
  .regex(/^\d{2}:\d{2}(:\d{2})?$/, "Expected HH:MM")
  .nullable()
  .optional();

export const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(5000).nullable().optional(),
  status: taskStatusSchema.optional(),
  priority: prioritySchema.optional(),
  due_date: dateOnly,
  due_time: timeOnly,
  category: z.string().max(100).nullable().optional(),
  project_id: z.string().uuid().nullable().optional(),
  checklist_id: z.string().uuid().nullable().optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  estimated_minutes: z.number().int().min(1).max(10080).nullable().optional(),
});

export const updateTaskSchema = createTaskSchema.partial().extend({
  id: z.string().uuid(),
});

export const createChecklistSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(5000).nullable().optional(),
  category: z.string().max(100).nullable().optional(),
  project_id: z.string().uuid().nullable().optional(),
  is_template: z.boolean().optional(),
  items: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(300),
        due_date: dateOnly,
      })
    )
    .max(200)
    .optional(),
});

export const updateChecklistSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().max(5000).nullable().optional(),
  category: z.string().max(100).nullable().optional(),
  project_id: z.string().uuid().nullable().optional(),
  is_template: z.boolean().optional(),
  is_archived: z.boolean().optional(),
});

export const manageChecklistItemsSchema = z.object({
  checklist_id: z.string().uuid(),
  action: z.enum(["add", "update", "complete", "uncomplete", "remove", "reorder"]),
  item_id: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(300).optional(),
  due_date: dateOnly,
  ordered_ids: z.array(z.string().uuid()).optional(),
});

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(5000).nullable().optional(),
  status: projectStatusSchema.optional(),
  priority: prioritySchema.optional(),
  start_date: dateOnly,
  deadline: dateOnly,
});

export const updateProjectSchema = createProjectSchema.partial().extend({
  id: z.string().uuid(),
  is_archived: z.boolean().optional(),
});

export const createEventSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(5000).nullable().optional(),
  location: z.string().max(300).nullable().optional(),
  event_type: eventTypeSchema.optional(),
  start_at: z.string().min(1),
  end_at: z.string().min(1),
  all_day: z.boolean().optional(),
  project_id: z.string().uuid().nullable().optional(),
});

export const updateEventSchema = createEventSchema.partial().extend({
  id: z.string().uuid(),
});

export const savePreferenceSchema = z.object({
  preferred_working_hours_start: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable()
    .optional(),
  preferred_working_hours_end: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable()
    .optional(),
  planning_style: z
    .enum(["time_blocked", "priority_first", "flexible"])
    .nullable()
    .optional(),
  default_task_duration_minutes: z.number().int().min(5).max(480).nullable().optional(),
  timezone: z.string().min(1).max(100).optional(),
  week_starts_on: z.union([z.literal(0), z.literal(1)]).optional(),
  reminder_lead_minutes: z.number().int().min(0).max(10080).optional(),
  categories: z.array(z.string().max(50)).max(50).optional(),
});

export const memoryCategorySchema = z.enum(["preference", "context"]);

export const saveMemorySchema = z.object({
  category: memoryCategorySchema,
  content: z.string().trim().min(1).max(500),
  key: z.string().trim().min(1).max(64).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(16).optional(),
  user_confirmed: z.boolean(),
});

export const updateMemorySchema = z.object({
  id: z.string().uuid(),
  content: z.string().trim().min(1).max(500).optional(),
  category: memoryCategorySchema.optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(16).optional(),
});

export const deleteMemorySchema = z.object({
  id: z.string().uuid().optional(),
  query: z.string().trim().min(1).max(200).optional(),
  clear_all: z.boolean().optional(),
  user_confirmed: z.boolean(),
});

/** Compressed JPEG data URL from the client, or null to clear. */
export const updateProfileAvatarSchema = z.object({
  avatar_url: z
    .union([
      z.null(),
      z
        .string()
        .regex(/^data:image\/jpeg;base64,/, "Expected a JPEG data URL")
        .max(400_000, "Image is too large"),
    ]),
});

export const listTasksFilterSchema = z.object({
  status: taskStatusSchema.optional(),
  priority: prioritySchema.optional(),
  category: z.string().optional(),
  project_id: z.string().uuid().optional(),
  overdue_only: z.boolean().optional(),
  due_on: dateOnly,
  due_from: dateOnly,
  due_to: dateOnly,
  due_before: dateOnly,
  due_after: dateOnly,
  no_deadline: z.boolean().optional(),
  incomplete_only: z.boolean().optional(),
  query: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});
