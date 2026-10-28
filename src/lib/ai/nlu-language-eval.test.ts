/**
 * Representative language-understanding evaluation for LifePilot.
 * Covers spelling, grammar, slang, paraphrases, questions vs commands,
 * negation, multi-intent, and unfamiliar titles — against the local NLU path
 * (production currently runs without OpenAI).
 */
import { describe, expect, it } from "vitest";
import { interpretUtterance } from "./interpret";
import { rewriteIntent } from "./intent";
import { runLocalCommand } from "./local-agent";
import { normalizeInput } from "./normalize-input";
import { detectStance } from "./stance";
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
    if (name === "query_schedule") {
      const period = String(args.period ?? "today");
      let tasks = current.tasks.filter((t) => t.status !== "done");
      if (period === "tomorrow") {
        tasks = tasks.filter((t) => t.due_date === "2026-10-23");
      } else if (period === "today") {
        tasks = tasks.filter((t) => t.due_date === "2026-10-22");
      } else if (period === "next_7_days" || period === "week") {
        // keep open tasks
      }
      return {
        success: true,
        result: {
          period: { kind: period, label: period, from: "2026-10-22", to: "2026-10-28" },
          tasks,
          events: [],
          overdue_tasks: [],
          estimated_minutes: tasks.length * 30,
        },
      };
    }
    return { success: false, result: null, error: `unexpected ${name}` };
  };
  return { calls, act, board: current };
}

function expectCreate(rewritten: string) {
  expect(rewritten.toLowerCase().startsWith("add ")).toBe(true);
  expect(rewritten.toLowerCase()).not.toContain("show my tasks");
}

function expectQuery(rewritten: string, when?: string) {
  expect(rewritten.toLowerCase()).toMatch(/show my tasks/);
  if (when) expect(rewritten.toLowerCase()).toContain(when);
}

describe("language eval — correctly written creates", () => {
  const phrases = [
    "Add a task called QuantumFlux-Review for tomorrow",
    "Put buying milk on tomorrow's list",
    "Make a note of calling the dentist",
    "Include laundry in my schedule",
    "Add it to my workload",
    "Make sure I don't forget to email tutor",
    "Can you put this down for tomorrow?",
  ];

  it.each(phrases)("create paraphrase: %s", async (phrase) => {
    const stance = detectStance(phrase);
    expect(stance.kind).not.toBe("prohibit");
    expect(stance.kind).not.toBe("lookup_past");
    const u = understandInput(phrase);
    const rewritten =
      u.kind === "command" ? u.text : rewriteIntent(phrase);
    // Explicit "add/create …" may pass through to the local matcher unchanged.
    if (/^(?:add|create)\b/i.test(rewritten)) {
      expectCreate(rewritten.startsWith("add") ? rewritten : `add ${rewritten}`);
    } else {
      expectCreate(rewritten);
    }
    const env = harness();
    await runLocalCommand(phrase, emptyContext(), env.board, env.act);
    expect(env.calls.some((c) => c.name === "create_task")).toBe(true);
  });
});

describe("language eval — spelling & typing mistakes", () => {
  it("repairs homework/tomorrow typos into a create", async () => {
    expect(normalizeInput("Add homewrk for tomorow.")).toMatch(/homework.*tomorrow/i);
    const env = harness();
    await runLocalCommand("Add homewrk for tomorow.", emptyContext(), env.board, env.act);
    expect(env.calls.some((c) => c.name === "create_task")).toBe(true);
  });

  it("repairs show upcoming", () => {
    const n = normalizeInput("shw my upcomming task");
    expect(n.toLowerCase()).toMatch(/show/);
    expect(n.toLowerCase()).toMatch(/upcoming/);
    expectQuery(rewriteIntent("shw my upcomming task"), "next 7 days");
  });

  it("repairs reschedule meeting", () => {
    const n = normalizeInput("reshedul my meting for friday");
    expect(n.toLowerCase()).toMatch(/reschedule/);
    expect(n.toLowerCase()).toMatch(/meeting/);
    expect(rewriteIntent("reshedul my meting for friday").toLowerCase()).toMatch(
      /move .+ to friday|move meeting/
    );
  });

  it("repairs plz / assignment / next week", () => {
    const n = normalizeInput("plz move my assigment to nex week");
    expect(n.toLowerCase()).toMatch(/please/);
    expect(n.toLowerCase()).toMatch(/assignment/);
    expect(n.toLowerCase()).not.toMatch(/homework/);
    expect(n.toLowerCase()).toContain("next week");
  });

  it("understands informal workload glance", () => {
    expectQuery(rewriteIntent("i hav alot of work tomorow"), "tomorrow");
  });
});

describe("language eval — grammar mistakes", () => {
  it("what task i have tomorrow → query tomorrow", () => {
    expect(detectStance("what task i have tomorrow").kind).toBe("query");
    expectQuery(rewriteIntent("what task i have tomorrow"), "tomorrow");
  });
});

