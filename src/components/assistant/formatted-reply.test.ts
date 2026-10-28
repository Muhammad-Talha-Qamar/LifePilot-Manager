import { describe, expect, it } from "vitest";
import { segmentReply } from "./formatted-reply";

describe("segmentReply", () => {
  it("keeps plain paragraphs together", () => {
    expect(segmentReply("Hello there.\n\nSecond thought.")).toEqual([
      { kind: "paragraph", text: "Hello there." },
      { kind: "paragraph", text: "Second thought." },
    ]);
  });

  it("parses numbered instructions", () => {
    const segments = segmentReply("Here is the plan:\n1. Review notes\n2. Draft outline\n3. Finish slides");
    expect(segments[0]).toEqual({ kind: "paragraph", text: "Here is the plan:" });
    expect(segments[1]).toEqual({
      kind: "ol",
      items: ["Review notes", "Draft outline", "Finish slides"],
    });
  });

  it("parses bullet task-style lists", () => {
    expect(segmentReply("- Milk\n- Eggs\n- Bread")).toEqual([
      { kind: "ul", items: ["Milk", "Eggs", "Bread"] },
    ]);
  });

  it("does not invent structure for ordinary sentences", () => {
    expect(segmentReply("Remind me tomorrow at 3.")).toEqual([
      { kind: "paragraph", text: "Remind me tomorrow at 3." },
    ]);
  });
});
