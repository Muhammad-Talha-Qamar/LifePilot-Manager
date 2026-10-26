import { jsonError, jsonOk } from "@/lib/api";
import {
  deleteChecklist,
  manageChecklistItem,
  updateChecklist,
} from "@/lib/data/repository";
import {
  manageChecklistItemsSchema,
  updateChecklistSchema,
} from "@/lib/validations/schemas";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const body = await request.json();

    if (body?.itemAction) {
      const input = manageChecklistItemsSchema.parse({
        ...body,
        checklist_id: id,
        action: body.itemAction,
      });
      const result = await manageChecklistItem(input);
      return jsonOk(result);
    }

    const input = updateChecklistSchema.parse({ ...body, id });
    const { id: _id, ...patch } = input;
    void _id;
    const checklist = await updateChecklist(id, patch);
    return jsonOk(checklist);
  } catch (e) {
    return jsonError(e);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    await deleteChecklist(id);
    return jsonOk({ deleted: true, id });
  } catch (e) {
    return jsonError(e);
  }
}
