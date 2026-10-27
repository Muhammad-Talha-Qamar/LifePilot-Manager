import { getEnvStatus, isDemoMode } from "@/lib/config";
import { jsonOk } from "@/lib/api";
import { getPersistStatus } from "@/lib/demo/persist";

export async function GET() {
  const persist = isDemoMode() ? await getPersistStatus() : null;
  return jsonOk({
    status: "ok",
    ...getEnvStatus(),
    persist,
    timestamp: new Date().toISOString(),
  });
}
