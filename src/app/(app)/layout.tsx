import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { AuthError, requireAuth } from "@/lib/data/auth";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let ctx;
  try {
    ctx = await requireAuth();
  } catch (error) {
    if (error instanceof AuthError) {
      redirect("/login");
    }
    throw error;
  }

  return (
    <AppShell
      isDemo={ctx.isDemo}
      user={{
        email: ctx.email,
        fullName: ctx.profile.full_name,
        avatarUrl: ctx.profile.avatar_url,
      }}
    >
      {children}
    </AppShell>
  );
}
