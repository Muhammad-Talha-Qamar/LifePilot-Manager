import { promises as fs } from "fs";
import path from "path";
import { createSeedStore, type DemoStore } from "./seed";

const STORE_PATH = path.join(process.cwd(), ".demo-data.json");

let memoryStore: DemoStore | null = null;
let writeQueue: Promise<void> = Promise.resolve();

async function readFromDisk(): Promise<DemoStore | null> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    return JSON.parse(raw) as DemoStore;
  } catch {
    return null;
  }
}

async function writeToDisk(store: DemoStore): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
  });
  await writeQueue;
}

export async function getDemoStore(): Promise<DemoStore> {
  if (memoryStore) return memoryStore;
  const disk = await readFromDisk();
  if (disk) {
    memoryStore = disk;
    return disk;
  }
  memoryStore = createSeedStore();
  await writeToDisk(memoryStore);
  return memoryStore;
}

export async function saveDemoStore(store: DemoStore): Promise<void> {
  memoryStore = store;
  await writeToDisk(store);
}

export async function mutateDemoStore(
  mutator: (store: DemoStore) => void | Promise<void>
): Promise<DemoStore> {
  const store = await getDemoStore();
  // Deep clone to avoid accidental shared mutation bugs
  const clone = structuredClone(store) as DemoStore;
  await mutator(clone);
  await saveDemoStore(clone);
  return clone;
}

export async function resetDemoStore(): Promise<DemoStore> {
  memoryStore = createSeedStore();
  await writeToDisk(memoryStore);
  return memoryStore;
}
