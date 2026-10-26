import { jsonError, jsonOk, rateLimit } from "@/lib/api";
import { generateDailyBriefing } from "@/lib/ai/agent";
import { requireAuth } from "@/lib/data/auth";
import { getProductivitySummary } from "@/lib/data/repository";

export async function GET() {
  try {
    const auth = await requireAuth();
    const rl = rateLimit(`briefing:${auth.userId}`, 10, 60_000);
    if (!rl.allowed) {
      const summary = await getProductivitySummary(auth);
      return jsonOk({
        briefing: `You have ${summary.today_tasks.length} tasks today and ${summary.overdue_tasks.length} overdue.`,
        summary,
        cached: true,
      });
    }
    const summary = await getProductivitySummary(auth);
    const briefing = await generateDailyBriefing(auth);
    return jsonOk({ briefing, summary });
  } catch (e) {
    return jsonError(e);
  }
}
