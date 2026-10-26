import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { generateId, nowIso } from "@/lib/utils";

const USERS_PATH = path.join(process.cwd(), ".demo-users.json");

export interface DemoUserRecord {
  id: string;
  email: string;
  full_name: string | null;
  password_hash: string;
  salt: string;
  created_at: string;
}

interface DemoUsersFile {
  users: DemoUserRecord[];
}

type GlobalUsers = {
  writeQueue: Promise<void>;
};

function globals(): GlobalUsers {
  const g = globalThis as typeof globalThis & { __lpDemoUsers?: GlobalUsers };
  if (!g.__lpDemoUsers) {
    g.__lpDemoUsers = { writeQueue: Promise.resolve() };
  }
  return g.__lpDemoUsers;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString("base64url");
}

export function verifyPassword(
  password: string,
  salt: string,
  passwordHash: string
): boolean {
  const next = hashPassword(password, salt);
  if (next.length !== passwordHash.length) return false;
  return timingSafeEqual(Buffer.from(next), Buffer.from(passwordHash));
}

async function readUsers(): Promise<DemoUsersFile> {
  try {
    const raw = await fs.readFile(USERS_PATH, "utf8");
    const parsed = JSON.parse(raw) as DemoUsersFile;
    if (!Array.isArray(parsed.users)) return { users: [] };
    return parsed;
  } catch {
    return { users: [] };
  }
}

async function writeUsers(file: DemoUsersFile): Promise<void> {
  const g = globals();
  g.writeQueue = g.writeQueue.then(async () => {
    await fs.writeFile(USERS_PATH, JSON.stringify(file, null, 2), "utf8");
  });
  await g.writeQueue;
}

export async function findDemoUserByEmail(
  email: string
): Promise<DemoUserRecord | null> {
  const file = await readUsers();
  const normalized = normalizeEmail(email);
  return file.users.find((u) => u.email === normalized) ?? null;
}

export async function findDemoUserById(
  id: string
): Promise<DemoUserRecord | null> {
  const file = await readUsers();
  return file.users.find((u) => u.id === id) ?? null;
}

export async function createDemoUser(input: {
  email: string;
  password: string;
  fullName?: string | null;
}): Promise<DemoUserRecord> {
  const email = normalizeEmail(input.email);
  if (!email || !email.includes("@")) {
    throw new Error("Enter a valid email address.");
  }
  if (!input.password || input.password.length < 6) {
    throw new Error("Password must be at least 6 characters.");
  }

  const file = await readUsers();
  if (file.users.some((u) => u.email === email)) {
    throw new Error("An account with this email already exists.");
  }

  const salt = randomBytes(16).toString("base64url");
  const user: DemoUserRecord = {
    id: generateId(),
    email,
    full_name: input.fullName?.trim() || null,
    password_hash: hashPassword(input.password, salt),
    salt,
    created_at: nowIso(),
  };

  file.users.push(user);
  await writeUsers(file);
  return user;
}

export async function authenticateDemoUser(
  email: string,
  password: string
): Promise<DemoUserRecord> {
  const user = await findDemoUserByEmail(email);
  if (!user || !verifyPassword(password, user.salt, user.password_hash)) {
    throw new Error("Invalid email or password.");
  }
  return user;
}
