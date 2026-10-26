"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LifePilotLogo } from "@/components/motion/animate";
import { isSupabaseConfigured } from "@/lib/config";

type Mode = "login" | "signup";

async function parseApiError(res: Response): Promise<string> {
  try {
    const json = (await res.json()) as { error?: string };
    return json.error || "Something went wrong.";
  } catch {
    return "Something went wrong.";
  }
}

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get("next") || "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const supabaseReady = isSupabaseConfigured();

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      if (supabaseReady) {
        const { createClient } = await import("@/lib/supabase/client");
        const supabase = createClient();
        if (mode === "signup") {
          const { error } = await supabase.auth.signUp({
            email,
            password,
            options: {
              data: { full_name: fullName.trim() || null },
            },
          });
          if (error) throw error;
          toast.success("Account created. Check your email if confirmation is required.");
        } else {
          const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
          });
          if (error) throw error;
          toast.success("Welcome back");
        }
      } else {
        const res = await fetch(`/api/auth/${mode === "signup" ? "signup" : "login"}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            password,
            ...(mode === "signup" ? { fullName } : {}),
          }),
        });
        if (!res.ok) throw new Error(await parseApiError(res));
        toast.success(mode === "signup" ? "Account created" : "Welcome back");
      }

      router.replace(next.startsWith("/") ? next : "/");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not continue");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="ai-bg-orbs pointer-events-none absolute inset-0" aria-hidden>
        <span className="orb-violet" />
        <span className="orb-cyan" />
        <span className="orb-pink" />
      </div>

      <div className="relative z-10 w-full max-w-md animate-fade-up">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="lp-nav-mark mb-4">
            <LifePilotLogo size={22} />
          </span>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            {mode === "login" ? "Sign in to LifePilot" : "Create your LifePilot"}
          </h1>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            {mode === "login"
              ? "Your tasks and checklists stay private to this account."
              : "New accounts start empty — add only what you need."}
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          className="lp-glass space-y-4 rounded-2xl border p-6 shadow-sm"
        >
          {mode === "signup" && (
            <div className="space-y-1.5">
              <Label htmlFor="fullName">Name</Label>
              <Input
                id="fullName"
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Optional"
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
            />
          </div>

          <Button type="submit" className="h-11 w-full rounded-xl" disabled={busy}>
            {busy
              ? mode === "login"
                ? "Signing in…"
                : "Creating account…"
              : mode === "login"
                ? "Sign in"
                : "Create account"}
          </Button>
        </form>

        <p className="mt-5 text-center text-sm text-muted-foreground">
          {mode === "login" ? (
            <>
              New here?{" "}
              <Link href="/signup" className="font-medium text-foreground underline-offset-4 hover:underline">
                Create an account
              </Link>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <Link href="/login" className="font-medium text-foreground underline-offset-4 hover:underline">
                Sign in
              </Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
