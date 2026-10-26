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

    // Prefer the durable roster/disk/blobs record when present.
    // If this serverless instance lost ephemeral demo files, still trust the
    // HMAC-signed session cookie so sign-up/sign-in don't bounce to /login.
    const user = await findDemoUserById(session.userId);
    const userId = user?.id ?? session.userId;
    const email = user?.email ?? session.email;
    const fullName = user?.full_name ?? session.fullName;
    const createdAt = user?.created_at;

    const store = await getDemoStore(userId, {
      email,
      fullName,
    });

    return {
      userId,
      email,
      isDemo: true,
      profile: {
        ...store.profile,
        email,
        full_name: fullName ?? store.profile.full_name,
        created_at: createdAt || store.profile.created_at,
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
