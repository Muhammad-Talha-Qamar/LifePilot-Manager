import { jsonError, jsonOk } from "@/lib/api";
import { deleteProject, updateProject } from "@/lib/data/repository";
import { updateProjectSchema } from "@/lib/validations/schemas";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const body = await request.json();
    const input = updateProjectSchema.parse({ ...body, id });
    const { id: _id, ...patch } = input;
    void _id;
    const project = await updateProject(id, patch);
    return jsonOk(project);
  } catch (e) {
    return jsonError(e);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    await deleteProject(id);
    return jsonOk({ deleted: true, id });
  } catch (e) {
    return jsonError(e);
  }
}
