import { promises as fs } from "fs";
import path from "path";

/**
 * Demo-mode persistence for local / Hostinger disk.
 * Falls back to in-memory when the filesystem is not writable.
 */

type PersistBackend = "disk" | "memory";

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

async function probeBackend(probeDir: string): Promise<PersistBackend> {
  const g = globals();
  if (g.backend) return g.backend;

  try {
    await fs.mkdir(probeDir, { recursive: true });
    const probe = path.join(probeDir, ".write-probe");
    await fs.writeFile(probe, "ok", "utf8");
    await fs.unlink(probe).catch(() => undefined);
    g.backend = "disk";
    g.lastError = null;
    return g.backend;
  } catch (error) {
    if (isReadOnlyFsError(error)) {
      g.backend = "memory";
      g.lastError =
        errorMessage(error) || "Demo storage is in-memory only on this host.";
      console.warn(
        "[lifepilot] Demo data is in-memory only; board data may reset between requests. Configure Supabase for lasting storage."
      );
      return g.backend;
    }
    throw error;
  }
}

export async function getPersistStatus(): Promise<{
  backend: PersistBackend;
  lastError: string | null;
}> {
  const backend = await probeBackend(path.join(process.cwd(), ".demo-data"));
  const g = globals();
  return {
    backend,
    lastError: g.lastError,
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

    try {
      await fs.mkdir(path.dirname(diskPath), { recursive: true });
      await fs.writeFile(diskPath, text, "utf8");
    } catch (error) {
      if (!isReadOnlyFsError(error)) throw error;
      g.backend = "memory";
      g.lastError = errorMessage(error);
    }
  });
  await g.writeQueue;
}
