import { jsonError, jsonOk } from "@/lib/api";
import {
  createChecklist,
  getChecklistItems,
  listChecklists,
} from "@/lib/data/repository";
import { createChecklistSchema } from "@/lib/validations/schemas";

export async function GET() {
  try {
    const checklists = await listChecklists();
    const withProgress = await Promise.all(
      checklists.map(async (c) => {
        const items = await getChecklistItems(c.id);
        const completed = items.filter((i) => i.is_completed).length;
        return {
          ...c,
          items,
          progress: {
            total: items.length,
            completed,
            percent:
              items.length === 0
                ? 0
                : Math.round((completed / items.length) * 100),
          },
        };
      })
    );
    return jsonOk(withProgress);
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const input = createChecklistSchema.parse(body);
    const result = await createChecklist(input);
    return jsonOk(result, { status: 201 });
  } catch (e) {
    return jsonError(e);
  }
}
