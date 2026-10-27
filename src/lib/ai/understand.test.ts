import { describe, expect, it } from "vitest";
import { understandInput } from "./understand";

describe("understandInput", () => {
  it("answers greetings and help without changing data", () => {
    expect(understandInput("hey")).toMatchObject({ kind: "reply" });
    expect(understandInput("what can you do?")).toMatchObject({ kind: "reply" });
    expect(understandInput("thanks!")).toMatchObject({ kind: "reply" });
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
  });

  it("understands shopping-list shorthand", () => {
    expect(understandInput("shopping list: milk, eggs, bread")).toEqual({
      kind: "command",
      text: "create checklist for Groceries with milk, eggs, bread",
    });
  });

  it("understands plan-my-day phrasing", () => {
    expect(understandInput("what should I focus on today")).toEqual({
      kind: "command",
      text: "plan my day",
    });
  });

  it("passes through already-clear commands", () => {
    expect(understandInput("Add maths homework for tomorrow")).toEqual({
      kind: "pass",
    });
  });
});
