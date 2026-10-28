import { isDemoMode } from "@/lib/config";
import { mutateDemoStore, getDemoStore } from "@/lib/demo/store";
import { createClient } from "@/lib/supabase/server";
import { generateId, nowIso } from "@/lib/utils";
import type { MemoryCategory, UserMemory } from "@/types";
import {
  MAX_MEMORIES_PER_USER,
  MAX_MEMORY_CONTENT,
  deriveMemoryTags,
  isSensitiveMemoryContent,
  suggestMemoryKey,
} from "@/lib/ai/memory";
import { NotFoundError, requireAuth, type AuthContext } from "./auth";

async function sb() {
  return createClient();
}

function normalizeMemories(raw: UserMemory[] | undefined, userId: string): UserMemory[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((m) => m && m.user_id === userId);
}

export async function listMemories(auth?: AuthContext): Promise<UserMemory[]> {
  const ctx = auth ?? (await requireAuth());
  if (ctx.isDemo || isDemoMode()) {
    const store = await getDemoStore(ctx.userId);
    return normalizeMemories(store.memories, ctx.userId).sort((a, b) =>
      b.updated_at.localeCompare(a.updated_at)
    );
  }

  const client = await sb();
  const { data, error } = await client
    .from("user_memories")
    .select("*")
    .eq("user_id", ctx.userId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as UserMemory[];
}

export interface SaveMemoryInput {
  category: MemoryCategory;
  content: string;
  key?: string | null;
  tags?: string[];
  /** When true, upsert by key if key is set. */
  replace_key?: boolean;
}

export async function saveMemory(
  input: SaveMemoryInput,
  auth?: AuthContext
): Promise<UserMemory> {
  const ctx = auth ?? (await requireAuth());
  const content = input.content.trim().slice(0, MAX_MEMORY_CONTENT);
  if (!content) {
    throw new Error("Memory content is required.");
  }
  if (isSensitiveMemoryContent(content)) {
    throw new Error(
      "That looks like sensitive information. I won't store passwords, keys, or financial identifiers."
    );
  }

  const key =
    suggestMemoryKey(input.category, content, input.key) ??
    (input.key?.trim()
      ? input.key
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9_]+/g, "_")
          .slice(0, 64)
      : null);
  const tags = deriveMemoryTags(content, input.tags ?? []);
  const now = nowIso();

  const existing = await listMemories(ctx);
  const byKey = key ? existing.find((m) => m.key === key) : undefined;

  if (byKey) {
    const updated: UserMemory = {
      ...byKey,
      category: input.category,
      content,
      tags,
      updated_at: now,
    };
    return persistMemory(updated, ctx, { replaceId: byKey.id });
  }

  if (existing.length >= MAX_MEMORIES_PER_USER) {
    throw new Error(
      `You already have ${MAX_MEMORIES_PER_USER} saved memories. Delete one before adding another.`
    );
  }

  const created: UserMemory = {
    id: generateId(),
    user_id: ctx.userId,
    category: input.category,
    key,
    content,
    tags,
    created_at: now,
    updated_at: now,
  };
  return persistMemory(created, ctx, { insert: true });
}

