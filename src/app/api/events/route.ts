import { jsonError, jsonOk } from "@/lib/api";
import { createEvent, listEvents } from "@/lib/data/repository";
import { createEventSchema } from "@/lib/validations/schemas";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const events = await listEvents({
      from: searchParams.get("from") ?? undefined,
      to: searchParams.get("to") ?? undefined,
      limit: searchParams.get("limit")
        ? Number(searchParams.get("limit"))
        : undefined,
    });
    return jsonOk(events);
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const input = createEventSchema.parse(body);
    const event = await createEvent(input);
    return jsonOk(event, { status: 201 });
  } catch (e) {
    return jsonError(e);
  }
}
