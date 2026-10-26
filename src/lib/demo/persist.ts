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
};

function globals(): GlobalPersist {
  const g = globalThis as typeof globalThis & { __lpDemoPersist?: GlobalPersist };
  if (!g.__lpDemoPersist) {
    g.__lpDemoPersist = {
      backend: null,
      memory: new Map(),
      writeQueue: Promise.resolve(),
    };
  }
  return g.__lpDemoPersist;
}

function isNetlifyRuntime(): boolean {
  return (
    process.env.NETLIFY === "true" ||
    Boolean(process.env.NETLIFY_BLOBS_CONTEXT) ||
    Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME)
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

function blobsStore() {
  return getStore({ name: "lifepilot-demo", consistency: "strong" });
}

async function probeBackend(probeDir: string): Promise<PersistBackend> {
  const g = globals();
  if (g.backend) return g.backend;

  if (isNetlifyRuntime()) {
    try {
      const store = blobsStore();
      await store.set("_probe", "ok", { metadata: { t: String(Date.now()) } });
      g.backend = "blobs";
      return g.backend;
    } catch {
      // Fall through to disk probe / memory.
    }
  }

  try {
    await fs.mkdir(probeDir, { recursive: true });
    const probe = path.join(probeDir, ".write-probe");
    await fs.writeFile(probe, "ok", "utf8");
    await fs.unlink(probe).catch(() => undefined);
    g.backend = "disk";
    return g.backend;
  } catch (error) {
    if (isReadOnlyFsError(error) || isNetlifyRuntime()) {
      try {
        const store = blobsStore();
        await store.set("_probe", "ok");
        g.backend = "blobs";
        return g.backend;
      } catch {
        g.backend = "memory";
        return g.backend;
      }
    }
    throw error;
  }
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
      const value = await blobsStore().get(key, { type: "text" });
      return value ?? null;
    } catch {
      return null;
    }
  }

  try {
    return await fs.readFile(diskPath, "utf8");
  } catch {
    return null;
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

    if (backend === "memory") {
      g.memory.set(key, text);
      return;
    }

    if (backend === "blobs") {
      await blobsStore().set(key, text);
      g.memory.set(key, text);
      return;
    }

    try {
      await fs.mkdir(path.dirname(diskPath), { recursive: true });
      await fs.writeFile(diskPath, text, "utf8");
      g.memory.set(key, text);
    } catch (error) {
      if (!isReadOnlyFsError(error)) throw error;
      // Disk became read-only mid-flight (e.g. Netlify) — switch to Blobs/memory.
      g.backend = null;
      const next = await probeBackend(path.dirname(diskPath));
      if (next === "blobs") {
        await blobsStore().set(key, text);
      }
      g.memory.set(key, text);
      if (next === "memory") {
        console.warn(
          "[lifepilot] Demo data is in-memory only on this host; configure Supabase for lasting storage."
        );
      }
    }
  });
  await g.writeQueue;
}
