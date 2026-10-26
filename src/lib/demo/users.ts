import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import path from "path";
import { generateId, nowIso } from "@/lib/utils";
import { readJsonText, writeJsonText } from "./persist";
import {
  encodeRosterCookie,
  readRosterCookie,
  setRosterCookie,
} from "./roster-cookie";

const USERS_PATH = path.join(process.cwd(), ".demo-users.json");
const USERS_KEY = "users";

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

function mergeUsers(
  primary: DemoUserRecord[],
  secondary: DemoUserRecord[]
): DemoUserRecord[] {
  const byId = new Map<string, DemoUserRecord>();
  for (const user of secondary) byId.set(user.id, user);
  for (const user of primary) byId.set(user.id, user);
  return [...byId.values()];
}

async function readUsers(): Promise<DemoUsersFile> {
  let diskUsers: DemoUserRecord[] = [];
  try {
    const raw = await readJsonText(USERS_KEY, USERS_PATH);
    if (raw) {
      const parsed = JSON.parse(raw) as DemoUsersFile;
      if (Array.isArray(parsed.users)) diskUsers = parsed.users;
    }
  } catch {
    diskUsers = [];
  }

  const cookieUsers = (await readRosterCookie()) ?? [];
  return { users: mergeUsers(diskUsers, cookieUsers) };
}

async function writeUsers(file: DemoUsersFile): Promise<string> {
  await writeJsonText(USERS_KEY, USERS_PATH, JSON.stringify(file, null, 2));
  const token = await encodeRosterCookie(file.users);
  await setRosterCookie(file.users);
  return token;
}

/** Latest roster token from the most recent write (for attaching onto NextResponse). */
let lastRosterToken: string | null = null;

export function takeLastRosterToken(): string | null {
  const token = lastRosterToken;
  lastRosterToken = null;
  return token;
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
  lastRosterToken = await writeUsers(file);
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
  // Refresh roster cookie so this browser keeps a durable copy.
  const file = await readUsers();
  lastRosterToken = await writeUsers(file);
  return user;
}
