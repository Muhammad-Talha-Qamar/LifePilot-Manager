"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { PageTransition } from "@/components/motion/animate";
import { Sidebar } from "./sidebar";

function AiBackgroundOrbs() {
  return (
    <div className="ai-bg-orbs" aria-hidden>
      <span className="orb-violet" />
      <span className="orb-cyan" />
      <span className="orb-pink" />
      <span className="orb-coral" />
      <span className="orb-blue" />
      <span className="orb-teal" />
    </div>
  );
}

export function AppShell({
  children,
  isDemo,
  user,
}: {
  children: React.ReactNode;
  isDemo: boolean;
  user: { email: string; fullName: string | null; avatarUrl: string | null };
}) {
  const pathname = usePathname();
  const assistant = pathname === "/" || pathname === "/assistant";

  return (
    <div className="ai-shell flex h-dvh max-h-dvh overflow-hidden">
      <AiBackgroundOrbs />
      <Sidebar isDemo={isDemo} user={user} />
      <div className="relative z-0 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <main
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col",
            assistant
              ? "overflow-hidden pt-14 md:pt-0"
              : "overflow-x-hidden overflow-y-auto overscroll-contain px-3 pb-10 pt-16 sm:px-4 md:px-8 md:pt-8"
          )}
        >
          {assistant ? (
            children
          ) : (
            <PageTransition className="flex min-h-0 flex-1 flex-col">
              {children}
            </PageTransition>
          )}
        </main>
      </div>
    </div>
  );
}
