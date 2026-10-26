import type { AuthContext } from "@/lib/data/auth";
import {
  createTask,
  deleteChecklist,
  deleteEvent,
  deleteProject,
  deleteTask,
  getChecklistItems,
  getTask,
  listChecklists,
  listProjects,
  manageChecklistItem,
  updateProject,
  updateTask,
} from "@/lib/data/repository";
import type { UndoEntry } from "./types";
import type { ChecklistItem, Project, Task } from "@/types";

type ToolResult = { success: boolean; result: unknown; error?: string };

function taskSnapshot(task: Task) {
  return {
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    due_date: task.due_date,
    due_time: task.due_time,
    category: task.category,
    project_id: task.project_id,
    tags: task.tags,
    estimated_minutes: task.estimated_minutes,
  };
}

export async function snapshotForUndo(
  name: string,
  args: Record<string, unknown>,
  auth: AuthContext
): Promise<unknown> {
  try {
    if (
      (name === "update_task" || name === "complete_task" || name === "delete_task") &&
      typeof args.id === "string"
    ) {
      return await getTask(args.id, auth);
    }
    if (name === "complete_checklist_items" && typeof args.checklist_id === "string") {
      const items = await getChecklistItems(args.checklist_id, auth);
      const ordered = [...items].sort((a, b) => a.position - b.position);
      const ids = Array.isArray(args.item_ids) ? (args.item_ids as string[]) : null;
      const chosen = ids
        ? ordered.filter((item) => ids.includes(item.id))
        : ordered.slice(0, Number(args.first_n ?? 1));
      return chosen
        .filter((item) => !item.is_completed)
        .map((item) => ({ checklist_id: args.checklist_id, item_id: item.id }));
    }
    if (name === "move_tasks_to_project" && Array.isArray(args.task_ids)) {
      const tasks = await Promise.all(
        (args.task_ids as string[]).map((id) => getTask(id, auth))
      );
      return tasks.map((task) => ({ id: task.id, project_id: task.project_id }));
    }
    if (
      (name === "update_project" || name === "delete_project") &&
      typeof args.id === "string"
    ) {
      const projects = await listProjects(auth);
      return projects.find((project) => project.id === args.id) ?? null;
    }
  } catch {
    return null;
  }
  return null;
}

export function undoEntryFor(
  name: string,
  args: Record<string, unknown>,
  before: unknown,
  result: unknown
): UndoEntry | null {
  if (name === "create_task" && result && typeof result === "object" && "id" in result) {
    const task = result as Task;
    return {
      label: `Delete task “${task.title}”`,
      tool: "delete_task",
      args: { id: task.id, confirmed: true },
    };
  }
  if ((name === "update_task" || name === "complete_task") && before && typeof before === "object") {
    const task = before as Task;
    return {
      label: `Restore task “${task.title}”`,
      tool: "update_task",
      args: { id: task.id, ...taskSnapshot(task) },
    };
  }
  if (name === "delete_task" && before && typeof before === "object") {
    const task = before as Task;
    return {
      label: `Restore task “${task.title}”`,
      tool: "create_task",
      args: taskSnapshot(task),
    };
  }
  if (name === "create_event" && result && typeof result === "object" && "id" in result) {
    const event = result as { id: string; title: string };
    return {
      label: `Delete event “${event.title}”`,
      tool: "delete_event",
      args: { id: event.id, confirmed: true },
    };
  }
  if (name === "create_project" && result && typeof result === "object" && "id" in result) {
    const project = result as Project;
    return {
      label: `Delete project “${project.name}”`,
      tool: "delete_project",
      args: { id: project.id, confirmed: true },
    };
  }
  if (name === "update_project" && before && typeof before === "object" && "name" in before) {
    const project = before as Project;
    return {
      label: `Restore project “${project.name}”`,
      tool: "update_project",
      args: {
        id: project.id,
        name: project.name,
        description: project.description,
        status: project.status,
        priority: project.priority,
        start_date: project.start_date,
        deadline: project.deadline,
      },
    };
  }
  if (name === "create_checklist" && result && typeof result === "object" && "checklist" in result) {
    const checklist = (result as { checklist: { id: string; title: string } }).checklist;
    return {
      label: `Delete checklist “${checklist.title}”`,
      tool: "delete_checklist",
      args: { id: checklist.id, confirmed: true },
    };
  }
  if (name === "move_tasks_to_project" && Array.isArray(before)) {
    return {
      label: "Move tasks back to their previous projects",
      tool: "restore_task_projects",
      args: { assignments: before },
    };
  }
  if (name === "add_checklist_items" && result && typeof result === "object") {
    const items = (result as { items?: ChecklistItem[] }).items ?? [];
    if (!items.length || typeof args.checklist_id !== "string") return null;
    return {
      label: "Remove the checklist items just added",
      tool: "remove_checklist_items",
      args: {
        checklist_id: args.checklist_id,
        item_ids: items.map((item) => item.id),
      },
    };
  }
  if (name === "complete_checklist_items" && Array.isArray(before)) {
    return {
      label: "Mark those checklist items incomplete again",
      tool: "reopen_checklist_items",
      args: { items: before },
    };
  }
  if (name === "manage_checklist_items" && args.action === "complete") {
    return {
      label: "Mark that checklist item incomplete",
      tool: "manage_checklist_items",
      args: {
        checklist_id: args.checklist_id,
        action: "uncomplete",
        item_id: args.item_id,
      },
    };
  }
  if (name === "manage_checklist_items" && args.action === "add" && result && typeof result === "object") {
    const item = result as ChecklistItem;
    return {
      label: `Remove checklist item “${item.title}”`,
      tool: "manage_checklist_items",
      args: {
        checklist_id: args.checklist_id,
        action: "remove",
        item_id: item.id,
      },
    };
  }
  return null;
}

