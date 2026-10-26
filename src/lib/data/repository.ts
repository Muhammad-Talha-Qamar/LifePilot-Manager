import { DEFAULT_TIMEZONE, isDemoMode } from "@/lib/config";
import { mutateDemoStore, getDemoStore } from "@/lib/demo/store";
import { createClient } from "@/lib/supabase/server";
import { generateId, nowIso } from "@/lib/utils";
import { isOverdue } from "@/lib/utils/dates";
import { filterTasksByQuery, sortTasksByPriorityThenDue } from "@/lib/utils/progress";
import type {
  CalendarEvent,
  Checklist,
  ChecklistItem,
  ProductivityPreferences,
  ProductivitySummary,
  Profile,
  Project,
  Reminder,
  Task,
} from "@/types";
import { NotFoundError, requireAuth, type AuthContext } from "./auth";

async function sb() {
  return createClient();
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

export async function listTasks(
  filters: {
    status?: string;
    priority?: string;
    category?: string;
    project_id?: string;
    overdue_only?: boolean;
    due_on?: string | null;
    due_from?: string | null;
    due_to?: string | null;
    due_before?: string | null;
    due_after?: string | null;
    no_deadline?: boolean;
    incomplete_only?: boolean;
    query?: string;
    limit?: number;
  } = {},
  auth?: AuthContext
): Promise<Task[]> {
  const ctx = auth ?? (await requireAuth());

  let tasks: Task[];
  if (ctx.isDemo || isDemoMode()) {
    const store = await getDemoStore(ctx.userId);
    tasks = store.tasks.filter((t) => t.user_id === ctx.userId);
  } else {
    const client = await sb();
    const { data, error } = await client
      .from("tasks")
      .select("*")
      .eq("user_id", ctx.userId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    tasks = (data ?? []) as Task[];
  }

  if (filters.status) tasks = tasks.filter((t) => t.status === filters.status);
  if (filters.priority) tasks = tasks.filter((t) => t.priority === filters.priority);
  if (filters.category) tasks = tasks.filter((t) => t.category === filters.category);
  if (filters.project_id) tasks = tasks.filter((t) => t.project_id === filters.project_id);
  if (filters.query) tasks = filterTasksByQuery(tasks, filters.query);
  if (filters.overdue_only) {
    const tz = ctx.profile.timezone || DEFAULT_TIMEZONE;
    tasks = tasks.filter((t) => isOverdue(t.due_date, t.due_time, tz, t.status));
  }
  if (filters.incomplete_only) {
    tasks = tasks.filter((t) => t.status === "todo" || t.status === "in_progress");
  }
  if (filters.no_deadline) {
    tasks = tasks.filter(
      (t) => !t.due_date && t.status !== "done" && t.status !== "cancelled"
    );
  }
  const dueOn = filters.due_on?.slice(0, 10);
  const dueFrom = (filters.due_from ?? filters.due_after)?.slice(0, 10);
  const dueTo = (filters.due_to ?? filters.due_before)?.slice(0, 10);
  if (dueOn) tasks = tasks.filter((t) => t.due_date?.slice(0, 10) === dueOn);
  if (dueFrom) {
    tasks = tasks.filter((t) => t.due_date && t.due_date.slice(0, 10) >= dueFrom);
  }
  if (dueTo) {
    tasks = tasks.filter((t) => t.due_date && t.due_date.slice(0, 10) <= dueTo);
  }

  tasks = sortTasksByPriorityThenDue(tasks);
  if (filters.limit) tasks = tasks.slice(0, filters.limit);
  return tasks;
}

export async function getTask(id: string, auth?: AuthContext): Promise<Task> {
  const ctx = auth ?? (await requireAuth());
  if (ctx.isDemo || isDemoMode()) {
    const store = await getDemoStore(ctx.userId);
    const task = store.tasks.find((t) => t.id === id && t.user_id === ctx.userId);
    if (!task) throw new NotFoundError("Task not found");
    return task;
  }
  const client = await sb();
  const { data, error } = await client
    .from("tasks")
    .select("*")
    .eq("id", id)
    .eq("user_id", ctx.userId)
    .single();
  if (error || !data) throw new NotFoundError("Task not found");
  return data as Task;
}

export async function createTask(
  input: Partial<Task> & { title: string },
  auth?: AuthContext
): Promise<Task> {
  const ctx = auth ?? (await requireAuth());
  const now = nowIso();
  const task: Task = {
    id: generateId(),
    user_id: ctx.userId,
    title: input.title.trim(),
    description: input.description ?? null,
    status: input.status ?? "todo",
    priority: input.priority ?? "medium",
    due_date: input.due_date ?? null,
    due_time: input.due_time ?? null,
    category: input.category ?? null,
    project_id: input.project_id ?? null,
    checklist_id: input.checklist_id ?? null,
    tags: input.tags ?? [],
    estimated_minutes: input.estimated_minutes ?? null,
    completed_at: input.status === "done" ? now : null,
    created_at: now,
    updated_at: now,
  };

  if (ctx.isDemo || isDemoMode()) {
    await mutateDemoStore(ctx.userId, (store) => {
      store.tasks.unshift(task);
    });
    return task;
  }

  const client = await sb();
  const { data, error } = await client.from("tasks").insert(task).select().single();
  if (error) throw error;
  return data as Task;
}

export async function updateTask(
  id: string,
  patch: Partial<Task>,
  auth?: AuthContext
): Promise<Task> {
  const ctx = auth ?? (await requireAuth());
  const existing = await getTask(id, ctx);
  const now = nowIso();
  const updated: Task = {
    ...existing,
    ...patch,
    id: existing.id,
    user_id: existing.user_id,
    updated_at: now,
  };
  if (patch.status === "done" && existing.status !== "done") {
    updated.completed_at = now;
  } else if (patch.status && patch.status !== "done") {
    updated.completed_at = null;
  }

  if (ctx.isDemo || isDemoMode()) {
    await mutateDemoStore(ctx.userId, (store) => {
      const idx = store.tasks.findIndex((t) => t.id === id && t.user_id === ctx.userId);
      if (idx === -1) throw new NotFoundError("Task not found");
      store.tasks[idx] = updated;
    });
    return updated;
  }

  const client = await sb();
  const { data, error } = await client
    .from("tasks")
    .update({
      title: updated.title,
      description: updated.description,
      status: updated.status,
      priority: updated.priority,
      due_date: updated.due_date,
      due_time: updated.due_time,
      category: updated.category,
      project_id: updated.project_id,
      checklist_id: updated.checklist_id,
      tags: updated.tags,
      estimated_minutes: updated.estimated_minutes,
      completed_at: updated.completed_at,
      updated_at: updated.updated_at,
    })
    .eq("id", id)
    .eq("user_id", ctx.userId)
    .select()
    .single();
  if (error || !data) throw new NotFoundError("Task not found");
  return data as Task;
}

export async function deleteTask(id: string, auth?: AuthContext): Promise<void> {
  const ctx = auth ?? (await requireAuth());
  await getTask(id, ctx);

  if (ctx.isDemo || isDemoMode()) {
    await mutateDemoStore(ctx.userId, (store) => {
      store.tasks = store.tasks.filter((t) => !(t.id === id && t.user_id === ctx.userId));
    });
    return;
  }

  const client = await sb();
  const { error } = await client
    .from("tasks")
    .delete()
    .eq("id", id)
    .eq("user_id", ctx.userId);
  if (error) throw error;
}

export async function completeTask(id: string, auth?: AuthContext): Promise<Task> {
  return updateTask(id, { status: "done" }, auth);
}

// ─── Checklists ──────────────────────────────────────────────────────────────

export async function listChecklists(auth?: AuthContext): Promise<Checklist[]> {
  const ctx = auth ?? (await requireAuth());
  if (ctx.isDemo || isDemoMode()) {
    const store = await getDemoStore(ctx.userId);
    return store.checklists.filter((c) => c.user_id === ctx.userId && !c.is_archived);
  }
  const client = await sb();
  const { data, error } = await client
    .from("checklists")
    .select("*")
    .eq("user_id", ctx.userId)
    .eq("is_archived", false)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Checklist[];
}

export async function getChecklistItems(
  checklistId: string,
  auth?: AuthContext
): Promise<ChecklistItem[]> {
  const ctx = auth ?? (await requireAuth());
  if (ctx.isDemo || isDemoMode()) {
    const store = await getDemoStore(ctx.userId);
    return store.checklist_items
      .filter((i) => i.checklist_id === checklistId && i.user_id === ctx.userId)
      .sort((a, b) => a.position - b.position);
  }
  const client = await sb();
  const { data, error } = await client
    .from("checklist_items")
    .select("*")
    .eq("checklist_id", checklistId)
    .eq("user_id", ctx.userId)
    .order("position");
  if (error) throw error;
  return (data ?? []) as ChecklistItem[];
}

export async function createChecklist(
  input: {
    title: string;
    description?: string | null;
    category?: string | null;
    project_id?: string | null;
    is_template?: boolean;
    items?: { title: string; due_date?: string | null }[];
  },
  auth?: AuthContext
): Promise<{ checklist: Checklist; items: ChecklistItem[] }> {
  const ctx = auth ?? (await requireAuth());
  const now = nowIso();
  const checklist: Checklist = {
    id: generateId(),
    user_id: ctx.userId,
    title: input.title.trim(),
    description: input.description ?? null,
    category: input.category ?? null,
    project_id: input.project_id ?? null,
    is_template: input.is_template ?? false,
    is_archived: false,
    created_at: now,
    updated_at: now,
  };
  const items: ChecklistItem[] = (input.items ?? []).map((item, index) => ({
    id: generateId(),
    checklist_id: checklist.id,
    user_id: ctx.userId,
    title: item.title.trim(),
    is_completed: false,
    due_date: item.due_date ?? null,
    position: index,
    completed_at: null,
    created_at: now,
    updated_at: now,
  }));

  if (ctx.isDemo || isDemoMode()) {
    await mutateDemoStore(ctx.userId, (store) => {
      store.checklists.unshift(checklist);
      store.checklist_items.push(...items);
    });
    return { checklist, items };
  }

  const client = await sb();
  const { data, error } = await client
    .from("checklists")
    .insert(checklist)
    .select()
    .single();
  if (error) throw error;
  if (items.length) {
    const { error: itemErr } = await client.from("checklist_items").insert(items);
    if (itemErr) throw itemErr;
  }
  return { checklist: data as Checklist, items };
}

export async function updateChecklist(
  id: string,
  patch: Partial<Checklist>,
  auth?: AuthContext
): Promise<Checklist> {
  const ctx = auth ?? (await requireAuth());
  const now = nowIso();

  if (ctx.isDemo || isDemoMode()) {
    let updated: Checklist | null = null;
    await mutateDemoStore(ctx.userId, (store) => {
      const idx = store.checklists.findIndex(
        (c) => c.id === id && c.user_id === ctx.userId
      );
      if (idx === -1) throw new NotFoundError("Checklist not found");
      store.checklists[idx] = {
        ...store.checklists[idx],
        ...patch,
        id,
        user_id: ctx.userId,
        updated_at: now,
      };
      updated = store.checklists[idx];
    });
    return updated!;
  }

  const client = await sb();
  const { data, error } = await client
    .from("checklists")
    .update({ ...patch, updated_at: now })
    .eq("id", id)
    .eq("user_id", ctx.userId)
    .select()
    .single();
  if (error || !data) throw new NotFoundError("Checklist not found");
  return data as Checklist;
}

export async function deleteChecklist(id: string, auth?: AuthContext): Promise<void> {
  const ctx = auth ?? (await requireAuth());
  if (ctx.isDemo || isDemoMode()) {
    await mutateDemoStore(ctx.userId, (store) => {
      store.checklists = store.checklists.filter(
        (c) => !(c.id === id && c.user_id === ctx.userId)
      );
      store.checklist_items = store.checklist_items.filter(
        (i) => !(i.checklist_id === id && i.user_id === ctx.userId)
      );
    });
    return;
  }
  const client = await sb();
  const { error } = await client
    .from("checklists")
    .delete()
    .eq("id", id)
    .eq("user_id", ctx.userId);
  if (error) throw error;
}

export async function manageChecklistItem(
  input: {
    checklist_id: string;
    action: "add" | "update" | "complete" | "uncomplete" | "remove" | "reorder";
    item_id?: string;
    title?: string;
    due_date?: string | null;
    ordered_ids?: string[];
  },
  auth?: AuthContext
): Promise<ChecklistItem | ChecklistItem[] | null> {
  const ctx = auth ?? (await requireAuth());
  const now = nowIso();

  // Verify ownership of checklist
  const checklists = await listChecklists(ctx);
  const owns = checklists.some((c) => c.id === input.checklist_id);
  // Also allow archived for item ops via demo store direct check
  if (!owns && !(ctx.isDemo || isDemoMode())) {
    throw new NotFoundError("Checklist not found");
  }

  if (ctx.isDemo || isDemoMode()) {
    let result: ChecklistItem | ChecklistItem[] | null = null;
    await mutateDemoStore(ctx.userId, (store) => {
      const cl = store.checklists.find(
        (c) => c.id === input.checklist_id && c.user_id === ctx.userId
      );
      if (!cl) throw new NotFoundError("Checklist not found");

      if (input.action === "add") {
        const items = store.checklist_items.filter(
          (i) => i.checklist_id === input.checklist_id
        );
        const item: ChecklistItem = {
          id: generateId(),
          checklist_id: input.checklist_id,
          user_id: ctx.userId,
          title: (input.title ?? "New item").trim(),
          is_completed: false,
          due_date: input.due_date ?? null,
          position: items.length,
          completed_at: null,
          created_at: now,
          updated_at: now,
        };
        store.checklist_items.push(item);
        cl.updated_at = now;
        result = item;
      } else if (input.action === "update" && input.item_id) {
        const idx = store.checklist_items.findIndex(
          (i) => i.id === input.item_id && i.user_id === ctx.userId
        );
        if (idx === -1) throw new NotFoundError("Item not found");
        store.checklist_items[idx] = {
          ...store.checklist_items[idx],
          title: input.title ?? store.checklist_items[idx].title,
          due_date:
            input.due_date !== undefined
              ? input.due_date
              : store.checklist_items[idx].due_date,
          updated_at: now,
        };
        result = store.checklist_items[idx];
      } else if (
        (input.action === "complete" || input.action === "uncomplete") &&
        input.item_id
      ) {
        const idx = store.checklist_items.findIndex(
          (i) => i.id === input.item_id && i.user_id === ctx.userId
        );
        if (idx === -1) throw new NotFoundError("Item not found");
        const done = input.action === "complete";
        store.checklist_items[idx] = {
          ...store.checklist_items[idx],
          is_completed: done,
          completed_at: done ? now : null,
          updated_at: now,
        };
        result = store.checklist_items[idx];
      } else if (input.action === "remove" && input.item_id) {
        store.checklist_items = store.checklist_items.filter(
          (i) => !(i.id === input.item_id && i.user_id === ctx.userId)
        );
        result = null;
      } else if (input.action === "reorder" && input.ordered_ids) {
        input.ordered_ids.forEach((oid, pos) => {
          const idx = store.checklist_items.findIndex(
            (i) => i.id === oid && i.user_id === ctx.userId
          );
          if (idx !== -1) {
            store.checklist_items[idx].position = pos;
            store.checklist_items[idx].updated_at = now;
          }
        });
        result = store.checklist_items
          .filter((i) => i.checklist_id === input.checklist_id)
          .sort((a, b) => a.position - b.position);
      }
    });
    return result;
  }

  const client = await sb();
  if (input.action === "add") {
    const { count } = await client
      .from("checklist_items")
      .select("*", { count: "exact", head: true })
      .eq("checklist_id", input.checklist_id);
    const item = {
      id: generateId(),
      checklist_id: input.checklist_id,
      user_id: ctx.userId,
      title: (input.title ?? "New item").trim(),
      is_completed: false,
      due_date: input.due_date ?? null,
      position: count ?? 0,
      completed_at: null,
    };
    const { data, error } = await client
      .from("checklist_items")
      .insert(item)
      .select()
      .single();
    if (error) throw error;
    return data as ChecklistItem;
  }
  if (input.action === "complete" || input.action === "uncomplete") {
    const done = input.action === "complete";
    const { data, error } = await client
      .from("checklist_items")
      .update({
        is_completed: done,
        completed_at: done ? now : null,
        updated_at: now,
      })
      .eq("id", input.item_id!)
      .eq("user_id", ctx.userId)
      .select()
      .single();
    if (error || !data) throw new NotFoundError("Item not found");
    return data as ChecklistItem;
  }
  if (input.action === "update") {
    const { data, error } = await client
      .from("checklist_items")
      .update({
        title: input.title,
        due_date: input.due_date,
        updated_at: now,
      })
      .eq("id", input.item_id!)
      .eq("user_id", ctx.userId)
      .select()
      .single();
    if (error || !data) throw new NotFoundError("Item not found");
    return data as ChecklistItem;
  }
  if (input.action === "remove") {
    const { error } = await client
      .from("checklist_items")
      .delete()
      .eq("id", input.item_id!)
      .eq("user_id", ctx.userId);
    if (error) throw error;
    return null;
  }
  if (input.action === "reorder" && input.ordered_ids) {
    for (let i = 0; i < input.ordered_ids.length; i++) {
      await client
        .from("checklist_items")
        .update({ position: i, updated_at: now })
        .eq("id", input.ordered_ids[i])
        .eq("user_id", ctx.userId);
    }
    return getChecklistItems(input.checklist_id, ctx);
  }
  return null;
}

// ─── Projects ────────────────────────────────────────────────────────────────

export async function listProjects(auth?: AuthContext): Promise<Project[]> {
  const ctx = auth ?? (await requireAuth());
  if (ctx.isDemo || isDemoMode()) {
    const store = await getDemoStore(ctx.userId);
    return store.projects.filter((p) => p.user_id === ctx.userId && !p.is_archived);
  }
  const client = await sb();
  const { data, error } = await client
    .from("projects")
    .select("*")
    .eq("user_id", ctx.userId)
    .eq("is_archived", false)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Project[];
}

export async function createProject(
  input: Partial<Project> & { name: string },
  auth?: AuthContext
): Promise<Project> {
  const ctx = auth ?? (await requireAuth());
  const now = nowIso();
  const project: Project = {
    id: generateId(),
    user_id: ctx.userId,
    name: input.name.trim(),
    description: input.description ?? null,
    status: input.status ?? "active",
    priority: input.priority ?? "medium",
    start_date: input.start_date ?? null,
    deadline: input.deadline ?? null,
    is_archived: false,
    created_at: now,
    updated_at: now,
  };

  if (ctx.isDemo || isDemoMode()) {
    await mutateDemoStore(ctx.userId, (store) => {
      store.projects.unshift(project);
    });
    return project;
  }

  const client = await sb();
  const { data, error } = await client.from("projects").insert(project).select().single();
  if (error) throw error;
  return data as Project;
}

export async function updateProject(
  id: string,
  patch: Partial<Project>,
  auth?: AuthContext
): Promise<Project> {
  const ctx = auth ?? (await requireAuth());
  const now = nowIso();

  if (ctx.isDemo || isDemoMode()) {
    let updated: Project | null = null;
    await mutateDemoStore(ctx.userId, (store) => {
      const idx = store.projects.findIndex(
        (p) => p.id === id && p.user_id === ctx.userId
      );
      if (idx === -1) throw new NotFoundError("Project not found");
      store.projects[idx] = {
        ...store.projects[idx],
        ...patch,
        id,
        user_id: ctx.userId,
        updated_at: now,
      };
      updated = store.projects[idx];
    });
    return updated!;
  }

  const client = await sb();
  const { data, error } = await client
    .from("projects")
    .update({ ...patch, updated_at: now })
    .eq("id", id)
    .eq("user_id", ctx.userId)
    .select()
    .single();
  if (error || !data) throw new NotFoundError("Project not found");
  return data as Project;
}

export async function deleteProject(id: string, auth?: AuthContext): Promise<void> {
  const ctx = auth ?? (await requireAuth());
  if (ctx.isDemo || isDemoMode()) {
    await mutateDemoStore(ctx.userId, (store) => {
      store.projects = store.projects.filter(
        (p) => !(p.id === id && p.user_id === ctx.userId)
      );
      store.tasks = store.tasks.map((t) =>
        t.project_id === id ? { ...t, project_id: null } : t
      );
      store.checklists = store.checklists.map((c) =>
        c.project_id === id ? { ...c, project_id: null } : c
      );
    });
    return;
  }
  const client = await sb();
  const { error } = await client
    .from("projects")
    .delete()
    .eq("id", id)
    .eq("user_id", ctx.userId);
  if (error) throw error;
}

// ─── Events ──────────────────────────────────────────────────────────────────

export async function listEvents(
  filters: { from?: string; to?: string; limit?: number } = {},
  auth?: AuthContext
): Promise<CalendarEvent[]> {
  const ctx = auth ?? (await requireAuth());
  let events: CalendarEvent[];

  if (ctx.isDemo || isDemoMode()) {
    const store = await getDemoStore(ctx.userId);
    events = store.events.filter((e) => e.user_id === ctx.userId);
  } else {
    const client = await sb();
    let q = client
      .from("calendar_events")
      .select("*")
      .eq("user_id", ctx.userId)
      .order("start_at");
    if (filters.from) q = q.gte("start_at", filters.from);
    if (filters.to) q = q.lte("start_at", filters.to);
    const { data, error } = await q;
    if (error) throw error;
    events = (data ?? []) as CalendarEvent[];
  }

  if (filters.from) {
    events = events.filter((e) => e.start_at >= filters.from!);
  }
  if (filters.to) {
    events = events.filter((e) => e.start_at <= filters.to!);
  }
  events.sort((a, b) => a.start_at.localeCompare(b.start_at));
  if (filters.limit) events = events.slice(0, filters.limit);
  return events;
}

export async function createEvent(
  input: Partial<CalendarEvent> & {
    title: string;
    start_at: string;
    end_at: string;
  },
  auth?: AuthContext
): Promise<CalendarEvent> {
  const ctx = auth ?? (await requireAuth());
  if (new Date(input.end_at) < new Date(input.start_at)) {
    throw new Error("end_at must be >= start_at");
  }
  const now = nowIso();
  const event: CalendarEvent = {
    id: generateId(),
    user_id: ctx.userId,
    title: input.title.trim(),
    description: input.description ?? null,
    location: input.location ?? null,
    event_type: input.event_type ?? "event",
    start_at: input.start_at,
    end_at: input.end_at,
    all_day: input.all_day ?? false,
    project_id: input.project_id ?? null,
    created_at: now,
    updated_at: now,
  };

  if (ctx.isDemo || isDemoMode()) {
    await mutateDemoStore(ctx.userId, (store) => {
      store.events.push(event);
      store.events.sort((a, b) => a.start_at.localeCompare(b.start_at));
    });
    return event;
  }

  const client = await sb();
  const { data, error } = await client
    .from("calendar_events")
    .insert(event)
    .select()
    .single();
  if (error) throw error;
  return data as CalendarEvent;
}

export async function updateEvent(
  id: string,
  patch: Partial<CalendarEvent>,
  auth?: AuthContext
): Promise<CalendarEvent> {
  const ctx = auth ?? (await requireAuth());
  const now = nowIso();

  if (ctx.isDemo || isDemoMode()) {
    let updated: CalendarEvent | null = null;
    await mutateDemoStore(ctx.userId, (store) => {
      const idx = store.events.findIndex(
        (e) => e.id === id && e.user_id === ctx.userId
      );
      if (idx === -1) throw new NotFoundError("Event not found");
      const next = {
        ...store.events[idx],
        ...patch,
        id,
        user_id: ctx.userId,
        updated_at: now,
      };
      if (new Date(next.end_at) < new Date(next.start_at)) {
        throw new Error("end_at must be >= start_at");
      }
      store.events[idx] = next;
      updated = next;
    });
    return updated!;
  }

  const client = await sb();
  const { data, error } = await client
    .from("calendar_events")
    .update({ ...patch, updated_at: now })
    .eq("id", id)
    .eq("user_id", ctx.userId)
    .select()
    .single();
  if (error || !data) throw new NotFoundError("Event not found");
  return data as CalendarEvent;
}

export async function deleteEvent(id: string, auth?: AuthContext): Promise<void> {
  const ctx = auth ?? (await requireAuth());
  if (ctx.isDemo || isDemoMode()) {
    await mutateDemoStore(ctx.userId, (store) => {
      store.events = store.events.filter(
        (e) => !(e.id === id && e.user_id === ctx.userId)
      );
    });
    return;
  }
  const client = await sb();
  const { error } = await client
    .from("calendar_events")
    .delete()
    .eq("id", id)
    .eq("user_id", ctx.userId);
  if (error) throw error;
}

// ─── Preferences & Reminders ─────────────────────────────────────────────────

export async function getPreferences(
  auth?: AuthContext
): Promise<ProductivityPreferences> {
  const ctx = auth ?? (await requireAuth());
  if (ctx.isDemo || isDemoMode()) {
    const store = await getDemoStore(ctx.userId);
    return store.preferences;
  }
  const client = await sb();
  const { data, error } = await client
    .from("productivity_preferences")
    .select("*")
    .eq("user_id", ctx.userId)
    .single();
  if (error || !data) {
    return {
      id: generateId(),
      user_id: ctx.userId,
      preferred_working_hours_start: null,
      preferred_working_hours_end: null,
      planning_style: null,
      default_task_duration_minutes: 45,
      timezone: ctx.profile.timezone || DEFAULT_TIMEZONE,
      week_starts_on: 1,
      reminder_lead_minutes: 60,
      categories: [],
      created_at: nowIso(),
      updated_at: nowIso(),
    };
  }
  return data as ProductivityPreferences;
}

export async function savePreferences(
  patch: Partial<ProductivityPreferences>,
  auth?: AuthContext
): Promise<ProductivityPreferences> {
  const ctx = auth ?? (await requireAuth());
  const existing = await getPreferences(ctx);
  const updated: ProductivityPreferences = {
    ...existing,
    ...patch,
    id: existing.id,
    user_id: ctx.userId,
    updated_at: nowIso(),
  };

  if (ctx.isDemo || isDemoMode()) {
    await mutateDemoStore(ctx.userId, (store) => {
      store.preferences = updated;
      if (patch.timezone) {
        store.profile.timezone = patch.timezone;
      }
    });
    return updated;
  }

  const client = await sb();
  const { data, error } = await client
    .from("productivity_preferences")
    .upsert(updated)
    .select()
    .single();
  if (error) throw error;
  return data as ProductivityPreferences;
}

export async function listReminders(auth?: AuthContext): Promise<Reminder[]> {
  const ctx = auth ?? (await requireAuth());
  if (ctx.isDemo || isDemoMode()) {
    const store = await getDemoStore(ctx.userId);
    return store.reminders
      .filter((r) => r.user_id === ctx.userId)
      .sort((a, b) => b.remind_at.localeCompare(a.remind_at));
  }
  const client = await sb();
  const { data, error } = await client
    .from("reminders")
    .select("*")
    .eq("user_id", ctx.userId)
    .order("remind_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Reminder[];
}

export async function markReminderRead(
  id: string,
  auth?: AuthContext
): Promise<Reminder> {
  const ctx = auth ?? (await requireAuth());
  if (ctx.isDemo || isDemoMode()) {
    let updated: Reminder | null = null;
    await mutateDemoStore(ctx.userId, (store) => {
      const idx = store.reminders.findIndex(
        (r) => r.id === id && r.user_id === ctx.userId
      );
      if (idx === -1) throw new NotFoundError("Reminder not found");
      store.reminders[idx] = { ...store.reminders[idx], is_read: true };
      updated = store.reminders[idx];
    });
    return updated!;
  }
  const client = await sb();
  const { data, error } = await client
    .from("reminders")
    .update({ is_read: true })
    .eq("id", id)
    .eq("user_id", ctx.userId)
    .select()
    .single();
  if (error || !data) throw new NotFoundError("Reminder not found");
  return data as Reminder;
}

export async function createReminderFromDueItems(
  auth?: AuthContext
): Promise<Reminder[]> {
  const ctx = auth ?? (await requireAuth());
  const prefs = await getPreferences(ctx);
  const tasks = await listTasks({}, ctx);
  const now = new Date();
  const leadMs = prefs.reminder_lead_minutes * 60 * 1000;
  const created: Reminder[] = [];

  for (const task of tasks) {
    if (!task.due_date || task.status === "done" || task.status === "cancelled") {
      continue;
    }
    const due = new Date(
      task.due_time ? `${task.due_date}T${task.due_time}` : `${task.due_date}T23:59:00`
    );
    const remindAt = new Date(due.getTime() - leadMs);
    if (remindAt > now) continue;

    const existing = await listReminders(ctx);
    if (
      existing.some(
        (r) => r.related_type === "task" && r.related_id === task.id && !r.is_read
      )
    ) {
      continue;
    }

    const reminder: Reminder = {
      id: generateId(),
      user_id: ctx.userId,
      title:
        due < now
          ? `${task.title} is overdue`
          : `${task.title} is due soon`,
      body: task.description,
      remind_at: nowIso(),
      related_type: "task",
      related_id: task.id,
      is_read: false,
      is_delivered: true,
      delivered_at: nowIso(),
      created_at: nowIso(),
    };

    if (ctx.isDemo || isDemoMode()) {
      await mutateDemoStore(ctx.userId, (store) => {
        store.reminders.unshift(reminder);
      });
    } else {
      const client = await sb();
      await client.from("reminders").insert(reminder);
    }
    created.push(reminder);
  }

  return created;
}

// ─── Summary ─────────────────────────────────────────────────────────────────

export async function getProductivitySummary(
  auth?: AuthContext
): Promise<ProductivitySummary> {
  const ctx = auth ?? (await requireAuth());
  const tz = ctx.profile.timezone || DEFAULT_TIMEZONE;
  const tasks = await listTasks({}, ctx);
  const events = await listEvents({}, ctx);
  const projects = await listProjects(ctx);
  const reminders = await listReminders(ctx);
  const checklists = await listChecklists(ctx);

  let incompleteItems = 0;
  for (const cl of checklists) {
    const items = await getChecklistItems(cl.id, ctx);
    incompleteItems += items.filter((i) => !i.is_completed).length;
  }

  const { isDueToday } = await import("@/lib/utils/dates");
  const todayTasks = tasks.filter(
    (t) =>
      t.status !== "done" &&
      t.status !== "cancelled" &&
      isDueToday(t.due_date, tz)
  );

  const overdue_tasks = tasks.filter((t) =>
    isOverdue(t.due_date, t.due_time, tz, t.status)
  );

  const upcoming_deadlines = tasks
    .filter(
      (t) =>
        t.due_date &&
        t.status !== "done" &&
        t.status !== "cancelled" &&
        !isOverdue(t.due_date, t.due_time, tz, t.status)
    )
    .slice(0, 10);

  const now = new Date().toISOString();
  const upcoming_events = events
    .filter((e) => e.start_at >= now)
    .slice(0, 10);

  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const recent = tasks.filter((t) => t.updated_at >= weekAgo);
  const done = recent.filter((t) => t.status === "done").length;
  const completion_rate_7d =
    recent.length === 0 ? 0 : Math.round((done / recent.length) * 100);

  return {
    today_tasks: todayTasks,
    overdue_tasks,
    upcoming_deadlines,
    upcoming_events,
    active_projects: projects.filter((p) => p.status === "active"),
    incomplete_checklist_items: incompleteItems,
    completion_rate_7d,
    unread_reminders: reminders.filter((r) => !r.is_read).length,
  };
}

export async function updateProfileAvatar(
  avatarUrl: string | null,
  auth?: AuthContext
): Promise<Profile> {
  const ctx = auth ?? (await requireAuth());
  const updatedAt = nowIso();

  if (ctx.isDemo || isDemoMode()) {
    const store = await mutateDemoStore(ctx.userId, (demo) => {
      demo.profile.avatar_url = avatarUrl;
      demo.profile.updated_at = updatedAt;
    });
    return {
      ...store.profile,
      created_at: ctx.profile.created_at || store.profile.created_at,
    };
  }

  const client = await sb();
  const { data, error } = await client
    .from("profiles")
    .update({ avatar_url: avatarUrl, updated_at: updatedAt })
    .eq("id", ctx.userId)
    .select("*")
    .single();
  if (error) throw error;
  return data as Profile;
}
