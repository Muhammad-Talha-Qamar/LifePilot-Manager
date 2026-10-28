/**
 * Phase-10 English-understanding QA suite.
 * Novel phrases (not memorized from earlier phase prompts) exercised against
 * the local NLU path used when OPENAI_API_KEY is unset.
 */
import { describe, expect, it } from "vitest";
import { rewriteIntent } from "./intent";
import { runLocalCommand } from "./local-agent";
import { normalizeInput } from "./normalize-input";
import { detectStance } from "./stance";
import { understandInput } from "./understand";
import { resolveInterpretation } from "./interpretation";
import type { Task } from "@/types";
import { emptyContext, type Board } from "./types";
import type { ToolHandler } from "./local-agent";

const now = new Date("2026-10-22T08:00:00.000Z");

function task(partial: Partial<Task> & Pick<Task, "id" | "title">): Task {
  return {
    user_id: "user",
    description: null,
    status: "todo",
    priority: "medium",
    due_date: null,
    due_time: null,
    category: null,
    project_id: null,
    checklist_id: null,
    tags: [],
    estimated_minutes: 30,
    completed_at: null,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    ...partial,
  };
}

function board(extra: Task[] = []): Board {
  return {
    tasks: [
      task({
        id: "44444444-4444-4444-8444-444444444401",
        title: "Finish maths homework",
        due_date: "2026-10-22",
      }),
      task({
        id: "44444444-4444-4444-8444-444444444402",
        title: "Science lab",
        due_date: "2026-10-23",
      }),
      task({
        id: "44444444-4444-4444-8444-444444444403",
        title: "Buy milk",
        due_date: "2026-10-22",
      }),
      task({
        id: "44444444-4444-4444-8444-444444444404",
        title: "Team standup notes",
        due_date: "2026-10-24",
      }),
      ...extra,
    ],
    projects: [],
    checklists: [],
    events: [],
    timezone: "Asia/Karachi",
    weekStartsOn: 1,
    now,
    defaultDuration: 45,
    workStart: "09:00",
    workEnd: "17:00",
  };
}

function harness(initial = board()) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const current = initial;
  const act: ToolHandler = async (name, args) => {
    calls.push({ name, args });
    if (name === "create_task") {
      const created = task({
        id: `44444444-4444-4444-8444-4444444444${String(calls.length).padStart(2, "0")}`,
        title: String(args.title),
        due_date: (args.due_date as string | null) ?? null,
      });
      current.tasks.unshift(created);
      return { success: true, result: created };
    }
    if (name === "update_task") {
      const existing = current.tasks.find((item) => item.id === args.id);
      if (!existing) return { success: false, result: null, error: "Task not found" };
      Object.assign(existing, args);
      return { success: true, result: existing };
    }
    if (name === "complete_task") {
      const existing = current.tasks.find((item) => item.id === args.id);
      if (!existing) return { success: false, result: null, error: "Task not found" };
      existing.status = "done";
      return { success: true, result: existing };
    }
    if (name === "delete_task") {
      const idx = current.tasks.findIndex((item) => item.id === args.id);
      if (idx < 0) return { success: false, result: null, error: "Task not found" };
      const [removed] = current.tasks.splice(idx, 1);
      return { success: true, result: removed };
    }
    if (name === "query_schedule") {
      const period = String(args.period ?? "today");
      let tasks = current.tasks.filter((t) => t.status !== "done");
      if (period === "tomorrow") {
        tasks = tasks.filter((t) => t.due_date === "2026-10-23");
      } else if (period === "today") {
        tasks = tasks.filter((t) => t.due_date === "2026-10-22");
      }
      return {
        success: true,
        result: {
          period: {
            kind: period,
            label: period,
            from: "2026-10-22",
            to: "2026-10-28",
          },
          timezone: "Asia/Karachi",
          tasks,
          events: [],
          overdue_tasks: [],
          projects: [],
          completed_omitted: 0,
          estimated_minutes: tasks.length * 30,
        },
      };
    }
    return { success: false, result: null, error: `unexpected ${name}` };
  };
  return { calls, act, board: current };
}

describe("QA English — correctly written novel creates", () => {
  it.each([
    "Kindly jot down renewing my passport by next month",
    "I'd appreciate if you could pencil in water the plants",
    "Slap 'file taxes' onto my backlog",
    "book the dentist",
    "add buy eggs",
  ])("creates from: %s", async (phrase) => {
    const env = harness();
    await runLocalCommand(phrase, emptyContext(), env.board, env.act);
    expect(env.calls.some((c) => c.name === "create_task")).toBe(true);
  });
});

