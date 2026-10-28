import { describe, expect, it } from "vitest";
import { isConversationalUtterance, matchConversation } from "./conversation";
import { understandInput } from "./understand";
import { detectStance } from "./stance";
import { suggestFollowUps } from "./agent-mode";

describe("matchConversation", () => {
  it("handles greetings, thanks, and identity", () => {
    expect(matchConversation("hey")?.kind).toBe("greeting");
    expect(matchConversation("Good morning")?.kind).toBe("greeting");
    expect(matchConversation("thanks!")?.kind).toBe("thanks");
    expect(matchConversation("who are you")?.kind).toBe("who");
    expect(matchConversation("what can you do")?.kind).toBe("help");
  });

  it("handles casual remarks without forcing tasks", () => {
    expect(matchConversation("I'm tired")?.kind).toBe("casual");
    expect(matchConversation("cool")?.kind).toBe("ack");
    expect(matchConversation("lol")?.kind).toBe("casual");
    expect(matchConversation("I'm so overwhelmed")?.kind).toBe("encourage");
  });

  it("explains concepts without treating them as schedule queries", () => {
    const diff = matchConversation(
      "what's the difference between a project and a checklist"
    );
    expect(diff?.kind).toBe("explain");
    expect(diff?.message.toLowerCase()).toMatch(/project/);
  });

  it("does not swallow productivity requests", () => {
    expect(matchConversation("remind me to call mom tomorrow")).toBeNull();
    expect(matchConversation("Help me plan tomorrow")).toBeNull();
    expect(matchConversation("what's left today")).toBeNull();
    expect(matchConversation("sure")).toBeNull();
    expect(matchConversation("ok")).toBeNull();
    expect(matchConversation("yeah")).toBeNull();
  });
});

describe("understandInput conversational path", () => {
  it("replies to imperfect and casual chat", () => {
    expect(understandInput("helo")).toMatchObject({ kind: "reply" });
    expect(understandInput("thx")).toMatchObject({ kind: "reply" });
    expect(understandInput("how r u")).toMatchObject({ kind: "reply" });
    expect(understandInput("im tired")).toMatchObject({ kind: "reply" });
  });

  it("still routes planning and creates to commands", () => {
    expect(understandInput("Help me plan tomorrow.")).toEqual({
      kind: "command",
      text: "plan my tomorrow",
    });
    expect(understandInput("What should I work on first?")).toEqual({
      kind: "command",
      text: "what should I work on first",
    });
  });
});

describe("detectStance smalltalk", () => {
  it("classifies how-are-you before query cues", () => {
    expect(detectStance("how are you").kind).toBe("smalltalk");
    expect(detectStance("thanks").kind).toBe("smalltalk");
  });

  it("keeps help-me-plan as command-capable", () => {
    expect(detectStance("help me plan tomorrow").kind).not.toBe("smalltalk");
  });
});

describe("suggestFollowUps conversation", () => {
  it("skips chips after pure greetings", () => {
    expect(
      suggestFollowUps({
        userMessage: "hey",
        assistantMessage: "Hi — I'm here.",
        toolNames: [],
        agentMode: "agent",
      })
    ).toEqual([]);
  });

  it("still suggests after schedule queries", () => {
    const tips = suggestFollowUps({
      userMessage: "what's left today",
      assistantMessage: "Here’s what’s open…",
      toolNames: ["query_schedule"],
      agentMode: "agent",
    });
    expect(tips.length).toBeGreaterThan(0);
  });
});

describe("isConversationalUtterance", () => {
  it("flags chat and not commands", () => {
    expect(isConversationalUtterance("hi")).toBe(true);
    expect(isConversationalUtterance("add milk")).toBe(false);
  });
});
