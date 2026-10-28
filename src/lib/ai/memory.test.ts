import { beforeEach, describe, expect, it } from "vitest";
import type { UserMemory } from "@/types";
import {
  clearAllMemories,
  deleteMemory,
  listMemories,
  saveMemory,
  updateMemory,
} from "@/lib/data/memories";
import { clearDemoStore, getDemoStore } from "@/lib/demo/store";
import type { AuthContext } from "@/lib/data/auth";
import {
  detectMemoryIntent,
  formatMemoriesForPrompt,
  isSensitiveMemoryContent,
  matchMemoriesForForget,
  retrieveRelevantMemories,
  scoreMemoryRelevance,
  suggestMemoryKey,
} from "./memory";

function memory(
  partial: Partial<UserMemory> & Pick<UserMemory, "id" | "content" | "category">
): UserMemory {
  return {
    user_id: "user-a",
    key: null,
    tags: [],
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-01T00:00:00.000Z",
    ...partial,
  };
}

const authA: AuthContext = {
  userId: "memory-test-user-a",
  email: "a@test.local",
  isDemo: true,
  profile: {
    id: "memory-test-user-a",
    email: "a@test.local",
    full_name: "User A",
    avatar_url: null,
    timezone: "UTC",
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-01T00:00:00.000Z",
  },
};

const authB: AuthContext = {
  ...authA,
  userId: "memory-test-user-b",
  email: "b@test.local",
  profile: {
    ...authA.profile,
    id: "memory-test-user-b",
    email: "b@test.local",
    full_name: "User B",
  },
};

describe("memory intent detection", () => {
  it("saves explicit preferences, not casual task reminders", () => {
    expect(detectMemoryIntent("Remember that I prefer concise task summaries")).toMatchObject({
      kind: "save",
      category: "preference",
      key: "summary_length",
    });
    expect(detectMemoryIntent("remember to buy milk")).toEqual({ kind: "none" });
    expect(detectMemoryIntent("from now on keep replies short")).toMatchObject({
      kind: "save",
      category: "preference",
      key: "summary_length",
    });
    expect(detectMemoryIntent("I prefer a casual tone")).toMatchObject({
      kind: "save",
      category: "preference",
      key: "tone",
    });
  });

  it("detects list and forget intents", () => {
    expect(detectMemoryIntent("what do you remember about me?")).toEqual({ kind: "list" });
    expect(detectMemoryIntent("forget my preference about concise summaries")).toMatchObject({
      kind: "forget",
      forgetQuery: "concise summaries",
    });
    expect(detectMemoryIntent("clear all my memories")).toMatchObject({
      kind: "forget",
      forgetQuery: "*",
    });
  });
});

describe("memory retrieval and accuracy", () => {
  it("always includes preferences and only relevant context notes", () => {
    const memories = [
      memory({
        id: "1",
        category: "preference",
        key: "summary_length",
        content: "Prefer concise task summaries",
        tags: ["concise", "summaries"],
        updated_at: "2026-10-20T00:00:00.000Z",
      }),
      memory({
        id: "2",
        category: "context",
        content: "Working on CS220 final paper about databases",
        tags: ["cs220", "paper", "databases"],
        updated_at: "2026-10-21T00:00:00.000Z",
      }),
      memory({
        id: "3",
        category: "context",
        content: "Training for a half marathon in March",
        tags: ["marathon", "training"],
        updated_at: "2026-10-22T00:00:00.000Z",
      }),
    ];

    const forPaper = retrieveRelevantMemories(memories, "How is my CS220 paper going?");
    expect(forPaper.preferences).toHaveLength(1);
    expect(forPaper.context.map((m) => m.id)).toEqual(["2"]);
    expect(forPaper.context.map((m) => m.id)).not.toContain("3");

    const greeting = retrieveRelevantMemories(memories, "hi");
    expect(greeting.preferences).toHaveLength(1);
    expect(greeting.context).toHaveLength(0);
  });

  it("prefers the most recent memory when keys conflict", () => {
    const memories = [
      memory({
        id: "old",
        category: "preference",
        key: "summary_length",
        content: "Prefer long detailed summaries",
        updated_at: "2026-10-01T00:00:00.000Z",
      }),
      memory({
        id: "new",
        category: "preference",
        key: "summary_length",
        content: "Prefer concise summaries",
        updated_at: "2026-10-28T00:00:00.000Z",
      }),
    ];
    const retrieved = retrieveRelevantMemories(memories, "summarize my tasks");
    expect(retrieved.preferences).toHaveLength(1);
    expect(retrieved.preferences[0].id).toBe("new");
  });

  it("formats prompt text that forbids inventing memories", () => {
    const empty = formatMemoriesForPrompt({ preferences: [], context: [], all: [] });
    expect(empty).toMatch(/Never invent memories/i);

    const filled = formatMemoriesForPrompt(
      retrieveRelevantMemories(
        [
          memory({
            id: "1",
            category: "preference",
            key: "tone",
            content: "Keep a warm direct tone",
          }),
        ],
        "hello"
      )
    );
    expect(filled).toMatch(/Keep a warm direct tone/);
    expect(filled).toMatch(/NOT a source of truth for task status/i);
  });

  it("blocks sensitive content and scores relevance", () => {
    expect(isSensitiveMemoryContent("my password is hunter2")).toBe(true);
    expect(isSensitiveMemoryContent("Prefer concise summaries")).toBe(false);
    expect(suggestMemoryKey("preference", "I like a casual tone")).toBe("tone");
    expect(suggestMemoryKey("preference", "I like brief replies")).toBe("summary_length");

    const pref = memory({
      id: "1",
      category: "preference",
      content: "Prefer concise summaries",
    });
    const ctx = memory({
      id: "2",
      category: "context",
      content: "CS220 databases paper",
      tags: ["cs220"],
    });
    expect(scoreMemoryRelevance(pref, "anything")).toBeGreaterThan(0);
    expect(scoreMemoryRelevance(ctx, "cs220 deadline")).toBeGreaterThan(0);
    expect(scoreMemoryRelevance(ctx, "grocery shopping")).toBe(0);
  });

  it("matches forget queries without resurrecting unrelated notes", () => {
    const memories = [
      memory({
        id: "1",
        category: "preference",
        key: "summary_length",
        content: "Prefer concise task summaries",
        tags: ["concise", "summaries"],
      }),
      memory({
        id: "2",
        category: "context",
        content: "CS220 paper",
        tags: ["cs220"],
      }),
    ];
    expect(matchMemoriesForForget(memories, "concise").map((m) => m.id)).toEqual(["1"]);
    expect(matchMemoriesForForget(memories, "*")).toHaveLength(2);
  });
});

