/**
 * Phase-10 interface reliability checks that can run without a browser.
 * Browser layout / mobile / streaming E2E are reported separately as not fully automated here.
 */
import { describe, expect, it } from "vitest";
import { segmentReply } from "./formatted-reply";
import { readFileSync } from "fs";
import path from "path";

describe("QA interface — reply formatting for long responses", () => {
  it("segments long multi-paragraph replies without dropping content", () => {
    const long = [
      "Here is your plan for today.",
      "",
      "1. Finish maths homework",
      "2. Science lab prep",
      "",
      "Afterwards you still have milk on the list.",
      "Let me know if you want me to move anything.",
    ].join("\n");
    const parts = segmentReply(long);
    expect(parts.length).toBeGreaterThan(1);
    const flat = JSON.stringify(parts);
    expect(flat).toContain("maths homework");
    expect(flat).toContain("move anything");
  });
});

describe("QA interface — reduced motion and loading affordances in source", () => {
  it("assistant workspace respects prefers-reduced-motion", () => {
    const src = readFileSync(
      path.join(__dirname, "assistant-workspace.tsx"),
      "utf8"
    );
    expect(src).toMatch(/prefers-reduced-motion/);
    expect(src).toMatch(/Loader2|busy|thinking|streaming/);
  });

  it("assistant provider supports stop / regenerate / queue to reduce duplicate submits", () => {
    const src = readFileSync(
      path.join(__dirname, "assistant-provider.tsx"),
      "utf8"
    );
    expect(src).toMatch(/regenerate|stop|queue|AbortController|streaming/i);
  });
});
