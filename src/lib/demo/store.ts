import path from "path";
import { createEmptyStore, createSeedStore, type DemoStore } from "./seed";
import { readJsonText, writeJsonText } from "./persist";

const DATA_DIR = path.join(process.cwd(), ".demo-data");

type GlobalStore = {
  memoryByUser: Map<string, DemoStore>;
};

function globals(): GlobalStore {
  const g = globalThis as typeof globalThis & { __lpDemoStore?: GlobalStore };
  if (!g.__lpDemoStore) {
    g.__lpDemoStore = {
      memoryByUser: new Map(),
    };
  }
  return g.__lpDemoStore;
}

function storeKey(userId: string): string {
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `user:${safe}`;
}

function storePath(userId: string): string {
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(DATA_DIR, `${safe}.json`);
}

async function readFromDisk(userId: string): Promise<DemoStore | null> {
  const raw = await readJsonText(storeKey(userId), storePath(userId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DemoStore;
  } catch {
    return null;
  }
}

async function writeToDisk(userId: string, store: DemoStore): Promise<void> {
  await writeJsonText(
    storeKey(userId),
    storePath(userId),
    JSON.stringify(store, null, 2)
  );
}

export async function getDemoStore(
  userId: string,
  profile?: { email: string; fullName?: string | null }
): Promise<DemoStore> {
  const g = globals();
  // Prefer disk so HMR / split module instances stay consistent.
  const disk = await readFromDisk(userId);
  if (disk) {
    g.memoryByUser.set(userId, disk);
    return disk;
  }

  const cached = g.memoryByUser.get(userId);
  if (cached) return cached;

  const store = createEmptyStore(
    userId,
    profile?.email ?? `${userId}@lifepilot.local`,
    profile?.fullName ?? null
  );
  g.memoryByUser.set(userId, store);
  await writeToDisk(userId, store);
  return store;
}

export async function ensureEmptyDemoStore(
  userId: string,
  email: string,
  fullName: string | null
): Promise<DemoStore> {
  const g = globals();
  const existing = await readFromDisk(userId);
  if (existing) {
    g.memoryByUser.set(userId, existing);
    return existing;
  }
  const store = createEmptyStore(userId, email, fullName);
  g.memoryByUser.set(userId, store);
  await writeToDisk(userId, store);
  return store;
}

export async function saveDemoStore(userId: string, store: DemoStore): Promise<void> {
  globals().memoryByUser.set(userId, store);
  await writeToDisk(userId, store);
}

export async function mutateDemoStore(
  userId: string,
  mutator: (store: DemoStore) => void | Promise<void>
): Promise<DemoStore> {
  const store = await getDemoStore(userId);
  const clone = structuredClone(store) as DemoStore;
  await mutator(clone);
  await saveDemoStore(userId, clone);
  return clone;
}

/** Wipe the signed-in user's board back to empty (not sample seed). */
export async function clearDemoStore(
  userId: string,
  email: string,
  fullName: string | null
): Promise<DemoStore> {
  const previous = await readFromDisk(userId);
  const store = createEmptyStore(userId, email, fullName);
  if (previous?.profile.avatar_url) {
    store.profile.avatar_url = previous.profile.avatar_url;
  }
  if (previous?.profile.created_at) {
    store.profile.created_at = previous.profile.created_at;
  }
  globals().memoryByUser.set(userId, store);
  await writeToDisk(userId, store);
  return store;
}

/** Optional: load the sample board for exploration. */
export async function loadSampleDemoStore(
  userId: string,
  email: string,
  fullName: string | null
): Promise<DemoStore> {
  const previous = await readFromDisk(userId);
  const store = createSeedStore(userId, email, fullName);
  if (previous?.profile.avatar_url) {
    store.profile.avatar_url = previous.profile.avatar_url;
  }
  if (previous?.profile.created_at) {
    store.profile.created_at = previous.profile.created_at;
  }
  globals().memoryByUser.set(userId, store);
  await writeToDisk(userId, store);
  return store;
}

/** @deprecated use clearDemoStore — kept for older callers */
export async function resetDemoStore(
  userId: string,
  email: string,
  fullName: string | null
): Promise<DemoStore> {
  return clearDemoStore(userId, email, fullName);
}
