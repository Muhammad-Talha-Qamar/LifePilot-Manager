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
  });

  it("rewrites short and casual schedule questions", () => {
    expect(rewriteIntent("today?")).toBe("show my tasks for today");
    expect(rewriteIntent("do I have anything tomorrow")).toBe("show my tasks for tomorrow");
    expect(rewriteIntent("what's on this week")).toBe("show my tasks for this week");
  });

  it("treats bare title + date as a create", () => {
    expect(rewriteIntent("maths homework tomorrow")).toBe("add maths homework for tomorrow");
    expect(rewriteIntent("call dentist on Friday")).toBe("add call dentist for Friday");
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
});