describe("QA English — spelling & typing mistakes", () => {
  it("repairs mrk/dun into a complete on Science lab", async () => {
    expect(normalizeInput("mrk science as dun")).toMatch(/mark science as done/i);
    const env = harness();
    await runLocalCommand("mrk science as dun", emptyContext(), env.board, env.act);
    expect(env.calls.some((c) => c.name === "complete_task")).toBe(true);
    expect(env.calls.find((c) => c.name === "complete_task")?.args.id).toBe(
      "44444444-4444-4444-8444-444444444402"
    );
  });

  it("repairs ad tesk / tommorow into a create", async () => {
    const env = harness();
    await runLocalCommand(
      "ad tesk 'review PR #42' for tommorow",
      emptyContext(),
      env.board,
      env.act
    );
    const create = env.calls.find((c) => c.name === "create_task");
    expect(create).toBeTruthy();
    expect(String(create?.args.title)).toMatch(/review PR #42/i);
  });

  it("repairs delte and asks before deleting", async () => {
    expect(normalizeInput("delte the milk task")).toMatch(/delete the milk task/i);
    const env = harness();
    const ctx = emptyContext();
    const ask = await runLocalCommand("delte the milk task", ctx, env.board, env.act);
    expect(env.calls.some((c) => c.name === "delete_task")).toBe(false);
    expect(ask.message.toLowerCase()).toMatch(/delete/);
    expect(ask.context.pending).toBeTruthy();
    const confirmed = await runLocalCommand("yes", ask.context, env.board, env.act);
    expect(env.calls.some((c) => c.name === "delete_task")).toBe(true);
    expect(confirmed.message.toLowerCase()).toMatch(/deleted|removed/);
  });

  it("does not silently rewrite protected weak→week; asks instead", async () => {
    const decision = resolveInterpretation("pussh standupp to next weak");
    expect(decision.clarification?.toLowerCase()).toMatch(/next week/);
    const env = harness();
    const result = await runLocalCommand(
      "pussh standupp to next weak",
      emptyContext(),
      env.board,
      env.act
    );
    expect(env.calls.some((c) => c.name === "update_task")).toBe(false);
    expect(result.message.toLowerCase()).toMatch(/next week/);
  });

  it("preserves unfamiliar vocabulary in titles", async () => {
    const env = harness();
    await runLocalCommand(
      "Add XanthiumLeaves-Audit for tomorrow",
      emptyContext(),
      env.board,
      env.act
    );
    expect(String(env.calls.find((c) => c.name === "create_task")?.args.title)).toMatch(
      /XanthiumLeaves-Audit/i
    );
  });

  it("does not fuzzy-correct live→give inside task titles", async () => {
    expect(normalizeInput("Add QA live verification task for tomorrow")).toMatch(/live/i);
    expect(normalizeInput("Add QA live verification task for tomorrow")).not.toMatch(/\bgive\b/i);
    const env = harness();
    await runLocalCommand(
      "Add QA live verification task for tomorrow",
      emptyContext(),
      env.board,
      env.act
    );
    expect(String(env.calls.find((c) => c.name === "create_task")?.args.title)).toMatch(
      /live verification/i
    );
  });
});

describe("QA English — slang, informal, missing punctuation", () => {
  it("creates from chuck reminder slang", async () => {
    const env = harness();
    await runLocalCommand(
      "chuck a reminder for vaccine appointment onto friday",
      emptyContext(),
      env.board,
      env.act
    );
    expect(env.calls.some((c) => c.name === "create_task")).toBe(true);
    expect(String(env.calls.find((c) => c.name === "create_task")?.args.title)).toMatch(
      /vaccine/i
    );
  });

  it("creates from yo dump laundry slang with sat abbreviation", async () => {
    const env = harness();
    await runLocalCommand(
      "yo dump laundry on my plate for sat",
      emptyContext(),
      env.board,
      env.act
    );
    const create = env.calls.find((c) => c.name === "create_task");
    expect(create).toBeTruthy();
    expect(create?.args.due_date).toBe("2026-10-24");
  });

  it("queries informal plate phrasing without crashing", async () => {
    const env = harness();
    const result = await runLocalCommand(
      "idk whats on my plate tmrrw",
      emptyContext(),
      env.board,
      env.act
    );
    expect(env.calls.some((c) => c.name === "query_schedule")).toBe(true);
    expect(result.message.length).toBeGreaterThan(0);
  });
});

describe("QA English — questions vs commands, negation, conditionals", () => {
  it("does not create from advice questions", async () => {
    expect(detectStance("Should I add more tasks today?").kind).toBe("suggestion");
    const env = harness();
    await runLocalCommand(
      "Should I add more tasks today?",
      emptyContext(),
      env.board,
      env.act
    );
    expect(env.calls.some((c) => c.name === "create_task")).toBe(false);
  });

  it("does not invent writes from conditionals", async () => {
    const env = harness();
    await runLocalCommand(
      "Unless science is done move milk to friday",
      emptyContext(),
      env.board,
      env.act
    );
    expect(env.calls.length).toBe(0);
  });

  it("does not create on never mind creating", async () => {
    const env = harness();
    await runLocalCommand(
      "Never mind creating a new task for milk",
      emptyContext(),
      env.board,
      env.act
    );
    expect(env.calls.some((c) => c.name === "create_task")).toBe(false);
  });
});

describe("QA English — multi-instruction and incomplete", () => {
  it("handles create + complete compound by acting on primary clause", async () => {
    const env = harness();
    await runLocalCommand(
      "Add buy eggs for tomorrow and mark milk done",
      emptyContext(),
      env.board,
      env.act
    );
    expect(env.calls.length).toBeGreaterThan(0);
    expect(
      env.calls.some((c) => c.name === "create_task") ||
        env.calls.some((c) => c.name === "complete_task")
    ).toBe(true);
  });

  it("asks for a day on incomplete move", async () => {
    const env = harness();
    const result = await runLocalCommand("move science", emptyContext(), env.board, env.act);
    expect(env.calls.some((c) => c.name === "update_task")).toBe(false);
    expect(result.message.toLowerCase()).toMatch(/which day|friday|tomorrow/);
  });
});

describe("QA English — book is not fuzzy-corrected to took", () => {
  it("keeps book and creates a dentist task", async () => {
    expect(normalizeInput("book the dentist").toLowerCase()).toContain("book");
    expect(normalizeInput("book the dentist").toLowerCase()).not.toContain("took");
    expect(rewriteIntent("book the dentist").toLowerCase()).toMatch(/^add /);
    const u = understandInput("book the dentist");
    expect(u.kind === "command" ? u.text : "").toMatch(/^add /i);
  });
});
