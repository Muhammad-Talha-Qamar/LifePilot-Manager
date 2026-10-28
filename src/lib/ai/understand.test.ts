import { describe, expect, it } from "vitest";
import { understandInput } from "./understand";

describe("understandInput", () => {
  it("answers greetings and help without changing data", () => {
    expect(understandInput("hey")).toMatchObject({ kind: "reply" });
    expect(understandInput("what can you do?")).toMatchObject({ kind: "reply" });
    expect(understandInput("thanks!")).toMatchObject({ kind: "reply" });
    expect(understandInput("salam")).toMatchObject({ kind: "reply" });
  });

  it("turns soft obligations into create commands", () => {
    expect(understandInput("I'm gonna submit the form by Friday")).toEqual({
      kind: "command",
      text: "add submit the form by Friday",
    });
    expect(understandInput("jot down dentist appointment tomorrow")).toEqual({
      kind: "command",
      text: "add dentist appointment tomorrow",
    });
    expect(understandInput("make sure I email the tutor")).toEqual({
      kind: "command",
      text: "add email the tutor",
    });
    expect(understandInput("don't let me forget to stretch")).toEqual({
      kind: "command",
      text: "add stretch",
    });
  });

  it("understands casual completes", () => {
    expect(understandInput("the essay is done")).toEqual({
      kind: "command",
      text: "mark the essay complete",
    });
    expect(understandInput("just finished maths homework")).toEqual({
      kind: "command",
      text: "mark maths homework complete",
    });
    expect(understandInput("finally done with the lab")).toEqual({
      kind: "command",
      text: "mark the lab complete",
    });
  });

  it("understands rundown / what's left style queries", () => {
    expect(understandInput("what's left today")).toEqual({
      kind: "command",
      text: "show my tasks for today",
    });
    expect(understandInput("catch me up")).toEqual({
      kind: "command",
      text: "show my tasks for today",
    });
    expect(understandInput("what's on my plate")).toEqual({
      kind: "command",
      text: "show my tasks for today",
    });
    expect(understandInput("any overdue stuff")).toEqual({
      kind: "command",
      text: "show my overdue tasks",
    });
  });

  it("understands shopping-list shorthand", () => {
    expect(understandInput("shopping list: milk, eggs, bread")).toEqual({
      kind: "command",
      text: "create checklist for Groceries with milk, eggs, bread",
    });
    expect(understandInput("groceries: milk, bread")).toEqual({
      kind: "command",
      text: "create checklist for Groceries with milk, bread",
    });
  });

  it("understands plan-my-day phrasing", () => {
    expect(understandInput("what should I focus on today")).toEqual({
      kind: "command",
      text: "plan my day",
    });
    expect(understandInput("build me a daily plan")).toEqual({
      kind: "command",
      text: "plan my day",
    });
  });

  it("understands informal planning requests", () => {
    expect(understandInput("Help me plan tomorrow.")).toEqual({
      kind: "command",
      text: "plan my tomorrow",
    });
    expect(understandInput("What should I work on first?")).toEqual({
      kind: "command",
      text: "what should I work on first",
    });
    expect(understandInput("I've got too much to do this week.")).toEqual({
      kind: "command",
      text: "too much to do this week",
    });
    expect(understandInput("What's coming up?")).toEqual({
      kind: "command",
      text: "what's coming up",
    });
    expect(understandInput("Break this into smaller steps.")).toMatchObject({
      kind: "command",
    });
  });

  it("normalizes typos before understanding", () => {
    expect(understandInput("remind me to call mom tommorow")).toEqual({
      kind: "command",
      text: "add call mom tomorrow",
    });
  });

  it("understands romanized Urdu reminder phrasing", () => {
    const result = understandInput("mujhe yaad dilao kal doctor");
    expect(result.kind).toBe("command");
    if (result.kind === "command") {
      expect(result.text.toLowerCase()).toContain("add");
      expect(result.text.toLowerCase()).toContain("doctor");
    }
  });

  it("passes through already-clear commands", () => {
    expect(understandInput("Add maths homework for tomorrow")).toEqual({
      kind: "pass",
    });
  });
});
