import { isDemoMode, isSupabaseConfigured } from "@/lib/config";
import { applySessionCookie } from "@/lib/auth/session";
import { jsonError, jsonOk, rateLimit } from "@/lib/api";
import { getDemoStore } from "@/lib/demo/store";
import { attachRosterCookie } from "@/lib/demo/roster-cookie";
import { authenticateDemoUser, takeLastRosterToken } from "@/lib/demo/users";
import { ValidationError } from "@/lib/data/auth";

export async function POST(request: Request) {
  try {
    const ip = request.headers.get("x-forwarded-for") ?? "local";
    const limit = rateLimit(`login:${ip}`, 20, 60_000);
    if (!limit.allowed) {
      return jsonError(new ValidationError("Too many sign-in attempts. Try again shortly."), 429);
    }

    const body = (await request.json()) as {
      email?: string;
      password?: string;
    };

    const email = body.email?.trim() ?? "";
    const password = body.password ?? "";

    if (!email || !password) {
      throw new ValidationError("Email and password are required.");
    }

    if (!isDemoMode() && isSupabaseConfigured()) {
      return jsonError(
        new ValidationError("Use the sign-in form with Supabase authentication."),
        400
      );
    }

    const user = await authenticateDemoUser(email, password);
    await getDemoStore(user.id, { email: user.email, fullName: user.full_name });

    let response = jsonOk({
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
      },
    });

    response = await applySessionCookie(response, {
      userId: user.id,
      email: user.email,
      fullName: user.full_name,
    });

    const roster = takeLastRosterToken();
    if (roster) response = attachRosterCookie(response, roster);

    return response;
  } catch (e) {
    if (e instanceof Error && e.message === "Invalid email or password.") {
      return jsonError(new ValidationError(e.message), 401);
    }
    return jsonError(e);
  }
}
