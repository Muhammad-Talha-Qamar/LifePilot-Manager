import { isDemoMode, isSupabaseConfigured } from "@/lib/config";
import { clearSessionCookie, sessionCookieOptions } from "@/lib/auth/session";
import { jsonOk } from "@/lib/api";
import { ROSTER_COOKIE } from "@/lib/demo/roster-cookie";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  if (!isDemoMode() && isSupabaseConfigured()) {
    try {
      const supabase = await createClient();
      await supabase.auth.signOut();
    } catch {
      // still clear local cookie below
    }
  }

  const response = jsonOk({ signedOut: true });
  clearSessionCookie(response);
  response.cookies.set(ROSTER_COOKIE, "", {
    ...sessionCookieOptions(0),
    maxAge: 0,
  });
  return response;
}
