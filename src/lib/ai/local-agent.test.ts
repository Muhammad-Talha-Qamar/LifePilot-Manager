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
            : period === "this_week" || period === "next_7_days"
              ? current.tasks.filter(
                  (item) =>
                    item.status !== "done" &&
                    item.due_date &&
                    item.due_date >= "2026-10-20" &&
                    item.due_date <= "2026-10-26"
                )
              : period === "next_week"
                ? current.tasks.filter(
                    (item) =>
                      item.status !== "done" &&
                      item.due_date &&
                      item.due_date >= "2026-10-27" &&
                      item.due_date <= "2026-11-02"
                  )
                : period === "this_month" || period === "next_month"
                  ? current.tasks.filter((item) =>
                      period === "next_month"
                        ? item.due_date?.startsWith("2026-11") && item.status !== "done"
                        : item.due_date?.startsWith("2026-10") && item.status !== "done"
                    )
                  : period === "overdue"
                    ? current.tasks.filter(
                        (item) => item.due_date === "2026-10-21" && item.status !== "done"
                      )
                    : [];
      return {
        success: true,
        result: {
          period: {
            kind: period,
            label:
              period === "next_month"
                ? "November 2026"
                : period === "this_week"
                  ? "This week"
                  : period === "next_7_days"
                    ? "The next 7 days"
                    : period,
            from:
              period === "next_month"
                ? "2026-11-01"
                : period === "today"
                  ? "2026-10-22"
                  : period === "tomorrow"
                    ? "2026-10-23"
                    : period === "this_week" || period === "next_7_days"
                      ? "2026-10-20"
                      : null,
            to:
              period === "next_month"
                ? "2026-11-30"
                : period === "today"
                  ? "2026-10-22"
                  : period === "tomorrow"
                    ? "2026-10-23"
                    : period === "this_week" || period === "next_7_days"
                      ? "2026-10-26"
                      : null,
          },
          timezone: "Asia/Karachi",
          tasks,
          overdue_tasks:
            period === "today" || period === "this_week"
              ? current.tasks.filter((item) => item.due_date === "2026-10-21" && item.status !== "done")
              : [],
          events:
            period === "tomorrow" || period === "today" || period === "this_week"
              ? current.events.filter((event) =>
                  period === "tomorrow"
                    ? event.start_at.startsWith("2026-10-23")
                    : period === "today"
                      ? event.start_at.startsWith("2026-10-22")
                      : true
                )
              : [],
          projects: period === "next_month" || period === "this_week" ? current.projects : [],
          completed_omitted: period === "today" ? 1 : 0,
          estimated_minutes: tasks.length * 30,
        },
      };
    }
    if (name === "create_event") {
      return {
        success: true,
        result: {
          id: "66666666-6666-4666-8666-666666666699",
          title: String(args.title),
          start_at: args.start_at,
          end_at: args.end_at,
          all_day: false,
          event_type: "event",
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
        deadline: (args.deadline as string | null) ?? null,
        is_archived: false,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      };
      current.projects.unshift(project);
      return { success: true, result: project };
    }
    if (name === "create_checklist") {
      const seedItems = Array.isArray(args.items)
        ? (args.items as { title: string }[]).map((item, index) => ({
            id: `55555555-5555-4555-8555-5555555599${index}`,
            checklist_id: "22222222-2222-4222-8222-222222222299",
            user_id: "user",
            title: item.title,
            is_completed: false,
            due_date: null,
            position: index,
            completed_at: null,
            created_at: now.toISOString(),
            updated_at: now.toISOString(),
          }))
        : [];
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
        items: seedItems,
      };
      current.checklists.unshift(checklist);
      return { success: true, result: { checklist, items: seedItems } };
    }
    if (name === "list_checklists") {
      return { success: true, result: current.checklists };
    }
    if (name === "delete_checklist") {
      current.checklists = current.checklists.filter((item) => item.id !== args.id);
      return { success: true, result: { deleted: true, id: args.id } };
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
    expect(result.message).toContain("November");
    expect(result.message.toLowerCase()).not.toContain("project");
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

  it("follows checklist and item references", async () => {
    const env = harness();
    let context: ConversationContext = emptyContext();
    const checklist = await runLocalCommand(
      "Create a checklist called Science Exam.",
      context,
      env.board,
      env.act
    );
    context = checklist.context;
    expect(checklist.message).toContain("Science Exam");

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

  it("creates a project by name", async () => {
    const env = harness();
    const result = await runLocalCommand(
      "Create a project called Science Exam Preparation.",
      emptyContext(),
      env.board,
      env.act
    );
    expect(result.message).toMatch(/Created project “Science Exam Preparation”/i);
    expect(env.calls.some((call) => call.name === "create_project")).toBe(true);
    expect(result.context.focus?.kind).toBe("project");
  });

  it("handles multi-part project + tasks + schedule", async () => {
    const env = harness();
    const result = await runLocalCommand(
      "Create a science project, add research and poster design tasks, and schedule the research for Friday.",
      emptyContext(),
      env.board,
      env.act
    );
    expect(env.calls.some((call) => call.name === "create_project")).toBe(true);
    const creates = env.calls.filter((call) => call.name === "create_task");
    expect(creates.length).toBeGreaterThanOrEqual(2);
    const research = creates.find((call) =>
      String(call.args.title).toLowerCase().includes("research")
    );
    expect(research?.args.due_date).toBe("2026-10-23");
    expect(result.message.toLowerCase()).toMatch(/science|research|poster/);
  });

  it("asks before creating from tentative narration", async () => {
    const env = harness();
    const result = await runLocalCommand(
      "I might do homework tomorrow.",
      emptyContext(),
      env.board,
      env.act
    );
    expect(env.calls).toHaveLength(0);
    expect(result.message.toLowerCase()).toMatch(/deciding|save that|leave it/);
  });

  it("creates from make sure I remember paraphrases", async () => {
    const env = harness();
    const result = await runLocalCommand(
      "Make sure I remember to do homework tomorrow.",
      emptyContext(),
      env.board,
      env.act
    );
    const create = env.calls.find((call) => call.name === "create_task");
    expect(create).toBeTruthy();
    expect(String(create?.args.title).toLowerCase()).toMatch(/homework/);
    expect(String(create?.args.title).toLowerCase()).not.toMatch(/remember/);
    expect(create?.args.due_date).toBe("2026-10-23");
    expect(result.message.toLowerCase()).toMatch(/created|homework/);
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

  it("moves matching tasks into the focused project", async () => {
    const env = harness();
    env.board.tasks.push(
      task({
        id: "44444444-4444-4444-8444-444444444430",
        title: "Science revision notes",
        due_date: "2026-10-24",
      }),
      task({
        id: "44444444-4444-4444-8444-444444444431",
        title: "Science revision quiz",
        due_date: "2026-10-25",
      })
    );
    const project = env.board.projects[0];
    const moved = await runLocalCommand(
      "Move all my science revision tasks into that project.",
      {
        ...emptyContext(),
        lastProject: { id: project.id, name: project.name },
        focus: { kind: "project", id: project.id, label: project.name },
      },
      env.board,
      env.act
    );
    expect(env.calls.some((call) => call.name === "move_tasks_to_project")).toBe(true);
    expect(moved.message.toLowerCase()).toMatch(/moved/);
    expect(moved.message).toMatch(/Science revision/i);
  });

  it("creates checklists with items and adds to an existing list", async () => {
    const env = harness();
    const created = await runLocalCommand(
      "Create a checklist called Groceries with milk and eggs",
      emptyContext(),
      env.board,
      env.act
    );
    expect(created.message).toContain("Groceries");
    expect(created.message).toMatch(/milk/i);
    expect(created.message).toMatch(/eggs/i);
    const createCall = env.calls.find((call) => call.name === "create_checklist");
    expect(createCall?.args.title).toBe("Groceries");
    expect(createCall?.args.items).toEqual([{ title: "milk" }, { title: "eggs" }]);

    const added = await runLocalCommand(
      "Add bread to the Groceries checklist",
      created.context,
      env.board,
      env.act
    );
    expect(added.message).toMatch(/bread/i);
    expect(env.calls.at(-1)?.name).toBe("add_checklist_items");
    expect(env.calls.at(-1)?.args.titles).toEqual(["bread"]);
  });

  it("shows checklists and deletes them after confirm", async () => {
    const env = harness();
    const listed = await runLocalCommand("Show my checklists", emptyContext(), env.board, env.act);
    expect(listed.message).toContain("Science exam prep");
    expect(env.calls[0]?.name).toBe("list_checklists");

    const asked = await runLocalCommand(
      "Delete the Science exam prep checklist",
      emptyContext(),
      env.board,
      env.act
    );
    expect(asked.blocks.some((block) => block.type === "confirm")).toBe(true);
    const confirmed = await runLocalCommand("yes", asked.context, env.board, env.act);
    expect(confirmed.message.toLowerCase()).toContain("removed");
    expect(env.calls.some((call) => call.name === "delete_checklist")).toBe(true);
  });

  it("creates a project with a deadline", async () => {
    const env = harness();
    const created = await runLocalCommand(
      "Create a project called Midterms with deadline 2026-11-06",
      emptyContext(),
      env.board,
      env.act
    );
    expect(created.message).toMatch(/Created project “Midterms”/i);
    const call = env.calls.find((item) => item.name === "create_project");
    expect(call?.args).toMatchObject({ name: "Midterms", deadline: "2026-11-06" });
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

  it("changes a project deadline", async () => {
    const env = harness();
    const result = await runLocalCommand(
      "Change the deadline of my history project to next Monday.",
      emptyContext(),
      env.board,
      env.act
    );
    expect(env.calls.some((call) => call.name === "update_project")).toBe(true);
    const update = env.calls.find((call) => call.name === "update_project");
    expect(update?.args.id).toBe("11111111-1111-4111-8111-111111111111");
    expect(update?.args.deadline).toBe("2026-10-26");
    expect(result.message.toLowerCase()).toMatch(/deadline|updated|changed|set/);
  });

  it("understands casual create, query, and complete phrasing", async () => {
    const env = harness();

    const reminded = await runLocalCommand(
      "remind me to call mom tomorrow",
      emptyContext(),
      env.board,
      env.act
    );
    expect(reminded.message).toMatch(/call mom/i);
    expect(env.calls.some((call) => call.name === "create_task")).toBe(true);

    const bare = await runLocalCommand(
      "maths worksheet for tomorrow",
      emptyContext(),
      env.board,
      env.act
    );
    expect(bare.message).toMatch(/maths worksheet/i);
    expect(env.calls.filter((call) => call.name === "create_task").length).toBeGreaterThanOrEqual(2);

    const polite = await runLocalCommand(
      "can you show me what I need to do today?",
      emptyContext(),
      env.board,
      env.act
    );
    expect(env.calls.some((call) => call.name === "query_schedule" && call.args.period === "today")).toBe(
      true
    );
    expect(polite.message).toContain("Finish maths homework");

    const shortQuery = await runLocalCommand("today?", emptyContext(), env.board, env.act);
    expect(shortQuery.message).toContain("Finish maths homework");

    const done = await runLocalCommand(
      "done with Finish maths homework",
      emptyContext(),
      env.board,
      env.act
    );
    expect(done.message).toMatch(/complete/i);
    expect(env.calls.some((call) => call.name === "complete_task")).toBe(true);

    const need = await runLocalCommand(
      "I need to submit the lab form by Friday",
      emptyContext(),
      env.board,
      env.act
    );
    expect(need.message).toMatch(/lab form/i);
  });

  it("understands remove as delete and still asks for confirm", async () => {
    const env = harness();
    const asked = await runLocalCommand(
      "remove Finish maths homework",
      emptyContext(),
      env.board,
      env.act
    );
    expect(asked.blocks.some((block) => block.type === "confirm")).toBe(true);
    expect(env.calls).toHaveLength(0);
  });

  it("corrects spelling, shows interpretation, and saves the task", async () => {
    const env = harness();
    const result = await runLocalCommand(
      "Add homwork for tomorow",
      emptyContext(),
      env.board,
      env.act
    );
    expect(result.blocks.some((block) => block.type === "interpretation")).toBe(true);
    const interp = result.blocks.find((block) => block.type === "interpretation");
    expect(interp && interp.type === "interpretation" && interp.text).toMatch(/homework/i);
    expect(result.message).toMatch(/homework/i);
    expect(env.calls.some((call) => call.name === "create_task")).toBe(true);
    const create = env.calls.find((call) => call.name === "create_task");
    expect(String(create?.args.title)).toMatch(/homework/i);
  });

  it("asks before acting on ambiguous weak→week", async () => {
    const env = harness();
    const asked = await runLocalCommand(
      "Move the meeting to next weak",
      emptyContext(),
      env.board,
      env.act
    );
    expect(asked.message).toMatch(/next week/i);
    expect(asked.context.pendingInterpretation?.acceptedText).toMatch(/week/i);
    expect(env.calls).toHaveLength(0);

    const confirmed = await runLocalCommand("yes", asked.context, env.board, env.act);
    // May ask which meeting / fail to find — but must not leave pending interpretation
    expect(confirmed.context.pendingInterpretation == null).toBe(true);
  });

  it("asks for misspelled nex weak before changing a deadline", async () => {
    const env = harness();
    const asked = await runLocalCommand(
      "move my assigment to nex weak.",
      emptyContext(),
      env.board,
      env.act
    );
    expect(asked.message).toMatch(/next week/i);
    expect(asked.blocks.some((block) => block.type === "interpretation")).toBe(true);
    expect(asked.context.pendingInterpretation?.acceptedText).toMatch(/assignment/i);
    expect(asked.context.pendingInterpretation?.acceptedText).toMatch(/next week/i);
    expect(env.calls).toHaveLength(0);
  });

  it("creates buy milk from i need to by milk tomorow", async () => {
    const env = harness();
    const result = await runLocalCommand(
      "i need to by milk tomorow.",
      emptyContext(),
      env.board,
      env.act
    );
    expect(result.blocks.some((block) => block.type === "interpretation")).toBe(true);
    expect(env.calls.some((call) => call.name === "create_task")).toBe(true);
    const create = env.calls.find((call) => call.name === "create_task");
    expect(String(create?.args.title)).toMatch(/buy milk|milk/i);
    expect(result.message).toMatch(/milk|added|created/i);
    expect(result.message).not.toMatch(/couldn't create/i);
  });

  it("does not show interpretation for clear messages", async () => {
    const env = harness();
    const result = await runLocalCommand(
      "Add maths homework for tomorrow.",
      emptyContext(),
      env.board,
      env.act
    );
    expect(result.blocks.some((block) => block.type === "interpretation")).toBe(false);
    expect(env.calls.some((call) => call.name === "create_task")).toBe(true);
  });

  it("plans today from real schedule data without saving", async () => {
    const env = harness();
    const result = await runLocalCommand("Help me plan tomorrow.", emptyContext(), env.board, env.act);
    expect(env.calls.some((c) => c.name === "query_schedule" && c.args.period === "tomorrow")).toBe(
      true
    );
    expect(result.blocks.some((b) => b.type === "schedule" && b.saved === false)).toBe(true);
    expect(result.context.lastPlan?.slots.length).toBeGreaterThan(0);
    expect(result.message).toMatch(/not been saved|nothing was saved|suggestion/i);
  });

  it("recommends what to work on first using priority not only due date", async () => {
    const env = harness(
      board({
        tasks: [
          task({
            id: "44444444-4444-4444-8444-444444444401",
            title: "Low chore",
            due_date: "2026-10-22",
            priority: "low",
          }),
          task({
            id: "44444444-4444-4444-8444-444444444402",
            title: "Urgent deliverable",
            due_date: "2026-10-28",
            priority: "urgent",
          }),
        ],
      })
    );
    const result = await runLocalCommand(
      "What should I work on first?",
      emptyContext(),
      env.board,
      env.act
    );
    expect(result.message).toMatch(/Urgent deliverable/i);
    expect(result.message.toLowerCase()).toMatch(/not only|importance|priority/);
  });

  it("handles overload and breakdown without creating tasks", async () => {
    const env = harness();
    const overload = await runLocalCommand(
      "I've got too much to do this week.",
      emptyContext(),
      env.board,
      env.act
    );
    expect(env.calls.some((c) => c.name === "query_schedule" && c.args.period === "this_week")).toBe(
      true
    );
    expect(overload.message.toLowerCase()).toMatch(/reorder|defer|split|alternatives|heavy|tight|workload/);

    const breakdown = await runLocalCommand(
      "Break this into smaller steps for a science exhibition",
      emptyContext(),
      env.board,
      env.act
    );
    expect(env.calls.filter((c) => c.name === "create_task")).toHaveLength(0);
    expect(breakdown.message.toLowerCase()).toMatch(/research|haven't created|not saved|suggested/);
  });

  it("applies plan follow-ups from conversation context", async () => {
    const env = harness();
    let context = emptyContext();
    const planned = await runLocalCommand("plan my day", context, env.board, env.act);
    context = planned.context;
    expect(context.lastPlan?.slots.length).toBeGreaterThan(0);

    const shorter = await runLocalCommand("Make it shorter.", context, env.board, env.act);
    context = shorter.context;
    expect(shorter.context.lastPlan!.slots.filter((s) => s.kind === "task").length).toBeLessThanOrEqual(
      planned.context.lastPlan!.slots.filter((s) => s.kind === "task").length
    );

    const start = await runLocalCommand("What if I start at 4 PM?", context, env.board, env.act);
    expect(start.context.lastPlan?.workStart).toBe("16:00");
  });
});
