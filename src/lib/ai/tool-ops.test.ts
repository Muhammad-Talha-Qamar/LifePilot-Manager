/**
 * Real demo-store verification for AI tool → repository → disk writes.
 * These assert database (demo store) state, not assistant reply text alone.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { AuthContext } from "@/lib/data/auth";
import {
  createTask,
  getTask,
  listChecklists,
  listProjects,
  listTasks,
} from "@/lib/data/repository";
import { clearDemoStore, getDemoStore } from "@/lib/demo/store";
import { executeTool } from "./tools";

const authA: AuthContext = {
  userId: "tool-ops-user-a",
  email: "ops-a@test.local",
  isDemo: true,
  profile: {
    id: "tool-ops-user-a",
    email: "ops-a@test.local",
    full_name: "Ops A",
    avatar_url: null,
    timezone: "Asia/Karachi",
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-01T00:00:00.000Z",
  },
};

const authB: AuthContext = {
  ...authA,
  userId: "tool-ops-user-b",
  email: "ops-b@test.local",
  profile: {
    ...authA.profile,
    id: "tool-ops-user-b",
    email: "ops-b@test.local",
    full_name: "Ops B",
  },
};

beforeEach(async () => {
  await clearDemoStore(authA.userId, authA.email, "Ops A");
  await clearDemoStore(authB.userId, authB.email, "Ops B");
});

describe("executeTool real demo-store operations", () => {
  it("creates, lists, updates, completes, and deletes a task with verified store state", async () => {
    const created = await executeTool(
      "create_task",
      { title: "Homework", due_date: "2026-10-29", priority: "high" },
      authA
    );
    expect(created.success).toBe(true);
    const task = created.result as { id: string; title: string; due_date: string; status: string };
    expect(task.title).toBe("Homework");

    const storeAfterCreate = await getDemoStore(authA.userId);
    expect(storeAfterCreate.tasks.some((item) => item.id === task.id)).toBe(true);

    const listed = await executeTool("list_tasks", { query: "Homework" }, authA);
    expect(listed.success).toBe(true);
    expect((listed.result as { id: string }[]).some((item) => item.id === task.id)).toBe(true);

    const updated = await executeTool(
      "update_task",
      { id: task.id, due_date: "2026-10-30", title: "Homework revised" },
      authA
    );
    expect(updated.success).toBe(true);
    const verifiedUpdate = await getTask(task.id, authA);
    expect(verifiedUpdate.due_date).toBe("2026-10-30");
    expect(verifiedUpdate.title).toBe("Homework revised");

    const completed = await executeTool("complete_task", { id: task.id }, authA);
    expect(completed.success).toBe(true);
    expect((await getTask(task.id, authA)).status).toBe("done");

    const deleted = await executeTool(
      "delete_task",
      { id: task.id, confirmed: true },
      authA
    );
    expect(deleted.success).toBe(true);
    const storeAfterDelete = await getDemoStore(authA.userId);
    expect(storeAfterDelete.tasks.some((item) => item.id === task.id)).toBe(false);
  });

  it("creates a project, assigns tasks, and verifies ownership isolation", async () => {
    const projectResult = await executeTool(
      "create_project",
      { name: "Science Fair", deadline: "2026-11-15" },
      authA
    );
    expect(projectResult.success).toBe(true);
    const project = projectResult.result as { id: string; name: string; deadline: string };
    expect(project.name).toBe("Science Fair");
    expect((await listProjects(authA)).some((item) => item.id === project.id)).toBe(true);

    const taskResult = await executeTool(
      "create_task",
      { title: "Research", project_id: project.id, due_date: "2026-10-31" },
      authA
    );
    expect(taskResult.success).toBe(true);
    const task = taskResult.result as { id: string; project_id: string };
    expect(task.project_id).toBe(project.id);

    const foreign = await executeTool(
      "create_task",
      { title: "Steal", project_id: project.id },
      authB
    );
    expect(foreign.success).toBe(false);
    expect(String(foreign.error).toLowerCase()).toMatch(/project|not found|account/);

    const bProjects = await listProjects(authB);
    expect(bProjects.some((item) => item.id === project.id)).toBe(false);
  });

  it("rejects invalid identifiers and unconfirmed deletes", async () => {
    const badId = await executeTool(
      "update_task",
      { id: "not-a-uuid", title: "Nope" },
      authA
    );
    expect(badId.success).toBe(false);

    const missing = await executeTool(
      "get_task",
      { id: "44444444-4444-4444-8444-444444444499" },
      authA
    );
    expect(missing.success).toBe(false);

    const task = await createTask({ title: "Temp" }, authA);
    const unconfirmed = await executeTool(
      "delete_task",
      { id: task.id, confirmed: false },
      authA
    );
    expect(unconfirmed.success).toBe(false);
    expect((await listTasks({}, authA)).some((item) => item.id === task.id)).toBe(true);
  });

  it("creates checklist items and completes them with store verification", async () => {
    const checklist = await executeTool(
      "create_checklist",
      {
        title: "Groceries",
        items: [{ title: "Milk" }, { title: "Eggs" }],
      },
      authA
    );
    expect(checklist.success).toBe(true);
    const payload = checklist.result as {
      checklist: { id: string; title: string };
      items: { id: string; title: string }[];
    };
    expect(payload.checklist.title).toBe("Groceries");
    expect(payload.items).toHaveLength(2);

    const store = await getDemoStore(authA.userId);
    expect(store.checklists.some((item) => item.id === payload.checklist.id)).toBe(true);
    expect(
      store.checklist_items.filter((item) => item.checklist_id === payload.checklist.id)
    ).toHaveLength(2);

    const completed = await executeTool(
      "complete_checklist_items",
      {
        checklist_id: payload.checklist.id,
        item_ids: [payload.items[0].id],
      },
      authA
    );
    expect(completed.success).toBe(true);
    const after = await getDemoStore(authA.userId);
    const milk = after.checklist_items.find((item) => item.id === payload.items[0].id);
    expect(milk?.is_completed).toBe(true);

    const lists = await listChecklists(authA);
    expect(lists.some((item) => item.id === payload.checklist.id)).toBe(true);
  });

  it("reports partial failure when moving mixed valid/invalid task ids", async () => {
    const project = await executeTool("create_project", { name: "Lab" }, authA);
    const projectId = (project.result as { id: string }).id;
    const task = await executeTool("create_task", { title: "Lab notes" }, authA);
    const taskId = (task.result as { id: string }).id;

    const moved = await executeTool(
      "move_tasks_to_project",
      {
        project_id: projectId,
        task_ids: [taskId, "44444444-4444-4444-8444-444444444498"],
      },
      authA
    );
    expect(moved.success).toBe(false);
    const payload = moved.result as {
      updated: { id: string }[];
      failed: { id: string }[];
    };
    expect(payload.updated.map((item) => item.id)).toContain(taskId);
    expect(payload.failed.length).toBeGreaterThan(0);
    expect((await getTask(taskId, authA)).project_id).toBe(projectId);
  });

  it("does not create a duplicate project with the same name", async () => {
    const first = await executeTool("create_project", { name: "Midterms" }, authA);
    const second = await executeTool("create_project", { name: "Midterms" }, authA);
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect((second.result as { id: string }).id).toBe(
      (first.result as { id: string }).id
    );
    const projects = await listProjects(authA);
    expect(projects.filter((item) => item.name === "Midterms")).toHaveLength(1);
  });
});
