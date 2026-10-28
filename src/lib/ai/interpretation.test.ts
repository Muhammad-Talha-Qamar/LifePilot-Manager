import { describe, expect, it } from "vitest";
import {
  interpretationBlock,
  resolveInterpretation,
  surfaceCorrect,
} from "./interpretation";
import { correctSpellingAndGrammar } from "./spell";
import { understandInput } from "./understand";
import { rewriteIntent } from "./intent";

describe("surfaceCorrect / spelling", () => {
  it("fixes multiple spelling mistakes in one sentence", () => {
    expect(surfaceCorrect("Add homwork for tomorow")).toMatch(/homework.*tomorrow/i);
    expect(correctSpellingAndGrammar("Reshedule my meting to friday")).toMatch(
      /reschedule my meeting to friday/i
    );
  });

  it("repairs by → buy in remind/add context", () => {
    expect(surfaceCorrect("Remind me to by milk")).toMatch(/buy milk/i);
    expect(correctSpellingAndGrammar("Remind me to by milk")).toMatch(/to buy milk/i);
  });

  it("fixes upcoming misspellings", () => {
    expect(surfaceCorrect("Show my upcomming task")).toMatch(/upcoming tasks/i);
  });

  it("does not invent corrections for unusual proper words", () => {
    expect(surfaceCorrect("Add xanthium leaves tomorrow")).toMatch(/xanthium/i);
  });
});

describe("resolveInterpretation", () => {
  it("shows interpretation for meaningful typos", () => {
    const decision = resolveInterpretation("Add homwork for tomorow");
    expect(decision.showInterpretation).toBe(true);
    expect(decision.clarification).toBeNull();
    expect(decision.interpreted).toMatch(/homework/i);
    expect(decision.interpreted).toMatch(/tomorrow/i);
    const block = interpretationBlock(decision);
    expect(block?.type).toBe("interpretation");
    expect(block?.label).toBe("I think you mean");
  });

  it("stays quiet when the message is already clear", () => {
    const decision = resolveInterpretation("Add homework for tomorrow");
    expect(decision.showInterpretation).toBe(false);
    expect(interpretationBlock(decision)).toBeNull();
  });

  it("asks instead of guessing for next weak", () => {
    const decision = resolveInterpretation("Move the meeting to next weak");
    expect(decision.clarification).toMatch(/next week/i);
    expect(decision.showInterpretation).toBe(false);
    const block = interpretationBlock(decision);
    expect(block?.uncertain).toBe(true);
    expect(block?.label).toBe("Did you mean");
  });

  it("does not fuzzy-collapse weak into week silently", () => {
    expect(correctSpellingAndGrammar("next weak")).toMatch(/weak/i);
  });
});

describe("end-to-end intent after spelling", () => {
  it("understands corrected create / remind / show / reschedule", () => {
    expect(rewriteIntent("Add homwork for tomorow")).toMatch(/add homework for tomorrow/i);
    expect(understandInput("Remind me to by milk")).toEqual({
      kind: "command",
      text: "add buy milk",
    });
    expect(understandInput("Show my upcomming task")).toEqual({
      kind: "command",
      text: "show my tasks for next 7 days",
    });
    expect(understandInput("Reshedule my meting to friday")).toEqual({
      kind: "command",
      text: "move my meeting to friday",
    });
  });
});