export async function applyUndoEntry(
  entry: UndoEntry,
  auth: AuthContext
): Promise<ToolResult> {
  if (entry.tool === "restore_task_projects") {
    const assignments = entry.args.assignments as { id: string; project_id: string | null }[];
    if (!Array.isArray(assignments) || assignments.length === 0) {
      return { success: false, result: null, error: "Nothing to restore." };
    }
    const updated: Task[] = [];
    for (const row of assignments) {
      await updateTask(row.id, { project_id: row.project_id }, auth);
      const verified = await getTask(row.id, auth);
      if ((verified.project_id ?? null) !== (row.project_id ?? null)) {
        return {
          success: false,
          result: updated,
          error: "The undo could not be verified.",
        };
      }
      updated.push(verified);
    }
    return { success: true, result: updated };
  }

  if (entry.tool === "remove_checklist_items") {
    const checklistId = String(entry.args.checklist_id);
    const ids = entry.args.item_ids as string[];
    for (const itemId of ids) {
      await manageChecklistItem(
        { checklist_id: checklistId, action: "remove", item_id: itemId },
        auth
      );
    }
    const remaining = await getChecklistItems(checklistId, auth);
    const stillThere = remaining.filter((item) => ids.includes(item.id));
    if (stillThere.length) {
      return {
        success: false,
        result: null,
        error: "Some checklist items could not be removed.",
      };
    }
    return { success: true, result: { removed: ids.length } };
  }

  if (entry.tool === "reopen_checklist_items") {
    const items = entry.args.items as { checklist_id: string; item_id: string }[];
    for (const item of items) {
      await manageChecklistItem(
        {
          checklist_id: item.checklist_id,
          action: "uncomplete",
          item_id: item.item_id,
        },
        auth
      );
    }
    return { success: true, result: { reopened: items.length } };
  }

  if (entry.tool === "manage_checklist_items") {
    await manageChecklistItem(
      {
        checklist_id: String(entry.args.checklist_id),
        action: entry.args.action as "add" | "update" | "complete" | "uncomplete" | "remove" | "reorder",
        item_id: typeof entry.args.item_id === "string" ? entry.args.item_id : undefined,
        title: typeof entry.args.title === "string" ? entry.args.title : undefined,
      },
      auth
    );
    return { success: true, result: { undone: true } };
  }

  if (entry.tool === "delete_task") {
    await deleteTask(String(entry.args.id), auth);
    try {
      await getTask(String(entry.args.id), auth);
      return { success: false, result: null, error: "The task is still present." };
    } catch {
      return { success: true, result: { deleted: true, id: entry.args.id } };
    }
  }

  if (entry.tool === "create_task") {
    const created = await createTask(entry.args as { title: string }, auth);
    const verified = await getTask(created.id, auth);
    if (verified.title !== created.title) {
      return { success: false, result: null, error: "The restored task could not be verified." };
    }
    return { success: true, result: verified };
  }

  if (entry.tool === "update_project") {
    const id = String(entry.args.id);
    const { id: _id, ...patch } = entry.args;
    void _id;
    const updated = await updateProject(id, patch as Partial<Project>, auth);
    const verified = (await listProjects(auth)).find((project) => project.id === id);
    if (!verified || verified.deadline !== updated.deadline || verified.name !== updated.name) {
      return { success: false, result: null, error: "The project undo could not be verified." };
    }
    return { success: true, result: verified };
  }

  if (entry.tool === "update_task") {
    const id = String(entry.args.id);
    const { id: _id, ...patch } = entry.args;
    void _id;
    await updateTask(id, patch as Partial<Task>, auth);
    const verified = await getTask(id, auth);
    return { success: true, result: verified };
  }

  if (entry.tool === "delete_project") {
    await deleteProject(String(entry.args.id), auth);
    return { success: true, result: { deleted: true, id: entry.args.id } };
  }
  if (entry.tool === "delete_checklist") {
    await deleteChecklist(String(entry.args.id), auth);
    const left = (await listChecklists(auth)).some((checklist) => checklist.id === entry.args.id);
    if (left) return { success: false, result: null, error: "Checklist is still present." };
    return { success: true, result: { deleted: true, id: entry.args.id } };
  }
  if (entry.tool === "delete_event") {
    await deleteEvent(String(entry.args.id), auth);
    return { success: true, result: { deleted: true, id: entry.args.id } };
  }

  return {
    success: false,
    result: null,
    error: `I can't undo “${entry.label}” automatically.`,
  };
}
