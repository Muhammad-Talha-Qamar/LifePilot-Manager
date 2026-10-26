import { jsonError, jsonOk } from "@/lib/api";
import { createTask, listTasks } from "@/lib/data/repository";
import { createTaskSchema, listTasksFilterSchema } from "@/lib/validations/schemas";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const filters = listTasksFilterSchema.parse({
      status: searchParams.get("status") ?? undefined,
      priority: searchParams.get("priority") ?? undefined,
      category: searchParams.get("category") ?? undefined,
      project_id: searchParams.get("project_id") ?? undefined,
      overdue_only: searchParams.get("overdue_only") === "true" ? true : undefined,
      query: searchParams.get("query") ?? undefined,
      limit: searchParams.get("limit")
        ? Number(searchParams.get("limit"))
        : undefined,
    });
    const tasks = await listTasks(filters);
    return jsonOk(tasks);
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const input = createTaskSchema.parse(body);
    const task = await createTask(input);
    return jsonOk(task, { status: 201 });
  } catch (e) {
    return jsonError(e);
  }
}
