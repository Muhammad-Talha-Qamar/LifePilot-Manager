import { describe, expect, it } from "vitest";
import { correctSpellingAndGrammar, spellDistance } from "./spell";
import { normalizeInput } from "./normalize-input";
import { rewriteIntent } from "./intent";
import { understandInput } from "./understand";

describe("correctSpellingAndGrammar", () => {
  it("fixes common typos with explicit map", () => {
    expect(correctSpellingAndGrammar("call mom tommorow")).toMatch(/tomorrow/i);
    expect(correctSpellingAndGrammar("show my cheklist")).toMatch(/checklist/i);
    expect(correctSpellingAndGrammar("remnd me to stretch")).toMatch(/remind/i);
    expect(correctSpellingAndGrammar("waht is left")).toMatch(/what/i);
  });

  it("fixes transposed and near-miss domain words", () => {
    expect(correctSpellingAndGrammar("tomorrwo")).toMatch(/tomorrow/i);
    expect(correctSpellingAndGrammar("scheudle a meeting")).toMatch(/schedule/i);
    expect(correctSpellingAndGrammar("appoitment friday")).toMatch(/appointment/i);
    expect(correctSpellingAndGrammar("delte the task")).toMatch(/delete/i);
  });

  it("splits glued commands", () => {
    expect(correctSpellingAndGrammar("remindme to call mom")).toMatch(/remind me/i);
    expect(correctSpellingAndGrammar("showme today")).toMatch(/show me/i);
    expect(correctSpellingAndGrammar("planmyday")).toMatch(/plan my day/i);
  });

  it("fixes light grammar issues", () => {
    expect(correctSpellingAndGrammar("i has to finish essay")).toMatch(/i have/i);
    expect(correctSpellingAndGrammar("the the essay is done")).toMatch(/^the essay/i);
  });

  it("does not invent corrections for unrelated long words", () => {
    const out = correctSpellingAndGrammar("buy xanthium leaves");
    expect(out.toLowerCase()).toContain("xanthium");
  });
});

describe("spellDistance", () => {
  it("treats keyboard neighbors as cheaper", () => {
    expect(spellDistance("tommorow", "tomorrow")).toBeLessThanOrEqual(2);
    expect(spellDistance("tomorrow", "tomorrow")).toBe(0);
  });
});

describe("end-to-end messy input", () => {
  it("normalizes then rewrites badly spelled creates", () => {
    expect(rewriteIntent("remnd me to cal mom tommorow")).toBe(
      "add call mom tomorrow"
    );
    expect(rewriteIntent("don forget to emial tutor")).toMatch(/add email tutor/i);
  });

  it("understands broken query spelling", () => {
    expect(understandInput("waht left tody")).toEqual({
      kind: "command",
      text: "show my tasks for today",
    });
    expect(understandInput("shwo me cheklist")).toEqual({
      kind: "command",
      text: "show my checklists",
    });
  });

  it("handles missing spaces and grammar together", () => {
    expect(normalizeInput("remindme to submit hw tommorow")).toMatch(
      /remind me to submit homework tomorrow/i
    );
    expect(understandInput("essay is finshed")).toEqual({
      kind: "command",
      text: "mark essay complete",
    });
  });
});