async function persistMemory(
  memory: UserMemory,
  ctx: AuthContext,
  options: { insert?: boolean; replaceId?: string }
): Promise<UserMemory> {
  if (memory.user_id !== ctx.userId) {
    throw new Error("Memory user mismatch.");
  }

  if (ctx.isDemo || isDemoMode()) {
    await mutateDemoStore(ctx.userId, (store) => {
      const list = normalizeMemories(store.memories, ctx.userId);
      if (options.replaceId) {
        store.memories = list.map((m) => (m.id === options.replaceId ? memory : m));
      } else {
        store.memories = [memory, ...list];
      }
    });
    return memory;
  }

  const client = await sb();
  if (options.replaceId) {
    const { data, error } = await client
      .from("user_memories")
      .update({
        category: memory.category,
        content: memory.content,
        tags: memory.tags,
        key: memory.key,
        updated_at: memory.updated_at,
      })
      .eq("id", options.replaceId)
      .eq("user_id", ctx.userId)
      .select()
      .single();
    if (error) throw error;
    return data as UserMemory;
  }

  const row = {
    id: memory.id,
    user_id: ctx.userId,
    category: memory.category,
    key: memory.key,
    content: memory.content,
    tags: memory.tags,
    created_at: memory.created_at,
    updated_at: memory.updated_at,
  };

  // Upsert only when a stable key is set; null keys allow multiple free-form notes.
  if (memory.key) {
    const { data, error } = await client
      .from("user_memories")
      .upsert(row, { onConflict: "user_id,key" })
      .select()
      .single();
    if (error) throw error;
    return data as UserMemory;
  }

  const { data, error } = await client.from("user_memories").insert(row).select().single();
  if (error) throw error;
  return data as UserMemory;
}

export async function updateMemory(
  id: string,
  patch: { content?: string; category?: MemoryCategory; tags?: string[] },
  auth?: AuthContext
): Promise<UserMemory> {
  const ctx = auth ?? (await requireAuth());
  const existing = await listMemories(ctx);
  const current = existing.find((m) => m.id === id);
  if (!current) throw new NotFoundError("Memory not found");

  const content = (patch.content ?? current.content).trim().slice(0, MAX_MEMORY_CONTENT);
  if (!content) throw new Error("Memory content is required.");
  if (isSensitiveMemoryContent(content)) {
    throw new Error(
      "That looks like sensitive information. I won't store passwords, keys, or financial identifiers."
    );
  }

  const updated: UserMemory = {
    ...current,
    content,
    category: patch.category ?? current.category,
    tags: patch.tags ? deriveMemoryTags(content, patch.tags) : deriveMemoryTags(content, current.tags),
    updated_at: nowIso(),
  };
  return persistMemory(updated, ctx, { replaceId: id });
}

export async function deleteMemory(id: string, auth?: AuthContext): Promise<void> {
  const ctx = auth ?? (await requireAuth());

  if (ctx.isDemo || isDemoMode()) {
    let found = false;
    await mutateDemoStore(ctx.userId, (store) => {
      const list = normalizeMemories(store.memories, ctx.userId);
      const next = list.filter((m) => m.id !== id);
      found = next.length !== list.length;
      store.memories = next;
    });
    if (!found) throw new NotFoundError("Memory not found");
    return;
  }

  const client = await sb();
  const { data, error } = await client
    .from("user_memories")
    .delete()
    .eq("id", id)
    .eq("user_id", ctx.userId)
    .select("id");
  if (error) throw error;
  if (!data?.length) throw new NotFoundError("Memory not found");
}

export async function deleteMemoriesByIds(
  ids: string[],
  auth?: AuthContext
): Promise<number> {
  const ctx = auth ?? (await requireAuth());
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return 0;

  if (ctx.isDemo || isDemoMode()) {
    let removed = 0;
    await mutateDemoStore(ctx.userId, (store) => {
      const list = normalizeMemories(store.memories, ctx.userId);
      const idSet = new Set(unique);
      const next = list.filter((m) => {
        if (idSet.has(m.id)) {
          removed += 1;
          return false;
        }
        return true;
      });
      store.memories = next;
    });
    return removed;
  }

  const client = await sb();
  const { data, error } = await client
    .from("user_memories")
    .delete()
    .eq("user_id", ctx.userId)
    .in("id", unique)
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

export async function clearAllMemories(auth?: AuthContext): Promise<number> {
  const ctx = auth ?? (await requireAuth());
  const existing = await listMemories(ctx);
  if (!existing.length) return 0;
  return deleteMemoriesByIds(
    existing.map((m) => m.id),
    ctx
  );
}
