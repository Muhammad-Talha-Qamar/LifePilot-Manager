import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import {
  clearAllMemories,
  deleteMemory,
  listMemories,
  saveMemory,
  updateMemory,
} from "@/lib/data/memories";
import { memoryCategorySchema, updateMemorySchema } from "@/lib/validations/schemas";

const createBodySchema = z.object({
  category: memoryCategorySchema.default("preference"),
  content: z.string().trim().min(1).max(500),
  key: z.string().trim().min(1).max(64).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(16).optional(),
});

export async function GET() {
  try {
    const memories = await listMemories();
    return jsonOk({ memories });
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const input = createBodySchema.parse(body);
    const saved = await saveMemory(input);
    return jsonOk(saved);
  } catch (e) {
    return jsonError(e);
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const input = updateMemorySchema.parse(body);
    const { id, ...patch } = input;
    const updated = await updateMemory(id, patch);
    return jsonOk(updated);
  } catch (e) {
    return jsonError(e);
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const idParam = url.searchParams.get("id");
    const clearAllParam = url.searchParams.get("clear_all") === "true";

    if (clearAllParam) {
      const removed = await clearAllMemories();
      return jsonOk({ removed, cleared: true });
    }
    if (idParam) {
      await deleteMemory(idParam);
      return jsonOk({ removed: 1, id: idParam });
    }

    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    const parsed = z
      .object({
        id: z.string().uuid().optional(),
        clear_all: z.boolean().optional(),
      })
      .parse(body ?? {});

    if (parsed.clear_all) {
      const removed = await clearAllMemories();
      return jsonOk({ removed, cleared: true });
    }
    if (parsed.id) {
      await deleteMemory(parsed.id);
      return jsonOk({ removed: 1, id: parsed.id });
    }

    return jsonError(new Error("Provide id or clear_all to delete memories."));
  } catch (e) {
    return jsonError(e);
  }
}
