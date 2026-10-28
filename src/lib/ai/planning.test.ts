import { describe, expect, it } from "vitest";
import type { CalendarEvent, Project, Task } from "@/types";
import {
  applyPlanFollowUp,
  assessOverload,
  buildDayPlan,
  buildPeriodPlan,
  detectPlanningCommand,
  feasibilityBefore,
  planningCommandToText,
  rankTasksForPlanning,
  scoreTaskForPlanning,
  suggestBreakdown,
} from "./planning";
import { emptyContext, type Board } from "./types";

const now = new Date("2026-10-22T08:00:00.000Z");
const today = "2026-10-22";

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

const project: Project = {
  id: "11111111-1111-4111-8111-111111111111",
  user_id: "user",
  name: "Science Exhibition",
  description: null,
  status: "active",
  priority: "high",
  start_date: "2026-10-01",
  deadline: "2026-10-30",
  is_archived: false,
  created_at: now.toISOString(),
  updated_at: now.toISOString(),
};

describe("detectPlanningCommand", () => {
  const samples: Array<[string, string]> = [
    ["Help me plan tomorrow.", "plan my tomorrow"],
    ["What should I work on first?", "what should I work on first"],
    ["I've got too much to do this week.", "too much to do this week"],
    ["What's coming up?", "what's coming up"],
    ["Which deadlines should I worry about?", "which deadlines should I worry about"],
    ["Help me finish my project on time.", "help me finish my project on time"],
    ["Break this into smaller steps.", "break down this goal"],
    ["Can I finish everything before Friday?", "can I finish everything before Friday"],
    ["Move the less important work to next week.", "move less important work to next week"],
    ["plan my week", "plan my week"],
    ["help me plan my morning", "plan my day"],
  ];

  for (const [input, expected] of samples) {
    it(`maps “${input}” → “${expected}”`, () => {
      const cmd = detectPlanningCommand(input);
      expect(cmd).not.toBeNull();
      expect(planningCommandToText(cmd!)).toBe(expected);
    });
  }
});

describe("rankTasksForPlanning", () => {
  it("does not always pick the earliest deadline over higher importance", () => {
    const earlyLow = task({
      id: "a",
      title: "Optional chore",
      due_date: "2026-10-23",
      priority: "low",
    });
    const laterUrgent = task({
      id: "b",
      title: "Critical project deliverable",
      due_date: "2026-10-28",
      priority: "urgent",
      project_id: project.id,
    });
    const ranked = rankTasksForPlanning([earlyLow, laterUrgent], {
      today,
      projects: [project],
      defaultDuration: 45,
    });
    expect(ranked[0].task.id).toBe("b");
    expect(ranked[0].reasons.some((r) => /urgent|project/i.test(r))).toBe(true);
  });

  it("boosts overdue work without inventing data", () => {
    const overdue = task({
      id: "o",
      title: "Lab report",
      due_date: "2026-10-20",
      priority: "medium",
    });
    const scored = scoreTaskForPlanning(overdue, {
      today,
      projects: [],
      defaultDuration: 45,
    });
    expect(scored.reasons.some((r) => /overdue/i.test(r))).toBe(true);
    expect(scored.estimated).toBe(false);
  });
});

describe("buildDayPlan", () => {
  it("avoids overlapping calendar events and flags missing estimates", () => {
    const events: CalendarEvent[] = [
      {
        id: "e1",
        user_id: "user",
        title: "Team standup",
        description: null,
        location: null,
        event_type: "meeting",
        start_at: "2026-10-22T04:00:00.000Z", // 09:00 Asia/Karachi
        end_at: "2026-10-22T04:30:00.000Z",
        all_day: false,
        project_id: null,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      },
    ];
    const tasks = [
      task({
        id: "t1",
        title: "Maths homework",
        due_date: today,
        priority: "high",
        estimated_minutes: 60,
      }),
      task({
        id: "t2",
        title: "Reading",
        due_date: today,
        priority: "low",
        estimated_minutes: null,
      }),
    ];
    const plan = buildDayPlan({
      tasks,
      events,
      projects: [],
      day: today,
      periodLabel: "Today",
      timezone: "Asia/Karachi",
      workStart: "09:00",
      workEnd: "17:00",
      defaultDuration: 45,
    });
    expect(plan.slots.some((s) => s.kind === "event" && s.title === "Team standup")).toBe(true);
    const taskSlots = plan.slots.filter((s) => s.kind === "task");
    for (const slot of taskSlots) {
      expect(slot.time_label >= "09:30" || slot.time_label < "09:00").toBe(true);
    }
    expect(plan.defaultDurationUsed).toBe(true);
    expect(plan.explanations.some((e) => /default/i.test(e))).toBe(true);
  });
});

