import { isDemoMode } from "@/lib/config";
import { jsonError, jsonOk } from "@/lib/api";
import { requireAuth } from "@/lib/data/auth";
import { clearDemoStore, loadSampleDemoStore } from "@/lib/demo/store";

export async function POST(request: Request) {
  try {
    if (!isDemoMode()) {
      return jsonError(
        new Error("Demo reset is only available in demo mode."),
        400
      );
    }

    const ctx = await requireAuth();
    const body = (await request.json().catch(() => ({}))) as {
      sample?: boolean;
    };

    const store = body.sample
      ? await loadSampleDemoStore(
          ctx.userId,
          ctx.email,
          ctx.profile.full_name
        )
      : await clearDemoStore(ctx.userId, ctx.email, ctx.profile.full_name);

    return jsonOk({
      reset: true,
      sample: Boolean(body.sample),
      message: body.sample
        ? "Sample tasks and checklists loaded for exploration."
        : "Your board is empty again.",
      taskCount: store.tasks.length,
      checklistCount: store.checklists.length,
    });
  } catch (e) {
    return jsonError(e);
  }
}
