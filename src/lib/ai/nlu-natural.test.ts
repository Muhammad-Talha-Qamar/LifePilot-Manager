import { describe, expect, it } from "vitest";
import { interpretUtterance } from "./interpret";
import { rewriteIntent } from "./intent";
import { runLocalCommand } from "./local-agent";
import { understandInput } from "./understand";
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

function board(): Board {
  return {
    tasks: [
      task({
        id: "44444444-4444-4444-8444-444444444401",
        title: "Finish maths homework",
        due_date: "2026-10-22",
      }),
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
        id: "44444444-4444-4444-8444-444444444499",
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
    return { success: false, result: null, error: `unexpected ${name}` };
  };
  return { calls, act, board: current };
}

describe("natural language paraphrases for create", () => {
  const creates = [
    "Add homework for tomorrow.",
    "Remind me to do my homework tomorrow.",
    "I need to do my homework tomorrow. Add it to my tasks.",
    "Put homework on tomorrow's list.",
    "Can you schedule my homework for tomorrow?",
    "schedule my homework for tomorrow",
    "homework tomorrow",
  ];

  it.each(creates)("rewrites create paraphrase: %s", (phrase) => {
    const rewritten = rewriteIntent(phrase).toLowerCase();
    expect(rewritten.startsWith("add ")).toBe(true);
    expect(rewritten).toContain("homework");
    expect(rewritten).toContain("tomorrow");
    expect(rewritten).not.toContain("show my tasks");
  });

  it.each(creates)("executes create paraphrase: %s", async (phrase) => {
    const env = harness();
    const result = await runLocalCommand(phrase, emptyContext(), env.board, env.act);
    expect(env.calls.some((call) => call.name === "create_task")).toBe(true);
    const create = env.calls.find((call) => call.name === "create_task");
    expect(String(create?.args.title).toLowerCase()).toContain("homework");
    expect(create?.args.due_date).toBe("2026-10-23");
    expect(result.message.toLowerCase()).toMatch(/created|already on your list/);
  });
});

describe("conversation follow-ups", () => {
  it("moves the focused task for make it / instead / change it", async () => {
    const env = harness();
    const created = await runLocalCommand(
      "Add homework for tomorrow.",
      emptyContext(),
      env.board,
      env.act
    );
    expect(created.context.focus?.kind).toBe("task");

    for (const phrase of ["Move it to Friday", "make it Friday", "Friday instead", "change it to Friday"]) {
      const before = env.calls.filter((c) => c.name === "update_task").length;
      const result = await runLocalCommand(phrase, created.context, env.board, env.act);
      expect(env.calls.filter((c) => c.name === "update_task").length).toBeGreaterThan(before);
      expect(result.message.toLowerCase()).toMatch(/moved|updated|set/);
      expect(result.message.toLowerCase()).not.toContain("created task");
    }
  });
});

describe("completes and schedule verb disambiguation", () => {
  it("treats finish X as complete", async () => {
    const env = harness();
    const result = await runLocalCommand(
      "finish maths homework",
      emptyContext(),
      env.board,
      env.act
    );
    expect(env.calls.some((c) => c.name === "complete_task")).toBe(true);
    expect(result.message.toLowerCase()).toContain("complete");
  });

  it("does not treat schedule+object as a schedule query", () => {
    const u = understandInput("Can you schedule my homework for tomorrow?");
    expect(u.kind).toBe("command");
    if (u.kind === "command") {
      expect(u.text.toLowerCase()).toContain("add");
      expect(u.text.toLowerCase()).not.toContain("show my tasks");
    }
    const interpreted = interpretUtterance("schedule my homework for tomorrow");
    expect(interpreted.family).toBe("create_task");
  });
});
