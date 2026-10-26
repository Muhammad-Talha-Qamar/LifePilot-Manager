import { NextResponse } from "next/server";
import { AuthError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/data/auth";
import { ZodError } from "zod";

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
}

export function jsonError(error: unknown, fallbackStatus = 500) {
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        ok: false,
        error: "Validation failed",
        details: error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400 }
    );
  }
  if (error instanceof ValidationError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }
  if (error instanceof AuthError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 401 });
  }
  if (error instanceof ForbiddenError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 403 });
  }
  if (error instanceof NotFoundError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 404 });
  }
  const message = error instanceof Error ? error.message : "Internal server error";
  console.error("[api]", message);
  return NextResponse.json({ ok: false, error: message }, { status: fallbackStatus });
}

const rateMap = new Map<string, { count: number; reset: number }>();

export function rateLimit(
  key: string,
  limit = 30,
  windowMs = 60_000
): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const entry = rateMap.get(key);
  if (!entry || entry.reset < now) {
    rateMap.set(key, { count: 1, reset: now + windowMs });
    return { allowed: true, remaining: limit - 1 };
  }
  if (entry.count >= limit) {
    return { allowed: false, remaining: 0 };
  }
  entry.count += 1;
  return { allowed: true, remaining: limit - entry.count };
}
