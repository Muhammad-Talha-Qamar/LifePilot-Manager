import { jsonError, jsonOk } from "@/lib/api";
import { getPreferences, savePreferences } from "@/lib/data/repository";
import { savePreferenceSchema } from "@/lib/validations/schemas";

export async function GET() {
  try {
    const prefs = await getPreferences();
    return jsonOk(prefs);
  } catch (e) {
    return jsonError(e);
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const input = savePreferenceSchema.parse(body);
    const prefs = await savePreferences(input);
    return jsonOk(prefs);
  } catch (e) {
    return jsonError(e);
  }
}
