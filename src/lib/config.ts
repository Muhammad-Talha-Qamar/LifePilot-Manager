/**
 * Runtime configuration. Secrets are only read on the server.
 */

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
      !process.env.NEXT_PUBLIC_SUPABASE_URL.includes("your-project")
  );
}

export function isOpenAIConfigured(): boolean {
  return Boolean(
    process.env.OPENAI_API_KEY &&
      process.env.OPENAI_API_KEY !== "sk-your-key-here" &&
      process.env.OPENAI_API_KEY.length > 20
  );
}

export function isDemoMode(): boolean {
  // NEXT_PUBLIC_ variant keeps the browser auth form on the same path as the server.
  if (
    process.env.LIFEPILOT_FORCE_DEMO === "true" ||
    process.env.NEXT_PUBLIC_LIFEPILOT_FORCE_DEMO === "true"
  ) {
    return true;
  }
  return !isSupabaseConfigured();
}

export function getOpenAIModel(): string {
  return process.env.OPENAI_MODEL || "gpt-4o-mini";
}

export const APP_NAME = "LifePilot";
export const DEFAULT_TIMEZONE = "Asia/Karachi";
export const DEMO_USER_ID = "demo-user-00000000-0000-4000-8000-000000000001";
export const DEMO_USER_EMAIL = "demo@lifepilot.local";
