import { NextResponse } from "next/server";
import { isDemoMode, isSupabaseConfigured } from "@/lib/config";
import { clearSessionCookie } from "@/lib/auth/session";
import { jsonOk } from "@/lib/api";
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
  return clearSessionCookie(response);
}
