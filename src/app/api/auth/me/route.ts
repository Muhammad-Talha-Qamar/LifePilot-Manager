import { jsonError, jsonOk } from "@/lib/api";
import { AuthError, requireAuth } from "@/lib/data/auth";
import { updateProfileAvatar } from "@/lib/data/repository";
import { updateProfileAvatarSchema } from "@/lib/validations/schemas";

export async function GET() {
  try {
    const ctx = await requireAuth();
    return jsonOk({
      id: ctx.userId,
      email: ctx.email,
      full_name: ctx.profile.full_name,
      avatar_url: ctx.profile.avatar_url,
      isDemo: ctx.isDemo,
      timezone: ctx.profile.timezone,
      created_at: ctx.profile.created_at,
      updated_at: ctx.profile.updated_at,
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return jsonError(e, 401);
    }
    return jsonError(e);
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const input = updateProfileAvatarSchema.parse(body);
    const profile = await updateProfileAvatar(input.avatar_url);
    return jsonOk({
      id: profile.id,
      email: profile.email,
      full_name: profile.full_name,
      avatar_url: profile.avatar_url,
      timezone: profile.timezone,
      created_at: profile.created_at,
      updated_at: profile.updated_at,
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return jsonError(e, 401);
    }
    return jsonError(e);
  }
}
