import { describe, expect, it } from "vitest";
import type { Task } from "@/types";
import { runLocalCommand, type ToolHandler } from "./local-agent";
import { buildScheduleResult } from "./schedule";
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

function board(overrides: Partial<Board> = {}): Board {
  return {
    tasks: [
      task({
        id: "44444444-4444-4444-8444-444444444401",
        title: "Finish maths homework",
        due_date: "2026-10-22",
        priority: "high",
      }),
      task({
        id: "44444444-4444-4444-8444-444444444403",
        title: "Submit science lab report",
        due_date: "2026-10-21",
        priority: "urgent",
      }),
      task({
        id: "44444444-4444-4444-8444-444444444410",
        title: "Read for fun",
        due_date: null,
      }),
      task({
        id: "44444444-4444-4444-8444-444444444411",
        title: "Already finished worksheet",
        due_date: "2026-10-22",
        status: "done",
      }),
      task({
        id: "44444444-4444-4444-8444-444444444421",
        title: "Essay draft",
      }),
      task({
        id: "44444444-4444-4444-8444-444444444422",
        title: "Essay outline",
      }),
    ],
    projects: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        user_id: "user",
        name: "History Research Project",
        description: null,
        status: "active",
        priority: "high",
        start_date: "2026-10-01",
        deadline: "2026-11-02",
        is_archived: false,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      },
    ],
    checklists: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        user_id: "user",
        title: "Science exam prep",
        description: null,
        category: "Exams",
        project_id: null,
        is_template: false,
        is_archived: false,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
        items: [
          {
            id: "55555555-5555-4555-8555-555555555501",
            checklist_id: "22222222-2222-4222-8222-222222222222",
            user_id: "user",
            title: "Review chapter notes",
            is_completed: false,
            due_date: null,
            position: 0,
            completed_at: null,
            created_at: now.toISOString(),
            updated_at: now.toISOString(),
          },
          {
            id: "55555555-5555-4555-8555-555555555502",
            checklist_id: "22222222-2222-4222-8222-222222222222",
            user_id: "user",
            title: "Practice past paper",
            is_completed: false,
            due_date: null,
            position: 1,
            completed_at: null,
            created_at: now.toISOString(),
            updated_at: now.toISOString(),
          },
          {
            id: "55555555-5555-4555-8555-555555555503",
            checklist_id: "22222222-2222-4222-8222-222222222222",
            user_id: "user",
            title: "Memorize formulas",
            is_completed: false,
            due_date: null,
            position: 2,
            completed_at: null,
            created_at: now.toISOString(),
            updated_at: now.toISOString(),
          },
        ],
      },
    ],
    events: [
      {
        id: "66666666-6666-4666-8666-666666666601",
        user_id: "user",
        title: "Science exam",
        description: null,
        location: "Room 204",
        event_type: "exam",
        start_at: "2026-10-23T05:00:00.000Z",
        end_at: "2026-10-23T06:30:00.000Z",
        all_day: false,
        project_id: null,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      },
    ],
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
  const current = initial;
  const act: ToolHandler = async (name, args) => {
    calls.push({ name, args });
    if (name === "query_schedule") {
      const period = String(args.period);
      const tasks =
        period === "today"
          ? current.tasks.filter((item) => item.due_date === "2026-10-22" && item.status !== "done")
          : period === "tomorrow"
            ? current.tasks.filter((item) => item.due_date === "2026-10-23" && item.status !== "done")
            : period === "next_month"
              ? current.tasks.filter((item) => item.due_date?.startsWith("2026-11") && item.status !== "done")
              : period === "overdue"
                ? current.tasks.filter((item) => item.due_date === "2026-10-21" && item.status !== "done")
                : [];
      return {
        success: true,
        result: {
          period: {
            kind: period,
            label: period === "next_month" ? "November 2026" : period,
            from: period === "next_month" ? "2026-11-01" : null,
            to: period === "next_month" ? "2026-11-30" : null,
          },
          timezone: "Asia/Karachi",
          tasks,
          overdue_tasks:
            period === "today"
              ? current.tasks.filter((item) => item.due_date === "2026-10-21")
              : [],
          events: period === "tomorrow" ? current.events : [],
          projects: period === "next_month" ? current.projects : [],
          completed_omitted: period === "today" ? 1 : 0,
          estimated_minutes: tasks.length * 30,
        },
      };
    }
    if (name === "create_task") {
      const created = task({
        id: "44444444-4444-4444-8444-444444444499",
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
      const updated = { ...existing, ...args, id: existing.id };
      Object.assign(existing, updated);
      return { success: true, result: existing };
    }
    if (name === "create_project") {
      const project = {
        id: "11111111-1111-4111-8111-111111111199",
        user_id: "user",
        name: String(args.name),
        description: null,
        status: "active" as const,
        priority: "medium" as const,
        start_date: null,
        deadline: null,
        is_archived: false,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      };
      current.projects.unshift(project);
      return { success: true, result: project };
    }
    if (name === "create_checklist") {
      const checklist = {
        id: "22222222-2222-4222-8222-222222222299",
        user_id: "user",
        title: String(args.title),
        description: null,
        category: null,
        project_id: (args.project_id as string | null) ?? null,
        is_template: false,
        is_archived: false,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
        items: [],
      };
      current.checklists.unshift(checklist);
      return { success: true, result: { checklist, items: [] } };
    }
    if (name === "add_checklist_items") {
      const checklist = current.checklists.find((item) => item.id === args.checklist_id);
      if (!checklist) return { success: false, result: null, error: "Checklist not found" };
      const titles = args.titles as string[];
      const items = titles.map((title, index) => ({
        id: `55555555-5555-4555-8555-5555555555${index}${index}`,
        checklist_id: checklist.id,
        user_id: "user",
        title,
        is_completed: false,
        due_date: null,
        position: checklist.items.length + index,
        completed_at: null,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      }));
      checklist.items.push(...items);
      return { success: true, result: { checklist, items, all_items: checklist.items } };
    }
    if (name === "complete_checklist_items") {
      const checklist = current.checklists.find((item) => item.id === args.checklist_id);
      if (!checklist) return { success: false, result: null, error: "Checklist not found" };
      const ids = args.item_ids as string[];
      checklist.items = checklist.items.map((item) =>
        ids.includes(item.id) ? { ...item, is_completed: true } : item
      );
      return { success: true, result: { checklist, items: checklist.items, completed: checklist.items.filter((item) => ids.includes(item.id)) } };
    }
    if (name === "update_project") {
      const project = current.projects.find((item) => item.id === args.id);
      if (!project) return { success: false, result: null, error: "Project not found" };
      Object.assign(project, args);
      return { success: true, result: project };
    }
    if (name === "complete_task") {
      const existing = current.tasks.find((item) => item.id === args.id);
      if (!existing) return { success: false, result: null, error: "Task not found" };
      existing.status = "done";
      return { success: true, result: existing };
    }
    if (name === "delete_task") {
      return { success: false, result: null, error: "database rejected the delete" };
    }
    if (name === "move_tasks_to_project") {
      const ids = args.task_ids as string[];
      const project = current.projects.find((item) => item.id === args.project_id);
      if (!project) return { success: false, result: null, error: "Project not found" };
      const updated = current.tasks
        .filter((item) => ids.includes(item.id))
        .map((item) => {
          item.project_id = project.id;
          return item;
        });
      return { success: true, result: { updated, project, failed: [] } };
    }
    if (name === "create_event") {
      return {
        success: true,
        result: {
          id: "66666666-6666-4666-8666-666666666699",
          user_id: "user",
          title: String(args.title),
          description: null,
          location: null,
          event_type: args.event_type,
          start_at: String(args.start_at),
          end_at: String(args.end_at),
          all_day: Boolean(args.all_day),
          project_id: null,
          created_at: now.toISOString(),
          updated_at: now.toISOString(),
        },
      };
    }
    return { success: false, result: null, error: `unexpected tool ${name}` };
  };
  return { calls, act, board: current };
}

describe("schedule windows", () => {
  it("lists a task due earlier this week as overdue only", () => {
    const result = buildScheduleResult({
      tasks: board().tasks,
      events: [],
      projects: [],
      kind: "this_week",
      timezone: "Asia/Karachi",
      weekStartsOn: 1,
      now,
      defaultDuration: 45,
    });
    expect(result.tasks.map((task) => task.title)).toEqual(["Finish maths homework"]);
    expect(result.overdue_tasks.map((task) => task.title)).toEqual(["Submit science lab report"]);
    expect(result.completed_omitted).toBe(1);
  });
});

describe("local assistant commands", () => {
  it("retrieves today's unfinished tasks without inventing others", async () => {
    const { act, calls } = harness();
    const result = await runLocalCommand("What do I need to do today?", emptyContext(), board(), act);
    expect(calls[0]).toMatchObject({ name: "query_schedule", args: { period: "today" } });
    expect(result.message).toContain("Finish maths homework");
    expect(result.message).not.toContain("Read for fun");
    expect(result.message).not.toContain("Already finished worksheet");
    expect(result.message).toContain("Submit science lab report");
    expect(result.blocks.some((block) => block.type === "tasks")).toBe(true);
  });

  it("retrieves tomorrow separately from events", async () => {
    const { act } = harness();
    const result = await runLocalCommand("Show me my tasks for tomorrow.", emptyContext(), board(), act);
    expect(result.message.toLowerCase()).toMatch(/nothing open|no open/);
    expect(result.message).toContain("Science exam");
  });

  it("retrieves next calendar month", async () => {
    const { act, calls } = harness();
    const result = await runLocalCommand("What do I need to finish next month?", emptyContext(), board(), act);
    expect(calls[0].args).toMatchObject({ period: "next_month" });
    expect(result.message).toContain("History Research Project");
    expect(result.message).toContain("November");
  });

  it("creates a task and corrects the date without a duplicate", async () => {
    const env = harness();
    const created = await runLocalCommand("Add maths homework for tomorrow.", emptyContext(), env.board, env.act);
    expect(created.message).toContain("Created task “maths homework”");
    expect(created.message).toContain("Oct 23");
    expect(env.calls.filter((call) => call.name === "create_task")).toHaveLength(1);

    const corrected = await runLocalCommand(
      "No, I meant next Friday.",
      created.context,
      env.board,
      env.act
    );
    expect(env.calls.filter((call) => call.name === "create_task")).toHaveLength(1);
    expect(env.calls.some((call) => call.name === "update_task" && call.args.due_date === "2026-10-30")).toBe(true);
    expect(corrected.message).toContain("did not create a duplicate");
  });

  it("follows project, checklist, and item references", async () => {
    const env = harness();
    let context: ConversationContext = emptyContext();
    const project = await runLocalCommand("Create a project for my science exam.", context, env.board, env.act);
    context = project.context;
    expect(project.message).toContain("Science Exam");

    const checklist = await runLocalCommand("Add a checklist to it.", context, env.board, env.act);
    context = checklist.context;
    expect(env.calls.at(-1)?.args.project_id).toBe("11111111-1111-4111-8111-111111111199");

    const items = await runLocalCommand("Add revising chapters 1 to 5.", context, env.board, env.act);
    context = items.context;
    const added = env.calls.at(-1);
    expect(added?.name).toBe("add_checklist_items");
    expect(added?.args.titles).toEqual([
      "Revise chapter 1",
      "Revise chapter 2",
      "Revise chapter 3",
      "Revise chapter 4",
      "Revise chapter 5",
    ]);

    const done = await runLocalCommand("Mark the first two as done.", context, env.board, env.act);
    expect(done.message).toContain("Revise chapter 1");
    expect(done.message).toContain("Revise chapter 2");
    const ids = env.calls.at(-1)?.args.item_ids as string[];
    expect(ids).toHaveLength(2);
  });

  it("asks when a task reference is ambiguous and does not write", async () => {
    const env = harness();
    const result = await runLocalCommand("Mark the essay as complete.", emptyContext(), env.board, env.act);
    expect(result.message).toContain("more than one");
    expect(env.calls).toHaveLength(0);
  });

  it("does not report a failed write as successful", async () => {
    const env = harness();
    const result = await runLocalCommand(
      "Delete the duplicate task",
      emptyContext(),
      env.board,
      env.act
    );
    expect(result.blocks.some((block) => block.type === "confirm")).toBe(false);
    expect(result.message.toLowerCase()).not.toContain("deleted");
  });

  it("reports a rejected delete after confirmation", async () => {
    const env = harness();
    const asked = await runLocalCommand(
      "Delete Finish maths homework",
      emptyContext(),
      env.board,
      env.act
    );
    expect(asked.blocks.some((block) => block.type === "confirm")).toBe(true);
    const confirmed = await runLocalCommand("yes", asked.context, env.board, env.act);
    expect(confirmed.message.toLowerCase()).toContain("couldn't");
    expect(confirmed.message.toLowerCase()).not.toContain("removed");
  });

  it("moves science tasks into the project just discussed", async () => {
    const env = harness();
    const created = await runLocalCommand(
      "Create a project called Science Exam Preparation.",
      emptyContext(),
      env.board,
      env.act
    );
    const moved = await runLocalCommand(
      "Move all my science revision tasks into that project.",
      created.context,
      env.board,
      env.act
    );
    expect(moved.message).toContain("Submit science lab report");
    expect(env.calls.at(-1)?.args.task_ids).toEqual(["44444444-4444-4444-8444-444444444403"]);
    expect(moved.message).not.toContain("Finish maths homework");
  });

  it("saves a timed meeting without claiming it when the time is ambiguous", async () => {
    const env = harness();
    const missingMeridiem = await runLocalCommand(
      "Schedule a meeting called History review on Friday at 3",
      emptyContext(),
      env.board,
      env.act
    );
    expect(missingMeridiem.message).toContain("morning or afternoon");
    expect(env.calls.some((call) => call.name === "create_event")).toBe(false);

    const saved = await runLocalCommand(
      "Schedule a meeting called History review on Friday at 3pm",
      emptyContext(),
      env.board,
      env.act
    );
    expect(saved.message).toContain("History review");
    expect(saved.message).toContain("15:00");
    const args = env.calls.at(-1)?.args;
    expect(args?.all_day).toBe(false);
    expect(args?.event_type).toBe("meeting");
    expect(String(args?.start_at)).toContain("2026-10-23");
  });

  it("moves a project deadline to next Monday", async () => {
    const env = harness();
    const result = await runLocalCommand(
      "Change the deadline of my history project to next Monday.",
      emptyContext(),
      env.board,
      env.act
    );
    expect(env.calls.at(-1)).toMatchObject({
      name: "update_project",
      args: { deadline: "2026-10-26" },
    });
    expect(result.message).toContain("History Research Project");
    expect(result.message).toContain("Oct 26");
  });
});