describe("memory persistence, updates, deletion, and isolation", () => {
  beforeEach(async () => {
    await clearDemoStore(authA.userId, authA.email, "User A");
    await clearDemoStore(authB.userId, authB.email, "User B");
  });

  it("persists preferences across calls and updates by key", async () => {
    const first = await saveMemory(
      {
        category: "preference",
        content: "Prefer concise task summaries",
        key: "summary_length",
      },
      authA
    );
    expect(first.key).toBe("summary_length");

    const listed = await listMemories(authA);
    expect(listed).toHaveLength(1);
    expect(listed[0].content).toMatch(/concise/i);

    const updated = await saveMemory(
      {
        category: "preference",
        content: "Prefer brief bullet summaries",
        key: "summary_length",
      },
      authA
    );
    expect(updated.id).toBe(first.id);
    const after = await listMemories(authA);
    expect(after).toHaveLength(1);
    expect(after[0].content).toMatch(/brief bullet/i);
  });

  it("supports edit and delete without reintroducing removed memories", async () => {
    const saved = await saveMemory(
      { category: "preference", content: "Keep replies short" },
      authA
    );
    const edited = await updateMemory(saved.id, { content: "Keep replies very short" }, authA);
    expect(edited.content).toBe("Keep replies very short");

    await deleteMemory(saved.id, authA);
    expect(await listMemories(authA)).toHaveLength(0);

    const store = await getDemoStore(authA.userId);
    expect(store.memories).toHaveLength(0);
  });

  it("clears all memories and rejects sensitive saves", async () => {
    await saveMemory({ category: "context", content: "Working on thesis draft" }, authA);
    await saveMemory({ category: "preference", content: "Prefer priority-first planning" }, authA);
    expect(await clearAllMemories(authA)).toBe(2);
    expect(await listMemories(authA)).toHaveLength(0);

    await expect(
      saveMemory({ category: "preference", content: "password is hunter2" }, authA)
    ).rejects.toThrow(/sensitive/i);
  });

  it("isolates memories between users", async () => {
    await saveMemory(
      { category: "preference", content: "User A likes concise summaries" },
      authA
    );
    await saveMemory(
      { category: "preference", content: "User B likes detailed summaries" },
      authB
    );

    const a = await listMemories(authA);
    const b = await listMemories(authB);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0].content).toMatch(/User A/);
    expect(b[0].content).toMatch(/User B/);
    expect(a[0].user_id).toBe(authA.userId);
    expect(b[0].user_id).toBe(authB.userId);
  });

  it("does not treat missing memories as invented knowledge", async () => {
    expect(await listMemories(authA)).toEqual([]);
    const prompt = formatMemoriesForPrompt({ preferences: [], context: [], all: [] });
    expect(prompt).toMatch(/No confirmed preferences/i);
    expect(prompt).not.toMatch(/User A likes/i);
  });
});
