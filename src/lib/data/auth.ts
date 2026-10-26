import { DEFAULT_TIMEZONE, isDemoMode } from "@/lib/config";
import { readSessionFromCookies } from "@/lib/auth/session";
import { getDemoStore } from "@/lib/demo/store";
import { findDemoUserById } from "@/lib/demo/users";
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
    const session = await readSessionFromCookies();
    if (!session) {
      throw new AuthError("Authentication required");
    }

    const user = await findDemoUserById(session.userId);
    if (!user) {
      throw new AuthError("Authentication required");
    }

    const store = await getDemoStore(user.id, {
      email: user.email,
      fullName: user.full_name,
    });

    return {
      userId: user.id,
      email: user.email,
      isDemo: true,
      // Prefer signup time over store reset timestamps
      profile: {
        ...store.profile,
        email: user.email,
        full_name: user.full_name ?? store.profile.full_name,
        created_at: user.created_at || store.profile.created_at,
      },
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
