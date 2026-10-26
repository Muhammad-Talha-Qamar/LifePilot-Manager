import { jsonError, jsonOk } from "@/lib/api";
import {
  completeTask,
  deleteTask,
  getTask,
  updateTask,
} from "@/lib/data/repository";
import { updateTaskSchema } from "@/lib/validations/schemas";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const task = await getTask(id);
    return jsonOk(task);
  } catch (e) {
    return jsonError(e);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const body = await request.json();
    if (body?.action === "complete") {
      const task = await completeTask(id);
      return jsonOk(task);
    }
    const input = updateTaskSchema.parse({ ...body, id });
    const { id: _id, ...patch } = input;
    void _id;
    const task = await updateTask(id, patch);
    return jsonOk(task);
  } catch (e) {
    return jsonError(e);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    await deleteTask(id);
    return jsonOk({ deleted: true, id });
  } catch (e) {
    return jsonError(e);
  }
}
