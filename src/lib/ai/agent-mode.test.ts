import { describe, expect, it } from "vitest";
import {
  modeAllowsTool,
  parseSlashCommand,
  suggestFollowUps,
} from "./agent-mode";

describe("parseSlashCommand", () => {
  it("parses mode switches", () => {
    expect(parseSlashCommand("/plan organize my week")).toEqual({
      mode: "plan",
      text: "organize my week",
    });
    expect(parseSlashCommand("/ask what's left")).toMatchObject({ mode: "ask" });
    expect(parseSlashCommand("/undo")).toMatchObject({ builtin: "undo" });
    expect(parseSlashCommand("/clear")).toMatchObject({ builtin: "clear" });
  });

  it("leaves normal text alone", () => {
    expect(parseSlashCommand("remind me to call mom")).toEqual({
      text: "remind me to call mom",
    });
  });
});

describe("modeAllowsTool", () => {
  it("blocks writes in ask/plan", () => {
    expect(modeAllowsTool("ask", "create_task")).toBe(false);
    expect(modeAllowsTool("plan", "delete_task")).toBe(false);
    expect(modeAllowsTool("ask", "query_schedule")).toBe(true);
    expect(modeAllowsTool("agent", "create_task")).toBe(true);
  });
});

describe("suggestFollowUps", () => {
  it("returns plan-specific tips in plan mode", () => {
    const tips = suggestFollowUps({
      userMessage: "organize week",
      assistantMessage: "plan…",
      toolNames: [],
      agentMode: "plan",
    });
    expect(tips.some((tip) => /execute|agent/i.test(tip))).toBe(true);
  });
});
