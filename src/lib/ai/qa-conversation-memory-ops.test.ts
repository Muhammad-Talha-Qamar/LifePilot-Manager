/**
 * Phase-10 conversation context, memory isolation, and real demo-store ops QA.
 * Asserts store state — not assistant reply text alone.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { AuthContext } from "@/lib/data/auth";
import {
  createTask,
  getTask,
  listProjects,
  listTasks,
} from "@/lib/data/repository";
import {
  clearAllMemories,
  deleteMemory,
  listMemories,
  saveMemory,
} from "@/lib/data/memories";
import { clearDemoStore, getDemoStore } from "@/lib/demo/store";
import { runLocalCommand } from "./local-agent";
import { executeTool } from "./tools";
import { emptyContext, type Board, type ConversationContext } from "./types";
import type { Task } from "@/types";
import type { ToolHandler } from "./local-agent";
import {
  detectMemoryIntent,
  retrieveRelevantMemories,
} from "./memory";

const now = new Date("2026-10-22T08:00:00.000Z");

const authA: AuthContext = {
  userId: "qa-ops-user-a",
  email: "qa-a@test.local",
  isDemo: true,
  profile: {
    id: "qa-ops-user-a",
    email: "qa-a@test.local",
    full_name: "QA A",
    avatar_url: null,
    timezone: "Asia/Karachi",
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-01T00:00:00.000Z",
  },
};

const authB: AuthContext = {
  ...authA,
  userId: "qa-ops-user-b",
  email: "qa-b@test.local",
  profile: {
    ...authA.profile,
    id: "qa-ops-user-b",
    email: "qa-b@test.local",
    full_name: "QA B",
  },
};

beforeEach(async () => {
  await clearDemoStore(authA.userId, authA.email, "QA A");
  await clearDemoStore(authB.userId, authB.email, "QA B");
});

function asBoard(tasks: Task[], timezone = "Asia/Karachi"): Board {
  return {
    tasks,
    projects: [],
    checklists: [],
    events: [],
    timezone,
    weekStartsOn: 1,
    now,
    defaultDuration: 45,
    workStart: "09:00",
    workEnd: "17:00",
  };
}

function liveToolHandler(auth: AuthContext): ToolHandler {
  return async (name, args) => executeTool(name, args, auth);
}

describe("QA conversation — multi-turn without unintended duplicates", () => {
  it("treats 'make it <weekday> instead' as a deadline change, not a rename", async () => {
    const created = await executeTool(
      "create_task",
      { title: "Outline", due_date: "2026-10-23" },
      authA
    );
    const task = created.result as { id: string; title: string; due_date: string };
    const context = emptyContext();
    context.focus = {
      kind: "task",
      id: task.id,
      label: task.title,
      detail: task.due_date,
    };
    context.lastTasks = [{ id: task.id, title: task.title }];
    const boardState = asBoard([
      {
        ...(await getTask(task.id, authA)),
      },
    ]);
    const result = await runLocalCommand(
      "actually make it Saturday instead",
      context,
      boardState,
      liveToolHandler(authA)
    );
    expect(result.message.toLowerCase()).toMatch(/updated|saturday|oct 24/);
    expect(result.message.toLowerCase()).not.toMatch(/renamed/);
    expect((await getTask(task.id, authA)).title).toBe("Outline");
    expect((await getTask(task.id, authA)).due_date).toBe("2026-10-24");
  });

  it("creates, reschedules via follow-up, and completes without duplicates", async () => {
    let context: ConversationContext = emptyContext();
    const boardState = asBoard([]);
    const act = liveToolHandler(authA);

    // Sync board from store after each turn
    const refresh = async () => {
      boardState.tasks = await listTasks({}, authA);
      boardState.projects = await listProjects(authA);
    };

    const turn1 = await runLocalCommand(
      "Add draft thesis outline for tomorrow",
      context,
      boardState,
      act
    );
    context = turn1.context;
    await refresh();
    expect(boardState.tasks.filter((t) => /thesis outline/i.test(t.title))).toHaveLength(1);
    const taskId = boardState.tasks[0].id;

    // Oct 22 2026 is Thursday; tomorrow is already Friday (2026-10-23).
    // Reschedule to Saturday to prove the deadline actually changes.
    const turn2 = await runLocalCommand(
      "actually make it Saturday instead",
      context,
      boardState,
      act
    );
    context = turn2.context;
    await refresh();
    expect(boardState.tasks.filter((t) => /thesis outline/i.test(t.title))).toHaveLength(1);
    expect((await getTask(taskId, authA)).due_date).toBe("2026-10-24");

    const turn3 = await runLocalCommand(
      "mark it done",
      context,
      boardState,
      act
    );
    context = turn3.context;
    await refresh();
    expect((await getTask(taskId, authA)).status).toBe("done");
    expect(boardState.tasks.filter((t) => /thesis outline/i.test(t.title))).toHaveLength(1);
  });

  it("manages two projects without cross-linking the wrong tasks", async () => {
    const science = await executeTool(
      "create_project",
      { name: "Science Fair" },
      authA
    );
    const midterms = await executeTool(
      "create_project",
      { name: "Midterms" },
      authA
    );
    expect(science.success && midterms.success).toBe(true);
    const scienceId = (science.result as { id: string }).id;
    const midtermsId = (midterms.result as { id: string }).id;

    const research = await executeTool(
      "create_task",
      { title: "Research poster", project_id: scienceId },
      authA
    );
    const algebra = await executeTool(
      "create_task",
      { title: "Study algebra", project_id: midtermsId },
      authA
    );
    expect(research.success && algebra.success).toBe(true);

    const store = await getDemoStore(authA.userId);
    expect(store.tasks.find((t) => t.title === "Research poster")?.project_id).toBe(scienceId);
    expect(store.tasks.find((t) => t.title === "Study algebra")?.project_id).toBe(midtermsId);
    expect(store.projects).toHaveLength(2);
  });
});

describe("QA persistent memory", () => {
  it("saves preference, retrieves it, replaces it, and forgets without fabricating", async () => {
    const intent = detectMemoryIntent("Remember that I prefer concise task summaries");
    expect(intent.kind).toBe("save");

    const saved = await saveMemory(
      {
        content: "Prefer concise task summaries",
        category: "preference",
        key: "summary_length",
        tags: ["tone"],
      },
      authA
    );
    expect(saved.content).toMatch(/concise/i);

    const hits = retrieveRelevantMemories(
      await listMemories(authA),
      "how should you summarize my tasks?"
    );
    expect(hits.preferences.some((m) => m.id === saved.id)).toBe(true);

    const updated = await saveMemory(
      {
        content: "Prefer detailed task summaries with deadlines",
        category: "preference",
        key: "summary_length",
        tags: ["tone"],
        replace_key: true,
      },
      authA
    );
    const listed = await listMemories(authA);
    const sameKey = listed.filter((m) => m.key === "summary_length");
    expect(sameKey.some((m) => /detailed/i.test(m.content))).toBe(true);

    await deleteMemory(updated.id, authA);
    const afterDelete = await listMemories(authA);
    expect(afterDelete.some((m) => m.id === updated.id)).toBe(false);

    // Missing info must not invent answers — retrieval returns no fabricated prefs
    const emptyHits = retrieveRelevantMemories(afterDelete, "what is my favorite color?");
    expect(
      [...emptyHits.preferences, ...emptyHits.context].every(
        (m) => !/favorite color/i.test(m.content)
      )
    ).toBe(true);
  });

  it("keeps memories isolated across users", async () => {
    await saveMemory(
      { content: "User A prefers morning plans", category: "preference", key: "plan_time" },
      authA
    );
    await saveMemory(
      { content: "User B prefers evening plans", category: "preference", key: "plan_time" },
      authB
    );
    const a = await listMemories(authA);
    const b = await listMemories(authB);
    expect(a.every((m) => m.user_id === authA.userId)).toBe(true);
    expect(b.every((m) => m.user_id === authB.userId)).toBe(true);
    expect(a.some((m) => /evening/i.test(m.content))).toBe(false);
    expect(b.some((m) => /morning/i.test(m.content))).toBe(false);

    await clearAllMemories(authA);
    expect(await listMemories(authA)).toHaveLength(0);
    expect((await listMemories(authB)).length).toBeGreaterThan(0);
  });

  it("does not treat task reminders as persistent preference memory", () => {
    expect(detectMemoryIntent("remember to buy milk")).toEqual({ kind: "none" });
  });
});

describe("QA real application operations (demo store)", () => {
  it("verifies create/list/update/complete/delete and deadline change in store", async () => {
    const created = await executeTool(
      "create_task",
      { title: "QA Ops Task", due_date: "2026-10-29", priority: "high" },
      authA
    );
    expect(created.success).toBe(true);
    const id = (created.result as { id: string }).id;
    expect((await getDemoStore(authA.userId)).tasks.some((t) => t.id === id)).toBe(true);

    await executeTool("update_task", { id, due_date: "2026-10-30" }, authA);
    expect((await getTask(id, authA)).due_date).toBe("2026-10-30");

    await executeTool("complete_task", { id }, authA);
    expect((await getTask(id, authA)).status).toBe("done");

    await executeTool("delete_task", { id, confirmed: true }, authA);
    expect((await getDemoStore(authA.userId)).tasks.some((t) => t.id === id)).toBe(false);
  });

  it("blocks unauthorized cross-user task access", async () => {
    const task = await createTask({ title: "Private A" }, authA);
    const stolen = await executeTool("get_task", { id: task.id }, authB);
    expect(stolen.success).toBe(false);
    const updated = await executeTool(
      "update_task",
      { id: task.id, title: "Hijacked" },
      authB
    );
    expect(updated.success).toBe(false);
    expect((await getTask(task.id, authA)).title).toBe("Private A");
  });

  it("rejects invalid inputs and unconfirmed deletes", async () => {
    const bad = await executeTool("update_task", { id: "not-uuid", title: "x" }, authA);
    expect(bad.success).toBe(false);
    const task = await createTask({ title: "Keep me" }, authA);
    const unconfirmed = await executeTool(
      "delete_task",
      { id: task.id, confirmed: false },
      authA
    );
    expect(unconfirmed.success).toBe(false);
    expect((await listTasks({}, authA)).some((t) => t.id === task.id)).toBe(true);
  });
});
