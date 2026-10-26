import { jsonError, jsonOk } from "@/lib/api";
import {
  createProject,
  getChecklistItems,
  listChecklists,
  listProjects,
  listTasks,
} from "@/lib/data/repository";
import { projectProgress } from "@/lib/utils/progress";
import { createProjectSchema } from "@/lib/validations/schemas";

export async function GET() {
  try {
    const projects = await listProjects();
    const tasks = await listTasks({});
    const checklists = await listChecklists();
    const enriched = await Promise.all(
      projects.map(async (p) => {
        const pTasks = tasks.filter((t) => t.project_id === p.id);
        const pChecklists = checklists.filter((c) => c.project_id === p.id);
        const items = (
          await Promise.all(pChecklists.map((c) => getChecklistItems(c.id)))
        ).flat();
        return {
          ...p,
          task_count: pTasks.length,
          checklist_count: pChecklists.length,
          progress: projectProgress(pTasks, items),
        };
      })
    );
    return jsonOk(enriched);
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const input = createProjectSchema.parse(body);
    const project = await createProject(input);
    return jsonOk(project, { status: 201 });
  } catch (e) {
    return jsonError(e);
  }
}
