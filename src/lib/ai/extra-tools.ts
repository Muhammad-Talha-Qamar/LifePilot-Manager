import { z } from "zod";
import type { AuthContext } from "@/lib/data/auth";
import {
  deleteChecklist,
  deleteEvent,
  getChecklistItems,
  getTask,
  listChecklists,
  listTasks,
  manageChecklistItem,
} from "@/lib/data/repository";
import { rankByName } from "./match";
import { querySchedule } from "./schedule";
import type { ChecklistItem, Task } from "@/types";

type ToolResult = { success: boolean; result: unknown; error?: string };

async function verifyTask(task: Task, auth: AuthContext): Promise<ToolResult> {
  const verified = await getTask(task.id, auth);
  if (verified.title !== task.title || verified.status !== task.status) {
    return { success: false, result: null, error: "The task write could not be verified." };
  }
  return { success: true, result: verified };
}

export async function runExtendedTool(
  name: string,
  rawArgs: Record<string, unknown>,
  auth: AuthContext
): Promise<ToolResult | undefined> {
  try {
    switch (name) {
      case "query_schedule": {
        const args = z
          .object({
            period: z.enum([
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
            ]),
            from: z.string().optional(),
            to: z.string().optional(),
          })
          .parse(rawArgs);
        if (args.period === "range" && (!args.from || !args.to)) {
          return {
            success: false,
            result: null,
            error: "A custom range needs both from and to dates (YYYY-MM-DD).",
          };
        }
        const result = await querySchedule(auth, args);
        return { success: true, result };
      }
      case "search_records": {
        const args = z
          .object({
            query: z.string().min(1),
            kind: z.enum(["task", "checklist", "event", "any"]).optional(),
          })
          .parse(rawArgs);
        const kind = args.kind ?? "any";
        const tasks =
          kind === "any" || kind === "task" ? await listTasks({ limit: 100 }, auth) : [];
        const checklists =
          kind === "any" || kind === "checklist" ? await listChecklists(auth) : [];
        const matches = [
          ...rankByName(args.query, tasks, (task) => task.title).map((row) => ({
            kind: "task" as const,
            id: row.item.id,
            label: row.item.title,
            score: row.score,
            status: row.item.status,
            due_date: row.item.due_date,
          })),
          ...rankByName(args.query, checklists, (checklist) => checklist.title).map((row) => ({
            kind: "checklist" as const,
            id: row.item.id,
            label: row.item.title,
            score: row.score,
          })),
        ]
          .sort((a, b) => b.score - a.score)
          .slice(0, 8);
        return { success: true, result: { query: args.query, matches } };
      }
      case "add_checklist_items": {
        const args = z
          .object({
            checklist_id: z.string().uuid(),
            titles: z.array(z.string().trim().min(1).max(300)).min(1).max(40),
          })
          .parse(rawArgs);
        const checklist = (await listChecklists(auth)).find(
          (item) => item.id === args.checklist_id
        );
        if (!checklist) return { success: false, result: null, error: "Checklist not found." };
        const items: ChecklistItem[] = [];
        for (const title of args.titles) {
          const created = await manageChecklistItem(
            { checklist_id: args.checklist_id, action: "add", title },
            auth
          );
          if (!created || Array.isArray(created)) {
            return {
              success: false,
              result: { checklist, items },
              error: `Stopped while adding “${title}”. ${items.length} item(s) were added before the failure.`,
            };
          }
          items.push(created);
        }
        const all = await getChecklistItems(args.checklist_id, auth);
        const missing = items.filter((item) => !all.some((saved) => saved.id === item.id));
        if (missing.length) {
          return {
            success: false,
            result: null,
            error: "Checklist items could not be verified after writing.",
          };
        }
        return { success: true, result: { checklist, items, all_items: all } };
      }
      case "complete_checklist_items": {
        const args = z
          .object({
            checklist_id: z.string().uuid(),
            item_ids: z.array(z.string().uuid()).optional(),
            first_n: z.number().int().min(1).max(50).optional(),
          })
          .parse(rawArgs);
        const all = await getChecklistItems(args.checklist_id, auth);
        const ordered = [...all].sort((a, b) => a.position - b.position);
        const chosen = args.item_ids?.length
          ? ordered.filter((item) => args.item_ids!.includes(item.id))
          : ordered.slice(0, args.first_n ?? 1);
        if (!chosen.length) {
          return { success: false, result: null, error: "No checklist items matched." };
        }
        const completed: ChecklistItem[] = [];
        for (const item of chosen) {
          if (item.is_completed) {
            completed.push(item);
            continue;
          }
          const updated = await manageChecklistItem(
            {
              checklist_id: args.checklist_id,
              action: "complete",
              item_id: item.id,
            },
            auth
          );
          if (!updated || Array.isArray(updated) || !updated.is_completed) {
            return {
              success: false,
              result: { completed },
              error: `Could not complete “${item.title}”.`,
            };
          }
          completed.push(updated);
        }
        const verified = await getChecklistItems(args.checklist_id, auth);
        const checklist = (await listChecklists(auth)).find(
          (item) => item.id === args.checklist_id
        );
        const notDone = completed.filter(
          (item) => !verified.find((saved) => saved.id === item.id)?.is_completed
        );
        if (notDone.length || !checklist) {
          return {
            success: false,
            result: null,
            error: "Checklist completion could not be verified.",
          };
        }
        return {
          success: true,
          result: { checklist, items: verified, completed },
        };
      }
      case "delete_checklist":
      case "delete_event": {
        const args = z
          .object({ id: z.string().uuid(), confirmed: z.boolean() })
          .parse(rawArgs);
        if (!args.confirmed) {
          return {
            success: false,
            result: null,
            error: "Deletion requires confirmed=true after the user confirms.",
          };
        }
        if (name === "delete_checklist") {
          await deleteChecklist(args.id, auth);
          const still = (await listChecklists(auth)).some((item) => item.id === args.id);
          if (still) return { success: false, result: null, error: "Checklist was not deleted." };
        } else {
          await deleteEvent(args.id, auth);
        }
        return { success: true, result: { deleted: true, id: args.id } };
      }
      default:
        return undefined;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tool execution failed";
    return { success: false, result: null, error: message };
  }
}

export async function verifyTaskWrite(task: Task, auth: AuthContext): Promise<ToolResult> {
  return verifyTask(task, auth);
}
