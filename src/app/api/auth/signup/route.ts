import { isDemoMode, isSupabaseConfigured } from "@/lib/config";
import { applySessionCookie } from "@/lib/auth/session";
import { jsonError, jsonOk, rateLimit } from "@/lib/api";
import { ensureEmptyDemoStore } from "@/lib/demo/store";
import { createDemoUser } from "@/lib/demo/users";
import { ValidationError } from "@/lib/data/auth";

export async function POST(request: Request) {
  try {
    const ip = request.headers.get("x-forwarded-for") ?? "local";
    const limit = rateLimit(`signup:${ip}`, 10, 60_000);
    if (!limit.allowed) {
      return jsonError(new ValidationError("Too many sign-up attempts. Try again shortly."), 429);
    }

    const body = (await request.json()) as {
      email?: string;
      password?: string;
      fullName?: string;
    };

    const email = body.email?.trim() ?? "";
    const password = body.password ?? "";
    const fullName = body.fullName?.trim() || null;

    if (!email || !password) {
      throw new ValidationError("Email and password are required.");
    }

    // When Supabase is live, the browser client signs up directly.
    // This route is for local/demo accounts (empty board on create).
    if (!isDemoMode() && isSupabaseConfigured()) {
      return jsonError(
        new ValidationError("Use the sign-up form with Supabase authentication."),
        400
      );
    }

    const user = await createDemoUser({ email, password, fullName });
    await ensureEmptyDemoStore(user.id, user.email, user.full_name);

    const response = jsonOk({
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
      },
    });

    return await applySessionCookie(response, {
      userId: user.id,
      email: user.email,
      fullName: user.full_name,
    });
  } catch (e) {
    return jsonError(e);
  }
}