describe("language eval — slang & abbreviations", () => {
  it.each([
    ["gonna call mom tomorrow", "add"],
    ["wanna draft the proposal", "add"],
    ["gotta submit the form", "add"],
    ["pls remind me to stretch", "add"],
    ["ASAP: pay rent", "add"],
  ])("%s", (phrase, verb) => {
    const rewritten = rewriteIntent(phrase).toLowerCase();
    expect(rewritten.startsWith(verb)).toBe(true);
  });
});

describe("language eval — questions vs commands vs negation", () => {
  it("does not create on don't add", async () => {
    expect(detectStance("Don't add milk to my list").kind).toBe("prohibit");
    const env = harness();
    const result = await runLocalCommand(
      "Don't add milk to my list",
      emptyContext(),
      env.board,
      env.act
    );
    expect(env.calls.some((c) => c.name === "create_task")).toBe(false);
    expect(result.message.toLowerCase()).toMatch(/won'?t add|got it/);
  });

  it("does not create on don't add homework tomorrow", async () => {
    const env = harness();
    await runLocalCommand("don't add homework tomorrow", emptyContext(), env.board, env.act);
    expect(env.calls.some((c) => c.name === "create_task")).toBe(false);
  });

  it("Did I add milk? looks up instead of creating", async () => {
    expect(detectStance("Did I add milk to my list?").kind).toBe("lookup_past");
    const env = harness();
    const result = await runLocalCommand(
      "Did I add milk to my list?",
      emptyContext(),
      env.board,
      env.act
    );
    expect(env.calls.some((c) => c.name === "create_task")).toBe(false);
    expect(result.message.toLowerCase()).toMatch(/milk|list|found|yes/);
  });

  it("explicit add still creates", async () => {
    const env = harness();
    await runLocalCommand(
      "Add buying milk to tomorrow's list",
      emptyContext(),
      env.board,
      env.act
    );
    expect(env.calls.some((c) => c.name === "create_task")).toBe(true);
  });
});

describe("language eval — finish vs create collision", () => {
  it("gotta finish existing homework → complete", async () => {
    expect(detectStance("I gotta finish my homewrk tomorow.").kind).toBe(
      "complete_focus"
    );
    const env = harness();
    await runLocalCommand(
      "I gotta finish maths homework",
      emptyContext(),
      env.board,
      env.act
    );
    expect(env.calls.some((c) => c.name === "complete_task")).toBe(true);
    expect(env.calls.some((c) => c.name === "create_task")).toBe(false);
  });

  it("need to finish essay by Friday stays a create", () => {
    expect(rewriteIntent("I need to finish the essay by Friday").toLowerCase()).toMatch(
      /^add /
    );
  });
});

describe("language eval — incomplete & conditional", () => {
  it("shift science asks for a day", async () => {
    const env = harness();
    const result = await runLocalCommand("shift science", emptyContext(), env.board, env.act);
    expect(env.calls.some((c) => c.name === "update_task")).toBe(false);
    expect(result.message.toLowerCase()).toMatch(/which day|friday|tomorrow/);
  });

  it("conditional does not invent writes", async () => {
    expect(detectStance("if I finish science move it to friday").kind).toBe(
      "conditional"
    );
    const env = harness();
    const result = await runLocalCommand(
      "if I finish science move it to friday",
      emptyContext(),
      env.board,
      env.act
    );
    expect(env.calls.length).toBe(0);
    expect(result.message.toLowerCase()).toMatch(/if\/then|right now|move science/);
  });
});

describe("language eval — multi-clause & unfamiliar titles", () => {
  it("uses actionable clause in compound create", () => {
    const rewritten = rewriteIntent(
      "I need to do my homework tomorrow. Add it to my tasks."
    ).toLowerCase();
    expect(rewritten.startsWith("add ")).toBe(true);
    expect(rewritten).toContain("homework");
  });

  it("preserves unfamiliar task names", async () => {
    const env = harness();
    await runLocalCommand(
      "Add QuantumFlux-Review for tomorrow",
      emptyContext(),
      env.board,
      env.act
    );
    const create = env.calls.find((c) => c.name === "create_task");
    expect(String(create?.args.title)).toMatch(/QuantumFlux-Review/i);
  });

  it("phrasebook does not force create on prohibition", () => {
    const interpreted = interpretUtterance("don't add homework tomorrow");
    expect(interpreted.canonical == null || !/^add\b/i.test(interpreted.canonical)).toBe(
      true
    );
  });
});

describe("language eval — stance regression matrix", () => {
  const rows: Array<[string, string]> = [
    ["Add homework for tomorrow.", "command"],
    ["don't add homework tomorrow", "prohibit"],
    ["Did I add milk to my list?", "lookup_past"],
    ["what task i have tomorrow", "query"],
    ["I gotta finish maths homework", "complete_focus"],
    ["if I finish science move it to friday", "conditional"],
    ["I might do homework tomorrow.", "suggestion"],
    ["Make sure I don't forget to call mom", "unknown"],
  ];

  it.each(rows)("%s → %s", (phrase, kind) => {
    expect(detectStance(phrase).kind).toBe(kind);
  });
});
