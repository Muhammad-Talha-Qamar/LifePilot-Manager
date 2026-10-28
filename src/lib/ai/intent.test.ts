import { describe, expect, it } from "vitest";
import { rewriteIntent } from "./intent";

describe("rewriteIntent", () => {
  it("turns reminders and needs into add commands", () => {
    expect(rewriteIntent("remind me to call mom tomorrow")).toBe("add call mom tomorrow");
    expect(rewriteIntent("don't forget to email tutor")).toBe("add email tutor");
    expect(rewriteIntent("I need to finish the essay by Friday")).toBe(
      "add finish the essay by Friday"
    );
    expect(rewriteIntent("todo: buy milk")).toBe("add buy milk");
    expect(rewriteIntent("nudge me to stretch tonight")).toBe("add stretch tonight");
    expect(rewriteIntent("I want to draft the proposal")).toBe("add draft the proposal");
    expect(rewriteIntent("set a reminder to drink water")).toBe("add drink water");
    expect(rewriteIntent("ping me to pay rent")).toBe("add pay rent");
  });

  it("strips polite wrappers", () => {
    expect(rewriteIntent("can you add maths homework for tomorrow")).toBe(
      "add maths homework for tomorrow"
    );
    expect(rewriteIntent("hey, please show my checklists")).toBe("show my checklists");
  });

  it("rewrites casual completes and deletes", () => {
    expect(rewriteIntent("done with maths homework")).toBe("mark maths homework complete");
    expect(rewriteIntent("I finished the lab report")).toBe("mark the lab report complete");
    expect(rewriteIntent("remove the duplicate task")).toBe("delete the duplicate task");
    expect(rewriteIntent("essay done")).toBe("mark essay complete");
  });

  it("rewrites short and casual schedule questions", () => {
    expect(rewriteIntent("today?")).toBe("show my tasks for today");
    expect(rewriteIntent("do I have anything tomorrow")).toBe("show my tasks for tomorrow");
    expect(rewriteIntent("what's on this week")).toBe("show my tasks for this week");
    expect(rewriteIntent("pull up my agenda")).toBe("show my tasks for today");
  });

  it("treats bare title + date as a create", () => {
    expect(rewriteIntent("maths homework tomorrow")).toBe("add maths homework for tomorrow");
    expect(rewriteIntent("call dentist on Friday")).toBe("add call dentist for Friday");
  });

  it("fixes common typos while rewriting", () => {
    expect(rewriteIntent("remind me to submit hw tommorow")).toBe(
      "add submit homework tomorrow"
    );
    expect(rewriteIntent("show my cheklist")).toBe("show my checklists");
  });

  it("rewrites postpone / bump phrasing", () => {
    expect(rewriteIntent("postpone dentist until next Monday")).toBe(
      "move dentist to next Monday"
    );
    expect(rewriteIntent("bump the essay to Friday")).toBe("move the essay to Friday");
  });

  it("does not rewrite corrections or existing commands", () => {
    expect(rewriteIntent("No, I meant next Friday")).toBe("No, I meant next Friday");
    expect(rewriteIntent("Add maths homework for tomorrow")).toBe(
      "Add maths homework for tomorrow"
    );
    expect(rewriteIntent("Move Finish maths homework into Midterms")).toBe(
      "Move Finish maths homework into Midterms"
    );
  });

  it("treats schedule+object as create, not a schedule query", () => {
    expect(rewriteIntent("Can you schedule my homework for tomorrow?")).toBe(
      "add homework for tomorrow"
    );
    expect(rewriteIntent("schedule my homework for tomorrow")).toBe(
      "add homework for tomorrow"
    );
  });

  it("understands put X on DATE's list and finish X", () => {
    expect(rewriteIntent("Put homework on tomorrow's list.")).toBe(
      "add homework for tomorrow"
    );
    expect(rewriteIntent("finish maths homework")).toBe("mark maths homework complete");
    expect(rewriteIntent("make it Friday")).toBe("move it to Friday");
    expect(rewriteIntent("Friday instead")).toBe("move it to Friday");
  });

  it("uses the obligation clause in compound create requests", () => {
    expect(rewriteIntent("I need to do my homework tomorrow. Add it to my tasks.")).toBe(
      "add homework tomorrow"
    );
  });
});
