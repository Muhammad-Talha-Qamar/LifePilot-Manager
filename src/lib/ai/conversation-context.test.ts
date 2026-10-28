import { describe, expect, it } from "vitest";
import {
  expandBareCorrection,
  expandEllipticalCreate,
  looksLikeEntityAnswer,
  otherDiscussedTaskId,
  recordCreateTurn,
  shortenTitle,
  trimMessagesForModel,
  verifyTaskId,
} from "./conversation-context";
import { runLocalCommand } from "./local-agent";
import type { ToolHandler } from "./local-agent";
import type { Project, Task } from "@/types";
import { emptyContext, type Board, type ConversationContext } from "./types";

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

function project(partial: Partial<Project> & Pick<Project, "id" | "name">): Project {
  return {
    user_id: "user",
    description: null,
    status: "active",
    priority: "medium",
    start_date: null,
    deadline: null,
    is_archived: false,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    ...partial,
  };
}

function board(overrides: Partial<Board> = {}): Board {
  return {
    tasks: [],
    projects: [],
    checklists: [],
    events: [],
    timezone: "Asia/Karachi",
    weekStartsOn: 1,
    now,
    defaultDuration: 45,
    workStart: "09:00",
    workEnd: "17:00",
    ...overrides,
  };
}

function harness(initial = board()) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  let idSeq = 900;
  const current = initial;
  const act: ToolHandler = async (name, args) => {
    calls.push({ name, args });
    if (name === "create_task") {
      const created = task({
        id: `44444444-4444-4444-8444-444444444${idSeq++}`,
        title: String(args.title),
        due_date: (args.due_date as string | null) ?? null,
        priority: (args.priority as Task["priority"]) ?? "medium",
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
    return { success: false, result: null, error: `unexpected ${name}` };
  };
  return { calls, act, board: current };
}

describe("conversation-context helpers", () => {
  it("expands elliptical creates from last turn", () => {
    const context = emptyContext();
    recordCreateTurn(context, "Science assignment", "2026-10-23");
    expect(expandEllipticalCreate("And English for Friday.", context)).toMatch(
      /add English assignment for Friday/i
    );
  });

  it("expands bare corrections", () => {
    expect(expandBareCorrection("Actually, Friday.")).toBe("i meant Friday");
    expect(expandBareCorrection("Actually, make it next Monday.")).toMatch(/i meant next Monday/i);
  });

  it("detects entity answers vs new commands", () => {
    expect(looksLikeEntityAnswer("The science assignment.")).toBe(true);
    expect(looksLikeEntityAnswer("add milk for tomorrow")).toBe(false);
  });

  it("shortens titles without inventing content", () => {
    expect(shortenTitle("Finish maths homework for school")).toMatch(/maths homework/i);
  });

  it("trims model history", () => {
    const messages = Array.from({ length: 20 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `m${i}`,
    }));
    expect(trimMessagesForModel(messages, 6)).toHaveLength(6);
  });

  it("refuses unknown task ids", () => {
    const result = verifyTaskId("missing", board());
    expect(result.ok).toBe(false);
  });

  it("picks the other discussed task", () => {
    const context: ConversationContext = {
      ...emptyContext(),
      focus: {
        kind: "task",
        id: "a",
        label: "Science",
      },
      lastTasks: [
        { id: "a", title: "Science" },
        { id: "b", title: "English" },
      ],
    };
    expect(otherDiscussedTaskId(context)).toBe("b");
  });
});

describe("multi-turn conversation context", () => {
  it("creates then elliptical-adds English without duplicating science", async () => {
    const env = harness();
    const first = await runLocalCommand(
      "Add my science assignment for tomorrow.",
      emptyContext(),
      env.board,
      env.act
    );
    expect(env.calls.filter((c) => c.name === "create_task")).toHaveLength(1);
    expect(first.context.lastTurn?.action).toBe("create_task");
    expect(first.context.focus?.kind).toBe("task");

    const second = await runLocalCommand(
      "And English for Friday.",
      first.context,
      env.board,
      env.act
    );
    const creates = env.calls.filter((c) => c.name === "create_task");
    expect(creates).toHaveLength(2);
    expect(String(creates[1].args.title).toLowerCase()).toMatch(/english/);
    expect(String(creates[1].args.title).toLowerCase()).toMatch(/assignment/);
    expect(creates[1].args.due_date).toBe("2026-10-23"); // Friday (board now = Thu 22 Oct 2026)
    expect(second.message.toLowerCase()).toMatch(/created|english/);
    expect(env.board.tasks.filter((t) => /science/i.test(t.title))).toHaveLength(1);
  });

  it("corrects date on focused task instead of creating a duplicate", async () => {
    const env = harness();
    const created = await runLocalCommand(
      "Schedule homework for Thursday.",
      emptyContext(),
      env.board,
      env.act
    );
    const beforeCount = env.board.tasks.length;
    const corrected = await runLocalCommand("Actually, Friday.", created.context, env.board, env.act);
    expect(env.board.tasks).toHaveLength(beforeCount);
    expect(env.calls.some((c) => c.name === "update_task")).toBe(true);
    expect(corrected.message.toLowerCase()).toMatch(/updated|moved|friday|2026-10-23/);
    expect(corrected.message.toLowerCase()).not.toContain("created task");
    expect(env.board.tasks[0].due_date).toBe("2026-10-23");
  });

  it("handles actually make it next Monday", async () => {
    const env = harness();
    const created = await runLocalCommand(
      "Add essay for tomorrow.",
      emptyContext(),
      env.board,
      env.act
    );
    const moved = await runLocalCommand(
      "Actually, make it next Monday.",
      created.context,
      env.board,
      env.act
    );
    expect(env.calls.filter((c) => c.name === "create_task")).toHaveLength(1);
    expect(env.calls.some((c) => c.name === "update_task")).toBe(true);
    expect(moved.message.toLowerCase()).toMatch(/updated|monday|2026-10-26/);
  });

  it("moves focused task with pronouns", async () => {
    const env = harness();
    const created = await runLocalCommand("Add quiz for tomorrow.", emptyContext(), env.board, env.act);
    const moved = await runLocalCommand("Move it to Friday.", created.context, env.board, env.act);
    expect(moved.message.toLowerCase()).toMatch(/moved|updated/);
    expect(env.board.tasks[0].due_date).toBe("2026-10-23");
  });

  it("raises priority on the second discussed task", async () => {
    const science = task({
      id: "44444444-4444-4444-8444-444444444401",
      title: "Science assignment",
      due_date: "2026-10-23",
    });
    const english = task({
      id: "44444444-4444-4444-8444-444444444402",
      title: "English assignment",
      due_date: "2026-10-24",
    });
    const env = harness(board({ tasks: [science, english] }));
    const context: ConversationContext = {
      ...emptyContext(),
      lastTasks: [
        { id: science.id, title: science.title },
        { id: english.id, title: english.title },
      ],
      focus: { kind: "task", id: science.id, label: science.title, detail: science.due_date },
    };
    const result = await runLocalCommand(
      "Make the second task more urgent.",
      context,
      env.board,
      env.act
    );
    expect(env.calls.some((c) => c.name === "update_task" && c.args.id === english.id)).toBe(true);
    expect(english.priority).toBe("urgent");
    expect(result.message.toLowerCase()).toMatch(/urgent|english/);
  });

  it("asks which task when several could match, then finishes after clarification", async () => {
    const a = task({
      id: "44444444-4444-4444-8444-444444444401",
      title: "Science assignment",
      due_date: "2026-10-23",
    });
    const b = task({
      id: "44444444-4444-4444-8444-444444444402",
      title: "History assignment",
      due_date: "2026-10-23",
    });
    const env = harness(board({ tasks: [a, b] }));
    const context: ConversationContext = {
      ...emptyContext(),
      lastTasks: [
        { id: a.id, title: a.title },
        { id: b.id, title: b.title },
      ],
      // No single focus — pronoun must ask.
      focus: null,
    };
    const asked = await runLocalCommand("Move it to Friday.", context, env.board, env.act);
    expect(env.calls.filter((c) => c.name === "update_task")).toHaveLength(0);
    expect(asked.message.toLowerCase()).toMatch(/which/);
    expect(asked.context.pendingRequest?.kind).toBe("reschedule");
    expect(asked.context.pendingRequest?.when?.toLowerCase()).toMatch(/friday/);

    const done = await runLocalCommand(
      "The science assignment.",
      asked.context,
      env.board,
      env.act
    );
    expect(env.calls.some((c) => c.name === "update_task" && c.args.id === a.id)).toBe(true);
    expect(a.due_date).toBe("2026-10-23");
    expect(b.due_date).toBe("2026-10-23");
    expect(done.message.toLowerCase()).toMatch(/moved|science|updated/);
    expect(done.context.pendingRequest == null).toBe(true);
  });

  it("deletes the just-created focused task after confirm", async () => {
    const env = harness();
    const created = await runLocalCommand(
      "Add temporary note for tomorrow.",
      emptyContext(),
      env.board,
      env.act
    );
    const asked = await runLocalCommand(
      "Delete the task we just created.",
      created.context,
      env.board,
      env.act
    );
    expect(asked.context.pending?.tool).toBe("delete_task");
    expect(env.calls.some((c) => c.name === "delete_task")).toBe(false);
    const confirmed = await runLocalCommand("yes", asked.context, env.board, env.act);
    expect(env.calls.some((c) => c.name === "delete_task")).toBe(true);
    expect(confirmed.message.toLowerCase()).toMatch(/deleted|removed/);
  });

  it("surfaces the other assignment from lastTasks", async () => {
    const science = task({
      id: "44444444-4444-4444-8444-444444444401",
      title: "Science assignment",
      due_date: "2026-10-23",
    });
    const english = task({
      id: "44444444-4444-4444-8444-444444444402",
      title: "English assignment",
      due_date: "2026-10-24",
    });
    const env = harness(board({ tasks: [science, english] }));
    const context: ConversationContext = {
      ...emptyContext(),
      focus: { kind: "task", id: science.id, label: science.title, detail: science.due_date },
      lastTasks: [
        { id: science.id, title: science.title },
        { id: english.id, title: english.title },
      ],
    };
    const result = await runLocalCommand(
      "What about the other assignment?",
      context,
      env.board,
      env.act
    );
    expect(result.message.toLowerCase()).toMatch(/english/);
    expect(result.context.focus?.id).toBe(english.id);
    expect(env.calls.filter((c) => c.name === "create_task")).toHaveLength(0);
  });

  it("shortens the focused task title", async () => {
    const long = task({
      id: "44444444-4444-4444-8444-444444444401",
      title: "Finish maths homework for school",
      due_date: "2026-10-23",
    });
    const env = harness(board({ tasks: [long] }));
    const context: ConversationContext = {
      ...emptyContext(),
      focus: { kind: "task", id: long.id, label: long.title, detail: long.due_date },
      lastTasks: [{ id: long.id, title: long.title }],
    };
    const result = await runLocalCommand("Make it shorter.", context, env.board, env.act);
    expect(env.calls.some((c) => c.name === "update_task")).toBe(true);
    expect(long.title.toLowerCase()).not.toContain("finish");
    expect(result.message.toLowerCase()).toMatch(/shorten|updated|maths/);
  });

  it("replays last update onto the other discussed task", async () => {
    const science = task({
      id: "44444444-4444-4444-8444-444444444401",
      title: "Science assignment",
      due_date: "2026-10-22",
    });
    const english = task({
      id: "44444444-4444-4444-8444-444444444402",
      title: "English assignment",
      due_date: "2026-10-22",
    });
    const env = harness(board({ tasks: [science, english] }));
    let context: ConversationContext = {
      ...emptyContext(),
      focus: { kind: "task", id: science.id, label: science.title, detail: science.due_date },
      lastTasks: [
        { id: science.id, title: science.title },
        { id: english.id, title: english.title },
      ],
    };
    const moved = await runLocalCommand("Move it to Friday.", context, env.board, env.act);
    context = moved.context;
    expect(science.due_date).toBe("2026-10-23");

    const same = await runLocalCommand(
      "Do the same for my other project.",
      context,
      env.board,
      env.act
    );
    expect(env.calls.filter((c) => c.name === "update_task").length).toBeGreaterThanOrEqual(2);
    expect(english.due_date).toBe("2026-10-23");
    expect(same.message.toLowerCase()).toMatch(/english|same|updated|moved/);
  });

  it("does not mutate when the focused id is missing from the board", async () => {
    const env = harness();
    const context: ConversationContext = {
      ...emptyContext(),
      focus: {
        kind: "task",
        id: "44444444-4444-4444-8444-000000000099",
        label: "Ghost",
        detail: "2026-10-23",
      },
    };
    const result = await runLocalCommand("Move it to Friday.", context, env.board, env.act);
    expect(env.calls.filter((c) => c.name === "update_task")).toHaveLength(0);
    expect(result.message.toLowerCase()).toMatch(/couldn.?t|verify|which|unchanged|mean/);
  });

  it("shows focused project again without inventing tasks", async () => {
    const proj = project({
      id: "55555555-5555-5555-8555-555555555501",
      name: "Capstone",
      deadline: "2026-11-01",
    });
    const env = harness(board({ projects: [proj] }));
    const context: ConversationContext = {
      ...emptyContext(),
      lastProject: { id: proj.id, name: proj.name },
      focus: { kind: "project", id: proj.id, label: proj.name, detail: proj.deadline },
    };
    const result = await runLocalCommand(
      "Show me that project again.",
      context,
      env.board,
      env.act
    );
    expect(result.message.toLowerCase()).toMatch(/capstone/);
    expect(env.calls.filter((c) => c.name === "create_task")).toHaveLength(0);
  });
});
