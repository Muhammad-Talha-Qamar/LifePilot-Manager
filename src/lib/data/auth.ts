import { DEFAULT_TIMEZONE, DEMO_USER_EMAIL, DEMO_USER_ID, isDemoMode } from "@/lib/config";
import { getDemoStore } from "@/lib/demo/store";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/types";

export interface AuthContext {
  userId: string;
  email: string;
  isDemo: boolean;
  profile: Profile;
}

export async function requireAuth(): Promise<AuthContext> {
  if (isDemoMode()) {
    const store = await getDemoStore();
    return {
      userId: DEMO_USER_ID,
      email: DEMO_USER_EMAIL,
      isDemo: true,
      profile: store.profile,
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new AuthError("Authentication required");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return {
    userId: user.id,
    email: user.email ?? "",
    isDemo: false,
    profile: (profile as Profile) ?? {
      id: user.id,
      email: user.email ?? "",
      full_name: null,
      avatar_url: null,
      timezone: DEFAULT_TIMEZONE,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  };
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}
