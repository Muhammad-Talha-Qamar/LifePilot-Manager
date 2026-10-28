import { z } from "zod";
import { jsonError, jsonOk, rateLimit } from "@/lib/api";
import { runAgent, type AgentResult } from "@/lib/ai/agent";
import { humanizeError } from "@/lib/ai/user-messages";
import { requireAuth } from "@/lib/data/auth";

const entitySchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().min(1).max(300),
});

const contextSchema = z.object({
  lastProject: z
    .object({ id: z.string().min(1).max(80), name: z.string().min(1).max(300) })
    .nullable()
    .optional(),
  lastChecklist: z
    .object({ id: z.string().min(1).max(80), title: z.string().min(1).max(300) })
    .nullable()
    .optional(),
  lastTasks: z.array(entitySchema).max(30).optional(),
  lastItems: z
    .array(
      z.object({
        id: z.string().min(1).max(80),
        title: z.string().min(1).max(300),
        checklist_id: z.string().min(1).max(80),
      })
    )
    .max(80)
    .optional(),
  focus: z
    .object({
      kind: z.enum(["task", "project", "checklist", "event"]),
      id: z.string().min(1).max(80),
      label: z.string().min(1).max(300),
      detail: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  pending: z
    .object({
      tool: z.string().min(1).max(80),
      args: z.record(z.string(), z.unknown()),
      summary: z.string().max(500),
    })
    .nullable()
    .optional(),
  pendingClarification: z
    .object({
      question: z.string().max(1000),
      target: z.discriminatedUnion("type", [
        z.object({
          type: z.literal("task"),
          id: z.string(),
          field: z.literal("due_date"),
        }),
        z.object({
          type: z.literal("project"),
          id: z.string(),
          field: z.literal("deadline"),
        }),
        z.object({
          type: z.literal("create_task"),
          title: z.string().min(1).max(300),
        }),
      ]),
      options: z.array(z.object({ label: z.string(), date: z.string() })).max(4),
    })
    .nullable()
    .optional(),
  undo: z
    .array(
      z.object({
        label: z.string().max(300),
        tool: z.string().max(80),
        args: z.record(z.string(), z.unknown()),
      })
    )
    .max(8)
    .optional(),
  pendingInterpretation: z
    .object({
      question: z.string().max(500),
      acceptedText: z.string().max(800),
    })
    .nullable()
    .optional(),
});

const bodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(8000),
      })
    )
    .max(40)
    .optional(),
  context: contextSchema.optional(),
  confirm: z
    .object({
      tool: z.string().min(1).max(80),
      args: z.record(z.string(), z.unknown()),
    })
    .optional(),
  dismissPending: z.boolean().optional(),
  stream: z.boolean().optional(),
  agentMode: z.enum(["agent", "plan", "ask"]).optional(),
  customInstructions: z.string().max(2000).optional(),
});

function sseEncode(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function publicResult(result: AgentResult) {
  return {
    message: result.message,
    blocks: result.blocks,
    context: result.context,
    toolCalls: result.toolCalls.map((call) => ({
      name: call.name,
      success: call.success,
    })),
    mode: result.mode,
    agentMode: result.agentMode,
    followUps: result.followUps ?? [],
    openaiConfigured: result.openaiConfigured,
    error: result.error ? humanizeError(result.error) : undefined,
    // Keep a server-side diagnostic code available without dumping stacks to users.
    diagnostic: result.error && result.error !== humanizeError(result.error) ? result.error : undefined,
  };
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuth();
    const rl = rateLimit(`ai:${auth.userId}`, 30, 60_000);
    if (!rl.allowed) {
      return jsonError(new Error("I'm getting a lot of requests right now. Please try again in a minute."), 429);
    }

    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 200_000) {
      return jsonError(new Error("That message is too large to send."), 413);
    }

    const json = await request.json();
    const body = bodySchema.parse(json);
    if (!body.confirm && !body.dismissPending && !body.messages?.length) {
      return jsonError(new Error("Please type a message first."), 400);
    }

    const agentOptions = {
      context: body.context,
      confirm: body.confirm,
      dismissPending: body.dismissPending,
      agentMode: body.agentMode,
      customInstructions: body.customInstructions,
      signal: request.signal,
    };

    if (!body.stream) {
      const result = await runAgent(body.messages ?? [], auth, agentOptions);
      return jsonOk(publicResult(result));
    }

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: string, data: unknown) => {
          try {
            controller.enqueue(sseEncode(event, data));
          } catch {
            // Client disconnected.
          }
        };

        try {
          const result = await runAgent(body.messages ?? [], auth, {
            ...agentOptions,
            onEvent: (event) => {
              if (event.type === "status") send("status", { status: event.status });
              if (event.type === "delta") send("delta", { text: event.text });
              if (event.type === "tool") {
                send("tool", {
                  name: event.name,
                  label: event.label,
                  status: event.status,
                });
              }
            },
          });
          send("done", publicResult(result));
        } catch (error) {
          const raw = error instanceof Error ? error.message : "Request failed";
          console.error("[api/ai/chat]", raw);
          send("error", {
            message: humanizeError(raw),
            diagnostic: raw !== humanizeError(raw) ? raw : undefined,
          });
        } finally {
          try {
            controller.close();
          } catch {
            // Already closed.
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    if (error instanceof Error) {
      const friendly = humanizeError(error.message);
      if (friendly !== error.message) {
        console.error("[api/ai/chat]", error.message);
        return jsonError(new Error(friendly));
      }
    }
    return jsonError(error);
  }
}
