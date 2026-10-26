import type { ChecklistItem, Task } from "@/types";

export function checklistProgress(items: ChecklistItem[]): {
  total: number;
  completed: number;
  percent: number;
} {
  const total = items.length;
  const completed = items.filter((i) => i.is_completed).length;
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);
  return { total, completed, percent };
}

/**
 * Project progress = weighted average of:
 * - Associated tasks completion (70%)
 * - Associated checklist items completion (30%)
 * If only one source exists, that source is 100% of the weight.
 */
export function projectProgress(
  tasks: Task[],
  checklistItems: ChecklistItem[]
): {
  percent: number;
  tasksCompleted: number;
  tasksTotal: number;
  itemsCompleted: number;
  itemsTotal: number;
} {
  const relevantTasks = tasks.filter((t) => t.status !== "cancelled");
  const tasksTotal = relevantTasks.length;
  const tasksCompleted = relevantTasks.filter((t) => t.status === "done").length;
  const itemsTotal = checklistItems.length;
  const itemsCompleted = checklistItems.filter((i) => i.is_completed).length;

  const hasTasks = tasksTotal > 0;
  const hasItems = itemsTotal > 0;

  let percent = 0;
  if (hasTasks && hasItems) {
    const taskPct = (tasksCompleted / tasksTotal) * 100;
    const itemPct = (itemsCompleted / itemsTotal) * 100;
    percent = Math.round(taskPct * 0.7 + itemPct * 0.3);
  } else if (hasTasks) {
    percent = Math.round((tasksCompleted / tasksTotal) * 100);
  } else if (hasItems) {
    percent = Math.round((itemsCompleted / itemsTotal) * 100);
  }

  return {
    percent,
    tasksCompleted,
    tasksTotal,
    itemsCompleted,
    itemsTotal,
  };
}

export function filterTasksByQuery<T extends { title: string; description?: string | null; tags?: string[]; category?: string | null }>(
  tasks: T[],
  query: string
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return tasks;
  return tasks.filter((t) => {
    const hay = [
      t.title,
      t.description ?? "",
      t.category ?? "",
      ...(t.tags ?? []),
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

export function sortTasksByPriorityThenDue<
  T extends { priority: string; due_date: string | null; created_at: string },
>(tasks: T[]): T[] {
  const weight: Record<string, number> = {
    urgent: 4,
    high: 3,
    medium: 2,
    low: 1,
  };
  return [...tasks].sort((a, b) => {
    const pw = (weight[b.priority] ?? 0) - (weight[a.priority] ?? 0);
    if (pw !== 0) return pw;
    if (a.due_date && b.due_date) {
      return a.due_date.localeCompare(b.due_date);
    }
    if (a.due_date) return -1;
    if (b.due_date) return 1;
    return b.created_at.localeCompare(a.created_at);
  });
}
