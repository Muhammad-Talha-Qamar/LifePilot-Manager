/**
 * Runtime configuration from `.env` / `.env.example` / Netlify env vars.
 * Secrets are only read on the server; NEXT_PUBLIC_* are available in the browser.
 */

function env(name: string): string | undefined {
  const value = process.env[name];
  if (value == null) return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

function envFlag(name: string): boolean {
  return env(name)?.toLowerCase() === "true";
}

export function isSupabaseConfigured(): boolean {
  const url = env("NEXT_PUBLIC_SUPABASE_URL");
  const key = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return Boolean(
    url &&
      key &&
      !url.includes("your-project") &&
      key !== "your-anon-key"
  );
}

export function isOpenAIConfigured(): boolean {
  const key = env("OPENAI_API_KEY");
  return Boolean(key && key !== "sk-your-key-here" && key.length > 20);
}

export function isDemoMode(): boolean {
  // NEXT_PUBLIC_ keeps the browser auth form on the same path as the server.
  if (envFlag("LIFEPILOT_FORCE_DEMO") || envFlag("NEXT_PUBLIC_LIFEPILOT_FORCE_DEMO")) {
    return true;
  }
  return !isSupabaseConfigured();
}

export function getOpenAIModel(): string {
  return env("OPENAI_MODEL") || "gpt-4o-mini";
}

export function getSessionSecret(): string {
  return (
    env("LIFEPILOT_SESSION_SECRET") ||
    env("NEXT_PUBLIC_SUPABASE_ANON_KEY") ||
    "lifepilot-local-session-secret"
  );
}

/** Safe summary for /api/health — never includes secret values. */
export function getEnvStatus() {
  return {
    demoMode: isDemoMode(),
    forceDemo: envFlag("LIFEPILOT_FORCE_DEMO") || envFlag("NEXT_PUBLIC_LIFEPILOT_FORCE_DEMO"),
    supabase: isSupabaseConfigured(),
    openai: isOpenAIConfigured(),
    sessionSecretSet: Boolean(env("LIFEPILOT_SESSION_SECRET")),
    openaiModel: getOpenAIModel(),
  };
}

export const APP_NAME = "LifePilot";
export const DEFAULT_TIMEZONE = "Asia/Karachi";
export const DEMO_USER_ID = "demo-user-00000000-0000-4000-8000-000000000001";
export const DEMO_USER_EMAIL = "demo@lifepilot.local";
