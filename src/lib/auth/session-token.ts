export const SESSION_COOKIE = "lp_session";
const SESSION_DAYS = 30;

export interface SessionPayload {
  userId: string;
  email: string;
  fullName: string | null;
  exp: number;
}

function sessionSecret(): string {
  return (
    process.env.LIFEPILOT_SESSION_SECRET ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    "lifepilot-local-session-secret"
  );
}

function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < view.length; i += 1) {
    binary += String.fromCharCode(view[i]!);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

async function getHmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(sessionSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function sign(body: string): Promise<string> {
  const key = await getHmacKey();
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body)
  );
  return toBase64Url(signature);
}

async function verify(body: string, signature: string): Promise<boolean> {
  const key = await getHmacKey();
  const sigBytes = fromBase64Url(signature);
  const copy = new Uint8Array(sigBytes);
  return crypto.subtle.verify(
    "HMAC",
    key,
    copy,
    new TextEncoder().encode(body)
  );
}

export async function encodeSession(
  payload: Omit<SessionPayload, "exp">
): Promise<string> {
  const full: SessionPayload = {
    ...payload,
    exp: Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000,
  };
  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(full)));
  const signature = await sign(body);
  return `${body}.${signature}`;
}

export async function decodeSession(
  token: string | undefined | null
): Promise<SessionPayload | null> {
  if (!token) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  if (!(await verify(body, signature))) return null;
  try {
    const json = new TextDecoder().decode(fromBase64Url(body));
    const payload = JSON.parse(json) as SessionPayload;
    if (!payload.userId || !payload.email || !payload.exp) return null;
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function sessionCookieOptions(maxAgeSeconds = SESSION_DAYS * 24 * 60 * 60) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}
