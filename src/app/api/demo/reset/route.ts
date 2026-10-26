import { isDemoMode } from "@/lib/config";
import { jsonError, jsonOk } from "@/lib/api";
import { resetDemoStore } from "@/lib/demo/store";

export async function POST() {
  try {
    if (!isDemoMode()) {
      return jsonError(
        new Error("Demo reset is only available in demo mode."),
        400
      );
    }
    const store = await resetDemoStore();
    return jsonOk({
      reset: true,
      message: "Demo data restored to seed state. Changes were never saved to Supabase.",
      taskCount: store.tasks.length,
    });
  } catch (e) {
    return jsonError(e);
  }
}
