import { promises as fs } from "fs";
import path from "path";
import { getStore } from "@netlify/blobs";

/**
 * Demo-mode persistence for local files and Netlify.
 * Netlify Functions have a read-only app filesystem — only Blobs (or /tmp) can persist.
 */

type PersistBackend = "disk" | "blobs" | "memory";

type GlobalPersist = {
  backend: PersistBackend | null;
  memory: Map<string, string>;
  writeQueue: Promise<void>;
  lastError: string | null;
};

function globals(): GlobalPersist {
  const g = globalThis as typeof globalThis & { __lpDemoPersist?: GlobalPersist };
  if (!g.__lpDemoPersist) {
    g.__lpDemoPersist = {
      backend: null,
      memory: new Map(),
      writeQueue: Promise.resolve(),
      lastError: null,
    };
  }
  return g.__lpDemoPersist;
}

function isNetlifyRuntime(): boolean {
  return (
    process.env.NETLIFY === "true" ||
    Boolean(process.env.NETLIFY_BLOBS_CONTEXT) ||
    Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME) ||
    Boolean(process.env.NETLIFY_SITE_ID) ||
    Boolean(process.env.SITE_ID)
  );
}

function isReadOnlyFsError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { code?: string; message?: string };
  return (
    err.code === "EROFS" ||
    err.code === "EACCES" ||
    /read-?only file system/i.test(err.message ?? "")
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function openBlobsStore() {
  const siteID =
    process.env.NETLIFY_SITE_ID ||
    process.env.SITE_ID ||
    process.env.BLOBS_SITE_ID;
  const token =
    process.env.NETLIFY_BLOBS_TOKEN ||
    process.env.NETLIFY_AUTH_TOKEN ||
    process.env.BLOBS_TOKEN;

  if (siteID && token) {
    return getStore({
      name: "lifepilot-demo",
      siteID,
      token,
      consistency: "strong",
    });
  }

  // Auto-configured inside Netlify Functions / OpenNext when context is injected.
  return getStore({ name: "lifepilot-demo", consistency: "strong" });
}

async function tryBlobs(): Promise<boolean> {
  try {
    const store = openBlobsStore();
    await store.set("_probe", `ok:${Date.now()}`);
    const roundTrip = await store.get("_probe", { type: "text" });
    if (!roundTrip) {
      globals().lastError = "Netlify Blobs probe write succeeded but read returned empty.";
      return false;
    }
    globals().lastError = null;
    return true;
  } catch (error) {
    globals().lastError = errorMessage(error);
    console.warn("[lifepilot] Netlify Blobs unavailable:", globals().lastError);
    return false;
  }
}

async function probeBackend(probeDir: string): Promise<PersistBackend> {
  const g = globals();
  if (g.backend) return g.backend;

  if (isNetlifyRuntime()) {
    if (await tryBlobs()) {
      g.backend = "blobs";
      return g.backend;
    }
    // Fall through — may still try disk (local netlify dev) then memory.
  }

  try {
    await fs.mkdir(probeDir, { recursive: true });
    const probe = path.join(probeDir, ".write-probe");
    await fs.writeFile(probe, "ok", "utf8");
    await fs.unlink(probe).catch(() => undefined);
    g.backend = "disk";
    g.lastError = null;
    return g.backend;
  } catch (error) {
    if (isReadOnlyFsError(error) || isNetlifyRuntime()) {
      if (await tryBlobs()) {
        g.backend = "blobs";
        return g.backend;
      }
      g.backend = "memory";
      g.lastError =
        g.lastError ||
        errorMessage(error) ||
        "Demo storage is in-memory only on this host.";
      console.warn(
        "[lifepilot] Demo data is in-memory only; accounts use a signed browser cookie, board data may reset between requests. Configure Supabase for lasting storage."
      );
      return g.backend;
    }
    throw error;
  }
}

export async function getPersistStatus(): Promise<{
  backend: PersistBackend;
  lastError: string | null;
  netlify: boolean;
}> {
  const backend = await probeBackend(path.join(process.cwd(), ".demo-data"));
  const g = globals();
  return {
    backend,
    lastError: g.lastError,
    netlify: isNetlifyRuntime(),
  };
}

export async function readJsonText(
  key: string,
  diskPath: string
): Promise<string | null> {
  const g = globals();
  const backend = await probeBackend(path.dirname(diskPath));

  if (backend === "memory") {
    return g.memory.get(key) ?? null;
  }

  if (backend === "blobs") {
    try {
      const value = await openBlobsStore().get(key, { type: "text" });
      if (value != null) g.memory.set(key, value);
      return value ?? g.memory.get(key) ?? null;
    } catch (error) {
      g.lastError = errorMessage(error);
      return g.memory.get(key) ?? null;
    }
  }

  try {
    const raw = await fs.readFile(diskPath, "utf8");
    g.memory.set(key, raw);
    return raw;
  } catch {
    return g.memory.get(key) ?? null;
  }
}

export async function writeJsonText(
  key: string,
  diskPath: string,
  text: string
): Promise<void> {
  const g = globals();
  g.writeQueue = g.writeQueue.then(async () => {
    const backend = await probeBackend(path.dirname(diskPath));
    g.memory.set(key, text);

    if (backend === "memory") {
      return;
    }

    if (backend === "blobs") {
      try {
        await openBlobsStore().set(key, text);
      } catch (error) {
        g.lastError = errorMessage(error);
        console.warn("[lifepilot] Blobs write failed; kept in-memory copy:", g.lastError);
      }
      return;
    }

    try {
      await fs.mkdir(path.dirname(diskPath), { recursive: true });
      await fs.writeFile(diskPath, text, "utf8");
    } catch (error) {
      if (!isReadOnlyFsError(error)) throw error;
      g.backend = null;
      const next = await probeBackend(path.dirname(diskPath));
      if (next === "blobs") {
        try {
          await openBlobsStore().set(key, text);
        } catch (blobsError) {
          g.lastError = errorMessage(blobsError);
        }
      }
    }
  });
  await g.writeQueue;
}
