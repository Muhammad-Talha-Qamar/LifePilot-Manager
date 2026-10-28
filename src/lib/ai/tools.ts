import { z } from "zod";
import type { AuthContext } from "@/lib/data/auth";
import {
  completeTask,
  createChecklist,
  createEvent,
  createProject,
  createTask,
  deleteTask,
  getPreferences,
  getProductivitySummary,
  getTask,
  listChecklists,
  listEvents,
  listProjects,
  listTasks,
  manageChecklistItem,
  savePreferences,
  updateChecklist,
  updateEvent,
  updateProject,
  updateTask,
  getChecklistItems,
} from "@/lib/data/repository";
import {
  clearAllMemories,
  deleteMemory,
  deleteMemoriesByIds,
  listMemories,
  saveMemory,
  updateMemory,
} from "@/lib/data/memories";
import { resolveDatePhrase, resolveRelativeDate } from "@/lib/utils/dates";
import { runExtendedTool, verifyTaskWrite } from "./extra-tools";
import { matchMemoriesForForget, retrieveRelevantMemories } from "./memory";
import {
  createChecklistSchema,
  createEventSchema,
  createProjectSchema,
  createTaskSchema,
  deleteMemorySchema,
  listTasksFilterSchema,
  manageChecklistItemsSchema,
  saveMemorySchema,
  savePreferenceSchema,
  updateChecklistSchema,
  updateEventSchema,
  updateMemorySchema,
  updateProjectSchema,
  updateTaskSchema,
} from "@/lib/validations/schemas";

/** Reject foreign project ids — never trust model-supplied ownership. */
async function assertOwnedProjectId(
  projectId: string | null | undefined,
  auth: AuthContext
): Promise<string | null> {
  if (!projectId) return null;
  const owned = (await listProjects(auth)).some((project) => project.id === projectId);
  if (!owned) {
    throw new Error("That project was not found in your account.");
  }
  return projectId;
}

