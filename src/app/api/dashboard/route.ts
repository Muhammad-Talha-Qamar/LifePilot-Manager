import { jsonError, jsonOk } from "@/lib/api";
import { requireAuth } from "@/lib/data/auth";
import {
  getChecklistItems,
  getProductivitySummary,
  listChecklists,
  listProjects,
  listReminders,
  listTasks,
} from "@/lib/data/repository";
import { projectProgress } from "@/lib/utils/progress";
import { isDemoMode, isOpenAIConfigured } from "@/lib/config";

export async function GET() {
  try {
    const auth = await requireAuth();
    const summary = await getProductivitySummary(auth);
    const projects = await listProjects(auth);
    const tasks = await listTasks({}, auth);
    const checklists = await listChecklists(auth);
    const reminders = await listReminders(auth);

    const projectsWithProgress = await Promise.all(
      projects.map(async (p) => {
        const pTasks = tasks.filter((t) => t.project_id === p.id);
        const pChecklists = checklists.filter((c) => c.project_id === p.id);
        const items = (
          await Promise.all(pChecklists.map((c) => getChecklistItems(c.id, auth)))
        ).flat();
        return { ...p, progress: projectProgress(pTasks, items) };
      })
    );

    return jsonOk({
      profile: auth.profile,
      isDemo: auth.isDemo || isDemoMode(),
      openaiConfigured: isOpenAIConfigured(),
      summary,
      projects: projectsWithProgress,
      reminders: reminders.slice(0, 8),
    });
  } catch (e) {
    return jsonError(e);
  }
}
