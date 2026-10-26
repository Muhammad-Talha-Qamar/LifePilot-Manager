import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import {
  decodeSignedJson,
  encodeSignedJson,
  sessionCookieOptions,
} from "@/lib/auth/session-token";
import type { DemoUserRecord } from "./users";

/** Signed cookie backup so demo accounts survive Netlify's read-only / ephemeral FS. */
export const ROSTER_COOKIE = "lp_demo_roster";

interface RosterFile {
  users: DemoUserRecord[];
  exp: number;
}

const ROSTER_DAYS = 30;

export async function readRosterCookie(): Promise<DemoUserRecord[] | null> {
  try {
    const jar = await cookies();
    const raw = jar.get(ROSTER_COOKIE)?.value;
    if (!raw) return null;
    const parsed = await decodeSignedJson<RosterFile>(raw);
    if (!parsed || !Array.isArray(parsed.users)) return null;
    if (parsed.exp < Date.now()) return null;
    return parsed.users;
  } catch {
    return null;
  }
}

export async function encodeRosterCookie(
  users: DemoUserRecord[]
): Promise<string> {
  return encodeSignedJson<RosterFile>({
    users,
    exp: Date.now() + ROSTER_DAYS * 24 * 60 * 60 * 1000,
  });
}

export function attachRosterCookie<T extends NextResponse>(
  response: T,
  token: string
): T {
  response.cookies.set(ROSTER_COOKIE, token, sessionCookieOptions());
  return response;
}

export async function setRosterCookie(users: DemoUserRecord[]): Promise<void> {
  try {
    const jar = await cookies();
    jar.set(ROSTER_COOKIE, await encodeRosterCookie(users), sessionCookieOptions());
  } catch {
    // Outside a mutable cookie context — caller should use attachRosterCookie.
  }
}
