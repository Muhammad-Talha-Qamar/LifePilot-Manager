import { jsonError, jsonOk } from "@/lib/api";
import {
  createReminderFromDueItems,
  listReminders,
  markReminderRead,
} from "@/lib/data/repository";

export async function GET() {
  try {
    await createReminderFromDueItems();
    const reminders = await listReminders();
    return jsonOk(reminders);
  } catch (e) {
    return jsonError(e);
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    if (!body?.id) {
      return jsonError(new Error("id required"), 400);
    }
    const reminder = await markReminderRead(body.id);
    return jsonOk(reminder);
  } catch (e) {
    return jsonError(e);
  }
}
