/**
 * Phase-10 security + planning accuracy QA.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { AuthContext } from "@/lib/data/auth";
import { createTask, listTasks } from "@/lib/data/repository";
import { clearDemoStore } from "@/lib/demo/store";
import { executeTool } from "./tools";
import {
  buildDayPlan,
  buildPeriodPlan,
  detectPlanningCommand,
  planningCommandToText,
  rankTasksForPlanning,
} from "./planning";
import type { CalendarEvent, Task } from "@/types";
import { modeAllowsTool, parseSlashCommand } from "./agent-mode";

const authA: AuthContext = {
  userId: "qa-sec-user-a",
  email: "sec-a@test.local",
  isDemo: true,
  profile: {
    id: "qa-sec-user-a",
    email: "sec-a@test.local",
    full_name: "Sec A",
    avatar_url: null,
    timezone: "Asia/Karachi",
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-01T00:00:00.000Z",
  },
};

const authB: AuthContext = {
  ...authA,
  userId: "qa-sec-user-b",
  email: "sec-b@test.local",
  profile: {
    ...authA.profile,
    id: "qa-sec-user-b",
    email: "sec-b@test.local",
    full_name: "Sec B",
  },
};

beforeEach(async () => {
  await clearDemoStore(authA.userId, authA.email, "Sec A");
  await clearDemoStore(authB.userId, authB.email, "Sec B");
});

describe("QA security — authorization on tools", () => {
  it("cannot complete or delete another user's task", async () => {
    const task = await createTask({ title: "Secret homework" }, authA);
    const complete = await executeTool("complete_task", { id: task.id }, authB);
    const del = await executeTool(
      "delete_task",
      { id: task.id, confirmed: true },
      authB
    );
    expect(complete.success).toBe(false);
    expect(del.success).toBe(false);
    expect((await listTasks({}, authA)).some((t) => t.id === task.id)).toBe(true);
  });

  it("cannot assign a task to another user's project", async () => {
    const project = await executeTool("create_project", { name: "A Only" }, authA);
    const projectId = (project.result as { id: string }).id;
    const foreign = await executeTool(
      "create_task",
      { title: "Intrusion", project_id: projectId },
      authB
    );
    expect(foreign.success).toBe(false);
  });

  it("ask/plan modes block write tools", () => {
    expect(modeAllowsTool("ask", "create_task")).toBe(false);
    expect(modeAllowsTool("plan", "delete_task")).toBe(false);
    expect(modeAllowsTool("ask", "query_schedule")).toBe(true);
    expect(modeAllowsTool("agent", "create_task")).toBe(true);
    expect(parseSlashCommand("/ask what is left today").mode).toBe("ask");
    expect(parseSlashCommand("/plan my week").mode).toBe("plan");
  });
});

describe("QA planning accuracy", () => {
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
      estimated_minutes: 45,
      completed_at: null,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      ...partial,
    };
  }

  it("detects day/week planning commands from natural phrasing", () => {
    expect(planningCommandToText(detectPlanningCommand("plan my day")!)).toMatch(/plan/i);
    expect(detectPlanningCommand("I've got too much to do this week")).not.toBeNull();
    expect(detectPlanningCommand("help me organize this week")).not.toBeNull();
  });

  it("ranks urgent work ahead of low-priority early chores", () => {
    const ranked = rankTasksForPlanning(
      [
        task({ id: "1", title: "Low chore", priority: "low", due_date: "2026-10-23" }),
        task({
          id: "2",
          title: "Urgent lab",
          priority: "urgent",
          due_date: "2026-10-28",
        }),
      ],
      { today, projects: [], defaultDuration: 45 }
    );
    expect(ranked[0].task.id).toBe("2");
  });

  it("builds a day plan from available tasks/events and flags default estimates", () => {
    const events: CalendarEvent[] = [
      {
        id: "e1",
        user_id: "user",
        title: "Lecture",
        description: null,
        event_type: "meeting",
        start_at: "2026-10-22T04:00:00.000Z",
        end_at: "2026-10-22T05:00:00.000Z",
        all_day: false,
        location: null,
        project_id: null,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      },
    ];
    const plan = buildDayPlan({
      tasks: [
        task({
          id: "1",
          title: "Maths",
          priority: "high",
          due_date: today,
          estimated_minutes: 60,
        }),
        task({
          id: "2",
          title: "Milk",
          priority: "low",
          due_date: today,
          estimated_minutes: null,
        }),
      ],
      events,
      projects: [],
      day: today,
      periodLabel: "Today",
      timezone: "Asia/Karachi",
      workStart: "09:00",
      workEnd: "17:00",
      defaultDuration: 45,
    });
    expect(plan.slots.length).toBeGreaterThan(0);
    expect(plan.slots.some((s) => s.kind === "event")).toBe(true);
    expect(plan.defaultDurationUsed).toBe(true);
  });

  it("builds a week plan without inventing tasks not in the board", () => {
    const plan = buildPeriodPlan({
      tasks: [
        task({ id: "1", title: "Known only", due_date: "2026-10-23", priority: "high" }),
      ],
      projects: [],
      today,
      periodLabel: "This week",
      periodKind: "this_week",
      horizon: "week",
      defaultDuration: 45,
    });
    const titles = plan.slots.map((s) => s.title);
    expect(titles).toContain("Known only");
    expect(titles.some((t) => /invented|fabricated/i.test(t))).toBe(false);
  });
});