describe("buildPeriodPlan / overload / feasibility", () => {
  it("builds a weekly prioritized order", () => {
    const tasks = [
      task({ id: "1", title: "A", due_date: "2026-10-24", priority: "medium" }),
      task({ id: "2", title: "B", due_date: "2026-10-26", priority: "urgent" }),
    ];
    const plan = buildPeriodPlan({
      tasks,
      projects: [],
      today,
      periodLabel: "This week",
      periodKind: "this_week",
      horizon: "week",
      defaultDuration: 45,
    });
    expect(plan.slots[0].title).toBe("B");
    expect(plan.horizon).toBe("week");
  });

  it("flags overload when work exceeds free time", () => {
    const result = assessOverload({
      totalTaskMinutes: 600,
      availableMinutes: 240,
      taskCount: 5,
      overdueCount: 1,
    });
    expect(result.overloaded).toBe(true);
    expect(result.note).toMatch(/tight|over/i);
  });

  it("reports feasibility before a date using estimates honestly", () => {
    const tasks = [
      task({ id: "1", title: "A", due_date: "2026-10-23", estimated_minutes: 120 }),
      task({ id: "2", title: "B", due_date: "2026-10-24", estimated_minutes: null }),
    ];
    const report = feasibilityBefore(tasks, {
      today,
      beforeDate: "2026-10-24",
      defaultDuration: 45,
      workStart: "09:00",
      workEnd: "17:00",
    });
    expect(report.totalMinutes).toBe(165);
    expect(report.message).toMatch(/estimate/i);
  });
});

describe("suggestBreakdown", () => {
  it("adapts steps to a science exhibition goal without writing tasks", () => {
    const steps = suggestBreakdown("science exhibition");
    expect(steps.length).toBeGreaterThanOrEqual(4);
    expect(steps.some((s) => /research/i.test(s.title))).toBe(true);
    expect(steps.some((s) => /display|assemble|review|material/i.test(s.title))).toBe(true);
  });
});

describe("applyPlanFollowUp", () => {
  const board: Board = {
    tasks: [
      task({ id: "1", title: "Alpha", due_date: today, status: "done" }),
      task({ id: "2", title: "Beta", due_date: today }),
      task({ id: "3", title: "Gamma", due_date: today, project_id: project.id }),
    ],
    projects: [project],
    checklists: [],
    events: [],
    timezone: "Asia/Karachi",
    weekStartsOn: 1,
    now,
    defaultDuration: 45,
    workStart: "09:00",
    workEnd: "17:00",
  };

  function contextWithPlan() {
    const context = emptyContext();
    context.lastPlan = {
      horizon: "day",
      periodLabel: "Today",
      workStart: "09:00",
      workEnd: "17:00",
      slots: [
        { time_label: "09:00", title: "Alpha", minutes: 30, task_id: "1", kind: "task" },
        { time_label: "09:30", title: "Beta", minutes: 30, task_id: "2", kind: "task" },
        { time_label: "10:00", title: "Gamma", minutes: 45, task_id: "3", kind: "task" },
      ],
    };
    context.lastProject = { id: project.id, name: project.name };
    return context;
  }

  it("shortens the plan", () => {
    const result = applyPlanFollowUp("Make it shorter.", contextWithPlan(), board);
    expect(result).not.toBeNull();
    expect(result!.plan.slots.filter((s) => s.kind === "task").length).toBeLessThan(3);
  });

  it("moves the second task to the afternoon", () => {
    const result = applyPlanFollowUp(
      "Move the second task to the afternoon.",
      contextWithPlan(),
      board
    );
    expect(result).not.toBeNull();
    const second = result!.plan.slots.filter((s) => s.kind === "task")[1];
    expect(second.time_label).toBe("13:00");
  });

  it("restarts at 4 PM", () => {
    const result = applyPlanFollowUp("What if I start at 4 PM?", contextWithPlan(), board);
    expect(result).not.toBeNull();
    expect(result!.plan.workStart).toBe("16:00");
  });

  it("removes finished work from the plan", () => {
    const result = applyPlanFollowUp("Remove the one I've finished.", contextWithPlan(), board);
    expect(result).not.toBeNull();
    expect(result!.plan.slots.every((s) => s.task_id !== "1")).toBe(true);
  });

  it("puts the project first", () => {
    const result = applyPlanFollowUp(
      "Actually, I need to finish the project first.",
      contextWithPlan(),
      board
    );
    expect(result).not.toBeNull();
    const tasks = result!.plan.slots.filter((s) => s.kind === "task");
    expect(tasks[0].task_id).toBe("3");
  });

  it("flags save this plan", () => {
    const result = applyPlanFollowUp("Save this plan.", contextWithPlan(), board);
    expect(result?.saveRequested).toBe(true);
  });
});
