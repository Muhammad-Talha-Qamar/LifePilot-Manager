import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isDemoMode, isSupabaseConfigured } from "@/lib/config";
import { SESSION_COOKIE, decodeSession } from "@/lib/auth/session-token";

function isAuthPage(path: string) {
  return path.startsWith("/login") || path.startsWith("/signup");
}

function isIconAsset(path: string) {
  return (
    path === "/favicon.ico" ||
    path === "/icon" ||
    path === "/apple-icon" ||
    path.startsWith("/icon.") ||
    path.startsWith("/apple-icon.") ||
    path.startsWith("/favicon.")
  );
}

function isPublicPath(path: string) {
  return (
    isAuthPage(path) ||
    isIconAsset(path) ||
    path.startsWith("/api/health") ||
    path.startsWith("/api/auth/")
  );
}

export async function updateSession(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Local / demo auth: gate the app behind the lp_session cookie.
  if (isDemoMode() || !isSupabaseConfigured()) {
    const session = await decodeSession(
      request.cookies.get(SESSION_COOKIE)?.value
    );
    const authed = Boolean(session);

    if (!authed && !isPublicPath(path) && !path.startsWith("/api/")) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", path === "/" ? "/" : path);
      return NextResponse.redirect(url);
    }

    if (authed && isAuthPage(path)) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      return NextResponse.redirect(url);
    }

    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublicPath(path) && !path.startsWith("/api/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path === "/" ? "/" : path);
    return NextResponse.redirect(url);
  }

  if (user && isAuthPage(path)) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
