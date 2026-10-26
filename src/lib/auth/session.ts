import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  decodeSession,
  encodeSession,
  sessionCookieOptions,
  type SessionPayload,
} from "./session-token";

export { SESSION_COOKIE, type SessionPayload };
export { encodeSession, decodeSession, sessionCookieOptions } from "./session-token";

export async function readSessionFromRequest(
  request: NextRequest
): Promise<SessionPayload | null> {
  return decodeSession(request.cookies.get(SESSION_COOKIE)?.value);
}

export async function readSessionFromCookies(): Promise<SessionPayload | null> {
  const jar = await cookies();
  return decodeSession(jar.get(SESSION_COOKIE)?.value);
}

export async function applySessionCookie(
  response: NextResponse,
  payload: Omit<SessionPayload, "exp">
): Promise<NextResponse> {
  response.cookies.set(
    SESSION_COOKIE,
    await encodeSession(payload),
    sessionCookieOptions()
  );
  return response;
}

export function clearSessionCookie(response: NextResponse): NextResponse {
  response.cookies.set(SESSION_COOKIE, "", {
    ...sessionCookieOptions(0),
    maxAge: 0,
  });
  return response;
}
