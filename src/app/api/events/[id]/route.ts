import { jsonError, jsonOk } from "@/lib/api";
import { deleteEvent, updateEvent } from "@/lib/data/repository";
import { updateEventSchema } from "@/lib/validations/schemas";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const body = await request.json();
    const input = updateEventSchema.parse({ ...body, id });
    const { id: _id, ...patch } = input;
    void _id;
    const event = await updateEvent(id, patch);
    return jsonOk(event);
  } catch (e) {
    return jsonError(e);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    await deleteEvent(id);
    return jsonOk({ deleted: true, id });
  } catch (e) {
    return jsonError(e);
  }
}