export const TOOL_DEFINITIONS = [
  {
    type: "function" as const,
    function: {
      name: "list_tasks",
      description:
        "List the user's tasks with optional filters. Prefer query_schedule for period questions (today/tomorrow/this week). Use list_tasks for filtered searches by status, priority, category, or free-text query.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["todo", "in_progress", "done", "cancelled"] },
          priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
          category: { type: "string" },
          project_id: { type: "string" },
          overdue_only: { type: "boolean" },
          due_on: { type: "string" },
          due_from: { type: "string" },
          due_to: { type: "string" },
          no_deadline: { type: "boolean" },
          incomplete_only: { type: "boolean" },
          query: { type: "string" },
          limit: { type: "number" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_task",
      description: "Get a single task by id.",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_task",
      description:
        "Create a task whenever the user wants something remembered: remind me, don't forget, I need to, I gotta, put on my list, todo:, bare title+date, jot down, etc. Resolve relative dates (tomorrow, Friday) to YYYY-MM-DD in the user's timezone before calling. Do not create duplicates of an identical open task.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          status: { type: "string", enum: ["todo", "in_progress", "done", "cancelled"] },
          priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
          due_date: { type: "string", description: "YYYY-MM-DD" },
          due_time: { type: "string", description: "HH:MM" },
          category: { type: "string" },
          project_id: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          estimated_minutes: { type: "number" },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_task",
      description:
        "Update an existing task by id (title, due date, priority, status, tags). Use for reschedule, make urgent, rename, and corrections like 'no I meant Friday'. Never create a duplicate when updating.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          status: { type: "string", enum: ["todo", "in_progress", "done", "cancelled"] },
          priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
          due_date: { type: "string" },
          due_time: { type: "string" },
          category: { type: "string" },
          project_id: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          estimated_minutes: { type: "number" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "complete_task",
      description:
        "Mark a task as done. Use for: done with X, X is finished, just wrapped X, check off X (when X is a task). Prefer complete_checklist_items when X matches a checklist item better.",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "delete_task",
      description:
        "Permanently delete a task. Only call when the user explicitly confirms deletion.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          confirmed: { type: "boolean" },
        },
        required: ["id", "confirmed"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_checklists",
      description: "List checklists and optionally include item progress.",
      parameters: {
        type: "object",
        properties: {
          include_items: { type: "boolean" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_checklist",
      description:
        "Create a checklist with optional initial items. Use for shopping/grocery/packing lists, 'list: a, b, c', and 'make a checklist for … with …'. Prefer a checklist over many tiny unrelated tasks when the user clearly wants a list.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          category: { type: "string" },
          project_id: { type: "string" },
          is_template: { type: "boolean" },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                due_date: { type: "string" },
              },
              required: ["title"],
            },
          },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_checklist",
      description: "Update checklist metadata.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          category: { type: "string" },
          project_id: { type: "string" },
          is_archived: { type: "boolean" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "manage_checklist_items",
      description: "Add, update, complete, uncomplete, remove, or reorder checklist items.",
      parameters: {
        type: "object",
        properties: {
          checklist_id: { type: "string" },
          action: {
            type: "string",
            enum: ["add", "update", "complete", "uncomplete", "remove", "reorder"],
          },
          item_id: { type: "string" },
          title: { type: "string" },
          due_date: { type: "string" },
          ordered_ids: { type: "array", items: { type: "string" } },
        },
        required: ["checklist_id", "action"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_events",
      description: "List calendar events, optionally in a date range.",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string" },
          to: { type: "string" },
          limit: { type: "number" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_event",
      description: "Create a calendar event or important date.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          location: { type: "string" },
          event_type: {
            type: "string",
            enum: ["event", "meeting", "appointment", "exam", "deadline", "important_date"],
          },
          start_at: { type: "string", description: "ISO timestamp" },
          end_at: { type: "string", description: "ISO timestamp" },
          all_day: { type: "boolean" },
          project_id: { type: "string" },
        },
        required: ["title", "start_at", "end_at"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_event",
      description: "Update a calendar event.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          location: { type: "string" },
          event_type: { type: "string" },
          start_at: { type: "string" },
          end_at: { type: "string" },
          all_day: { type: "boolean" },
          project_id: { type: "string" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_projects",
      description:
        "List the user's active projects. Use before assigning tasks or updating a project by name.",
      parameters: {
        type: "object",
        properties: {
          incomplete_only: { type: "boolean" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_project",
      description:
        "Create a project (named container for related tasks). Resolve deadline phrases to YYYY-MM-DD first. Do not create a duplicate of an identically named active project.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          status: {
            type: "string",
            enum: ["active", "on_hold", "completed", "archived"],
          },
          priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
          start_date: { type: "string", description: "YYYY-MM-DD" },
          deadline: { type: "string", description: "YYYY-MM-DD" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_project",
      description:
        "Update an existing project by id (name, deadline, status, priority). Use for deadline changes and corrections — never create a duplicate.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
          status: { type: "string" },
          priority: { type: "string" },
          start_date: { type: "string" },
          deadline: { type: "string" },
          is_archived: { type: "boolean" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "delete_project",
      description: "Delete a project after the user explicitly confirms.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          confirmed: { type: "boolean" },
        },
        required: ["id", "confirmed"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "move_tasks_to_project",
      description:
        "Assign one or more existing tasks to a project. Resolve project and task ids with search_records first. Reports partial success if some ids fail.",
      parameters: {
        type: "object",
        properties: {
          project_id: { type: "string" },
          task_ids: { type: "array", items: { type: "string" } },
        },
        required: ["project_id", "task_ids"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_productivity_summary",
      description:
        "Get today's tasks, overdue work, upcoming deadlines/events, projects, and completion stats.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "propose_daily_plan",
      description:
        "Build a realistic daily plan from open tasks given available minutes.",
      parameters: {
        type: "object",
        properties: {
          available_minutes: { type: "number" },
        },
        required: ["available_minutes"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "save_productivity_preference",
      description:
        "Save a confirmed user productivity preference. Never save inferred guesses.",
      parameters: {
        type: "object",
        properties: {
          preferred_working_hours_start: { type: "string" },
          preferred_working_hours_end: { type: "string" },
          planning_style: {
            type: "string",
            enum: ["time_blocked", "priority_first", "flexible"],
          },
          default_task_duration_minutes: { type: "number" },
          timezone: { type: "string" },
          week_starts_on: { type: "number" },
          reminder_lead_minutes: { type: "number" },
          categories: { type: "array", items: { type: "string" } },
          user_confirmed: { type: "boolean" },
        },
        required: ["user_confirmed"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_memories",
      description:
        "List this user's saved persistent preferences and context notes. Never invent memories. Task status is not stored here — use schedule/task tools for that.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Optional relevance filter for context notes",
          },
          category: { type: "string", enum: ["preference", "context"] },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "save_memory",
      description:
        "Save a durable preference or context note the user explicitly asked to keep. Never save casual narration, temporary plans, passwords, or inferred guesses. Requires user_confirmed=true. Prefer category=preference for communication/planning style; category=context for ongoing project notes (not task deadlines).",
      parameters: {
        type: "object",
        properties: {
          category: { type: "string", enum: ["preference", "context"] },
          content: { type: "string" },
          key: {
            type: "string",
            description:
              "Optional stable key for upserts (e.g. communication_style, summary_length)",
          },
          tags: { type: "array", items: { type: "string" } },
          user_confirmed: { type: "boolean" },
        },
        required: ["category", "content", "user_confirmed"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_memory",
      description:
        "Correct an existing saved memory by id after the user asks to change it.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          content: { type: "string" },
          category: { type: "string", enum: ["preference", "context"] },
          tags: { type: "array", items: { type: "string" } },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "forget_memory",
      description:
        "Delete saved memories the user wants removed. Pass id, a query to match, or clear_all. Requires user_confirmed=true. After deletion, do not reintroduce the removed content.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          query: { type: "string" },
          clear_all: { type: "boolean" },
          user_confirmed: { type: "boolean" },
        },
        required: ["user_confirmed"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "query_schedule",
      description:
        "Retrieve tasks and events for a period. Use this for today, tomorrow, yesterday, this week, next week, this month, next month (calendar month, not 30 days), the next 7 days, overdue work, tasks without deadlines, or a custom YYYY-MM-DD range. Completed tasks are omitted from unfinished lists.",
      parameters: {
        type: "object",
        properties: {
          period: {
            type: "string",
            enum: [
              "today",
              "tomorrow",
              "yesterday",
              "this_week",
              "next_week",
              "this_month",
              "next_month",
              "next_7_days",
              "overdue",
              "no_deadline",
              "range",
            ],
          },
          from: { type: "string", description: "YYYY-MM-DD, required for range" },
          to: { type: "string", description: "YYYY-MM-DD, required for range" },
        },
        required: ["period"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_records",
      description:
        "Find existing tasks, projects, checklists, or events by a fuzzy name before updating/completing/deleting them. Always search first when the user refers to something by title ('the essay', 'maths homework', 'science project', 'groceries') instead of inventing ids.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          kind: {
            type: "string",
            enum: ["task", "project", "checklist", "event", "any"],
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "add_checklist_items",
      description:
        "Add one or more items to an existing checklist (e.g. 'add milk and eggs to groceries'). Resolve the checklist via search_records or conversation focus first.",
      parameters: {
        type: "object",
        properties: {
          checklist_id: { type: "string" },
          titles: { type: "array", items: { type: "string" } },
        },
        required: ["checklist_id", "titles"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "complete_checklist_items",
      description: "Mark specific checklist items complete, or the first N items by position.",
      parameters: {
        type: "object",
        properties: {
          checklist_id: { type: "string" },
          item_ids: { type: "array", items: { type: "string" } },
          first_n: { type: "number" },
        },
        required: ["checklist_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "delete_checklist",
      description: "Delete a checklist after the user explicitly confirms.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          confirmed: { type: "boolean" },
        },
        required: ["id", "confirmed"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "delete_event",
      description: "Delete a calendar event after the user explicitly confirms.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          confirmed: { type: "boolean" },
        },
        required: ["id", "confirmed"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "undo_last_change",
      description: "Undo the most recent supported change from this conversation.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "resolve_date",
      description:
        "Resolve a relative date phrase (today, tomorrow, next Monday) into YYYY-MM-DD in the user's timezone.",
      parameters: {
        type: "object",
        properties: { phrase: { type: "string" } },
        required: ["phrase"],
      },
    },
  },
] as const;

export type ToolName = (typeof TOOL_DEFINITIONS)[number]["function"]["name"];

const ALLOWED_TOOLS = new Set(TOOL_DEFINITIONS.map((t) => t.function.name));

export async function executeTool(
  name: string,
  rawArgs: Record<string, unknown>,
  auth: AuthContext
): Promise<{ success: boolean; result: unknown; error?: string }> {
  if (!ALLOWED_TOOLS.has(name as ToolName)) {
    return { success: false, result: null, error: `Unknown tool: ${name}` };
  }

  try {
    const extended = await runExtendedTool(name, rawArgs, auth);
    if (extended) return extended;

    switch (name) {
      case "list_tasks": {
        const filters = listTasksFilterSchema.parse(rawArgs);
        const tasks = await listTasks(filters, auth);
        return { success: true, result: tasks };
      }
      case "get_task": {
        const { id } = z.object({ id: z.string().uuid() }).parse(rawArgs);
        const task = await getTask(id, auth);
        return { success: true, result: task };
      }
      case "create_task": {
        const input = createTaskSchema.parse(rawArgs);
        const projectId = await assertOwnedProjectId(input.project_id, auth);
        const task = await createTask({ ...input, project_id: projectId }, auth);
        return verifyTaskWrite(task, auth);
      }
      case "update_task": {
        const input = updateTaskSchema.parse(rawArgs);
        const { id, ...patch } = input;
        if (patch.project_id !== undefined) {
          patch.project_id = await assertOwnedProjectId(patch.project_id, auth);
        }
        const task = await updateTask(id, patch, auth);
        return verifyTaskWrite(task, auth);
      }
      case "complete_task": {
        const { id } = z.object({ id: z.string().uuid() }).parse(rawArgs);
        const task = await completeTask(id, auth);
        return verifyTaskWrite(task, auth);
      }
      case "delete_task": {
        const { id, confirmed } = z
          .object({ id: z.string().uuid(), confirmed: z.boolean() })
          .parse(rawArgs);
        if (!confirmed) {
          return {
            success: false,
            result: null,
            error: "Deletion requires confirmed=true after user confirmation.",
          };
        }
        await deleteTask(id, auth);
        return { success: true, result: { deleted: true, id } };
      }
      case "list_checklists": {
        const includeItems = Boolean(rawArgs.include_items);
        const checklists = await listChecklists(auth);
        if (!includeItems) return { success: true, result: checklists };
        const withItems = await Promise.all(
          checklists.map(async (c) => ({
            ...c,
            items: await getChecklistItems(c.id, auth),
          }))
        );
        return { success: true, result: withItems };
      }
      case "create_checklist": {
        const input = createChecklistSchema.parse(rawArgs);
        const projectId = await assertOwnedProjectId(input.project_id, auth);
        const result = await createChecklist({ ...input, project_id: projectId }, auth);
        return { success: true, result };
      }
      case "update_checklist": {
        const input = updateChecklistSchema.parse(rawArgs);
        const { id, ...patch } = input;
        if (patch.project_id !== undefined) {
          patch.project_id = await assertOwnedProjectId(patch.project_id, auth);
        }
        const checklist = await updateChecklist(id, patch, auth);
        return { success: true, result: checklist };
      }
      case "manage_checklist_items": {
        const input = manageChecklistItemsSchema.parse(rawArgs);
        const result = await manageChecklistItem(input, auth);
        return { success: true, result };
      }
      case "list_events": {
        const filters = z
          .object({
            from: z.string().optional(),
            to: z.string().optional(),
            limit: z.number().int().min(1).max(100).optional(),
          })
          .parse(rawArgs);
        const events = await listEvents(filters, auth);
        return { success: true, result: events };
      }
      case "create_event": {
        const input = createEventSchema.parse(rawArgs);
        const projectId = await assertOwnedProjectId(input.project_id, auth);
        const event = await createEvent({ ...input, project_id: projectId }, auth);
        return { success: true, result: event };
      }
      case "update_event": {
        const input = updateEventSchema.parse(rawArgs);
        const { id, ...patch } = input;
        if (patch.project_id !== undefined) {
          patch.project_id = await assertOwnedProjectId(patch.project_id, auth);
        }
        const event = await updateEvent(id, patch, auth);
        return { success: true, result: event };
      }
      case "list_projects": {
        const incompleteOnly = Boolean(rawArgs.incomplete_only);
        const projects = await listProjects(auth);
        const filtered = incompleteOnly
          ? projects.filter(
              (project) => project.status === "active" || project.status === "on_hold"
            )
          : projects;
        return { success: true, result: filtered };
      }
      case "create_project": {
        const input = createProjectSchema.parse(rawArgs);
        const existing = (await listProjects(auth)).find(
          (project) => project.name.trim().toLowerCase() === input.name.trim().toLowerCase()
        );
        if (existing) {
          return {
            success: true,
            result: existing,
            error: undefined,
          };
        }
        const project = await createProject(input, auth);
        const verified = (await listProjects(auth)).find((item) => item.id === project.id);
        if (!verified) {
          return {
            success: false,
            result: null,
            error: "Project write could not be verified.",
          };
        }
        return { success: true, result: verified };
      }
      case "update_project": {
        const input = updateProjectSchema.parse(rawArgs);
        const { id, ...patch } = input;
        const project = await updateProject(id, patch, auth);
        const verified = (await listProjects(auth)).find((item) => item.id === project.id);
        if (!verified) {
          return {
            success: false,
            result: null,
            error: "Project update could not be verified.",
          };
        }
        return { success: true, result: verified };
      }
      case "get_productivity_summary": {
        const summary = await getProductivitySummary(auth);
        return { success: true, result: summary };
      }
      case "propose_daily_plan": {
        const { available_minutes } = z
          .object({ available_minutes: z.number().int().min(5).max(1440) })
          .parse(rawArgs);
        const prefs = await getPreferences(auth);
        const defaultDuration = prefs.default_task_duration_minutes ?? 45;
        const timezone = prefs.timezone || auth.profile.timezone || "UTC";
        const [open, events, projects] = await Promise.all([
          listTasks({ status: undefined, overdue_only: false, limit: 50 }, auth),
          listEvents({ limit: 100 }, auth),
          listProjects(auth),
        ]);
        const { buildDayPlan, rankTasksForPlanning } = await import("./planning");
        const { calendarToday } = await import("@/lib/utils/dates");
        const today = calendarToday(timezone);
        const incomplete = open.filter(
          (t) => t.status === "todo" || t.status === "in_progress"
        );
        const dayPlan = buildDayPlan({
          tasks: incomplete.filter(
            (t) => !t.due_date || t.due_date.slice(0, 10) <= today
          ),
          overdueTasks: incomplete.filter(
            (t) => t.due_date && t.due_date.slice(0, 10) < today
          ),
          events,
          projects,
          day: today,
          periodLabel: "Today",
          timezone,
          workStart: prefs.preferred_working_hours_start,
          workEnd: prefs.preferred_working_hours_end,
          defaultDuration,
          planningStyle: prefs.planning_style,
          maxSlots: 20,
        });
        // Honor available_minutes budget using ranked order (not earliest-due alone).
        const ranked = rankTasksForPlanning(incomplete, {
          today,
          projects,
          defaultDuration,
          planningStyle: prefs.planning_style,
        });
        const plan: {
          task_id: string;
          title: string;
          estimated_minutes: number;
          reason: string;
        }[] = [];
        let remaining = available_minutes;
        for (const item of ranked) {
          if (item.minutes > remaining) continue;
          plan.push({
            task_id: item.task.id,
            title: item.task.title,
            estimated_minutes: item.minutes,
            reason: item.reasons.slice(0, 2).join("; ") || "Fits remaining time",
          });
          remaining -= item.minutes;
          if (remaining < 10) break;
        }
        return {
          success: true,
          result: {
            available_minutes,
            allocated_minutes: available_minutes - remaining,
            remaining_minutes: remaining,
            plan,
            overloaded: dayPlan.overloaded,
            overload_note: dayPlan.overloadNote,
            schedule_slots: dayPlan.slots,
            used_default_estimates: dayPlan.defaultDurationUsed,
            note: "Suggestion only — not saved unless the user asks to save the plan.",
          },
        };
      }
      case "save_productivity_preference": {
        const parsed = savePreferenceSchema
          .extend({ user_confirmed: z.boolean() })
          .parse(rawArgs);
        if (!parsed.user_confirmed) {
          return {
            success: false,
            result: null,
            error: "Preferences require user_confirmed=true.",
          };
        }
        const { user_confirmed: _, ...prefs } = parsed;
        void _;
        const saved = await savePreferences(prefs, auth);
        return { success: true, result: saved };
      }
      case "list_memories": {
        const args = z
          .object({
            query: z.string().optional(),
            category: z.enum(["preference", "context"]).optional(),
          })
          .parse(rawArgs);
        const all = await listMemories(auth);
        const filtered = args.category
          ? all.filter((m) => m.category === args.category)
          : all;
        if (args.query?.trim()) {
          const retrieved = retrieveRelevantMemories(filtered, args.query.trim(), {
            maxPreferences: 20,
            maxContext: 10,
          });
          return {
            success: true,
            result: {
              memories: retrieved.all,
              note: "These are saved preferences/context notes, not live task state.",
            },
          };
        }
        return {
          success: true,
          result: {
            memories: filtered,
            note: "These are saved preferences/context notes, not live task state.",
          },
        };
      }
      case "save_memory": {
        const parsed = saveMemorySchema.parse(rawArgs);
        if (!parsed.user_confirmed) {
          return {
            success: false,
            result: null,
            error: "Saving memory requires user_confirmed=true after the user agrees.",
          };
        }
        const saved = await saveMemory(
          {
            category: parsed.category,
            content: parsed.content,
            key: parsed.key,
            tags: parsed.tags,
          },
          auth
        );
        return { success: true, result: saved };
      }
      case "update_memory": {
        const parsed = updateMemorySchema.parse(rawArgs);
        const { id, ...patch } = parsed;
        const updated = await updateMemory(id, patch, auth);
        return { success: true, result: updated };
      }
      case "forget_memory": {
        const parsed = deleteMemorySchema.parse(rawArgs);
        if (!parsed.user_confirmed) {
          return {
            success: false,
            result: null,
            error: "Forgetting memory requires user_confirmed=true.",
          };
        }
        if (parsed.clear_all) {
          const removed = await clearAllMemories(auth);
          return { success: true, result: { removed, cleared: true } };
        }
        if (parsed.id) {
          await deleteMemory(parsed.id, auth);
          return { success: true, result: { removed: 1, ids: [parsed.id] } };
        }
        if (parsed.query?.trim()) {
          const all = await listMemories(auth);
          const matches = matchMemoriesForForget(all, parsed.query.trim());
          if (!matches.length) {
            return {
              success: true,
              result: { removed: 0, ids: [], note: "No matching memories found." },
            };
          }
          const ids = matches.map((m) => m.id);
          const removed = await deleteMemoriesByIds(ids, auth);
          return {
            success: true,
            result: {
              removed,
              ids,
              contents: matches.map((m) => m.content),
            },
          };
        }
        return {
          success: false,
          result: null,
          error: "Provide id, query, or clear_all to forget memories.",
        };
      }
      case "resolve_date": {
        const { phrase } = z.object({ phrase: z.string() }).parse(rawArgs);
        const prefs = await getPreferences(auth);
        const timezone = prefs.timezone || auth.profile.timezone;
        const resolved = resolveDatePhrase(phrase, timezone, prefs.week_starts_on);
        if (resolved?.type === "ambiguous") {
          return {
            success: true,
            result: {
              phrase,
              resolved: null,
              ambiguous: true,
              question: resolved.question,
              options: resolved.options,
            },
          };
        }
        const day = resolved?.type === "day" ? resolved.date : resolveRelativeDate(phrase, timezone, prefs.week_starts_on);
        return {
          success: Boolean(day) || resolved?.type === "range",
          result: {
            phrase,
            resolved: day,
            range: resolved?.type === "range" ? resolved : null,
          },
          error: day || resolved?.type === "range" ? undefined : "Could not resolve date phrase",
        };
      }
      default:
        return { success: false, result: null, error: `Unhandled tool: ${name}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Tool execution failed";
    return { success: false, result: null, error: message };
  }
}
