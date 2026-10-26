import { isDemoMode, isOpenAIConfigured, isSupabaseConfigured } from "@/lib/config";
import { jsonOk } from "@/lib/api";

export async function GET() {
  return jsonOk({
    status: "ok",
    demoMode: isDemoMode(),
    supabase: isSupabaseConfigured(),
    openai: isOpenAIConfigured(),
    timestamp: new Date().toISOString(),
  });
}
