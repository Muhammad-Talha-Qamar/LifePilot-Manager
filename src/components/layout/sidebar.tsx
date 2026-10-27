"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  CalendarDays,
  CheckSquare,
  LayoutDashboard,
  ListTodo,
  Menu,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
  Plus,
  Settings,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAssistant } from "@/components/assistant/assistant-provider";
import { LifePilotLogo } from "@/components/motion/animate";
import { ThemeToggle } from "./theme-toggle";

const mainNav = [
  { href: "/", label: "AI Assistant", icon: MessageSquare, match: ["/", "/assistant"] },
  { href: "/tasks", label: "Tasks", icon: ListTodo },
  { href: "/checklists", label: "Checklists", icon: CheckSquare },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
];

function LifePilotMark({ showWordmark }: { showWordmark: boolean }) {
  return (
    <Link
      href="/"
      className="interactive-press flex min-w-0 items-center gap-2.5 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="lp-nav-mark" aria-hidden>
        <LifePilotLogo size={16} />
      </span>
      {showWordmark && (
        <span className="truncate font-display text-[15px] font-semibold tracking-tight text-foreground">
          LifePilot
        </span>
      )}
    </Link>
  );
}

function isActive(pathname: string, href: string, match?: string[]) {
  if (match) return match.includes(pathname);
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({
  isDemo,
  user,
}: {
  isDemo: boolean;
  user: { email: string; fullName: string | null; avatarUrl: string | null };
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { clearChat, busy } = useAssistant();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const displayName = user.fullName?.trim() || user.email.split("@")[0] || "You";
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "You";

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  function handleNewChat() {
    clearChat();
    setOpen(false);
    if (pathname !== "/" && pathname !== "/assistant") {
      router.push("/");
    }
  }

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      clearChat();
      router.replace("/login");
      router.refresh();
    } catch {
      toast.error("Could not sign out");
    } finally {
      setSigningOut(false);
    }
  }

  const NavLinks = ({
    onNavigate,
    compact,
  }: {
    onNavigate?: () => void;
    compact?: boolean;
  }) => (
    <nav className="flex flex-col gap-0.5" aria-label="Main">
      {mainNav.map((item) => {
        const active = isActive(pathname, item.href, item.match);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            title={compact ? item.label : undefined}
            className={cn(
              "nav-link group flex min-h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium",
              compact && "justify-center px-0",
              active ? "lp-nav-link-active" : "text-foreground/75"
            )}
            aria-current={active ? "page" : undefined}
          >
            <Icon
              className={cn(
                "h-[18px] w-[18px] shrink-0",
                active
                  ? "scale-105 text-violet-600 dark:text-violet-300"
                  : "text-foreground/80"
              )}
            />
            {!compact && <span>{item.label}</span>}
          </Link>
        );
      })}
    </nav>
  );

  const sidebarBody = (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
      <div
        className={cn(
          "flex h-14 shrink-0 items-center gap-2 px-3",
          collapsed ? "justify-center md:px-2" : "justify-between"
        )}
      >
        <LifePilotMark showWordmark={!collapsed} />
        <Button
          variant="ghost"
          size="icon"
          className="hidden h-8 w-8 text-foreground/80 md:inline-flex"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={() => setCollapsed((c) => !c)}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </Button>
      </div>

      <div className={cn("shrink-0 px-3 pb-3", collapsed && "px-2")}>
        <Button
          type="button"
          variant="outline"
          className={cn(
            "lp-nav-new-chat h-10 w-full justify-start gap-2 rounded-xl text-sm font-medium shadow-none",
            collapsed && "justify-center px-0"
          )}
          onClick={handleNewChat}
          disabled={busy}
          aria-label="New chat"
          title="New chat"
        >
          <Plus className="h-4 w-4 shrink-0" />
          {!collapsed && <span>New chat</span>}
        </Button>
      </div>

      <div className={cn("px-3 pb-2", collapsed && "px-2")}>
        <NavLinks onNavigate={() => setOpen(false)} compact={collapsed} />
      </div>

      <div
        className={cn(
          "lp-nav-footer mt-auto space-y-1 p-3",
          collapsed && "px-2"
        )}
      >
        {isDemo && !collapsed && (
          <div className="lp-nav-demo mb-1 hidden rounded-xl px-3 py-2 text-xs text-muted-foreground sm:block">
            <p className="font-medium text-foreground">Local account</p>
            <p className="mt-0.5">Starts empty. Data stays on this device.</p>
          </div>
        )}
        <Link
          href="/settings"
          onClick={() => setOpen(false)}
          title={collapsed ? "Settings" : undefined}
          className={cn(
            "nav-link group flex min-h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium",
            collapsed && "justify-center px-0",
            pathname.startsWith("/settings")
              ? "lp-nav-link-active"
              : "text-foreground/75"
          )}
          aria-current={pathname.startsWith("/settings") ? "page" : undefined}
        >
          <Settings className="h-[18px] w-[18px] shrink-0" />
          {!collapsed && <span>Settings</span>}
        </Link>
        <ThemeToggle collapsed={collapsed} className="nav-link group text-foreground/75" />
        <button
          type="button"
          onClick={() => void handleSignOut()}
          disabled={signingOut}
          title={collapsed ? "Sign out" : undefined}
          className={cn(
            "nav-link group flex min-h-10 w-full items-center gap-3 rounded-xl px-3 text-sm font-medium text-foreground/75",
            collapsed && "justify-center px-0"
          )}
        >
          <LogOut className="h-[18px] w-[18px] shrink-0" />
          {!collapsed && <span>{signingOut ? "Signing out…" : "Sign out"}</span>}
        </button>
        <Link
          href="/profile"
          onClick={() => setOpen(false)}
          title={collapsed ? displayName : undefined}
          className={cn(
            "nav-link lp-nav-profile group flex min-h-10 items-center gap-3 rounded-xl px-3 text-sm text-foreground/80",
            collapsed && "justify-center px-0",
            pathname.startsWith("/profile") && "lp-nav-link-active"
          )}
          aria-current={pathname.startsWith("/profile") ? "page" : undefined}
        >
          <span className="lp-nav-avatar relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-semibold text-white">
            {user.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.avatarUrl}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              initials
            )}
          </span>
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate font-medium text-foreground">{displayName}</p>
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            </div>
          )}
        </Link>
      </div>
    </div>
  );

  return (
    <>
      <div
        className="lp-nav-bar lp-nav-bar--ai fixed left-0 right-0 top-0 z-50 flex h-14 items-center justify-between gap-3 px-3 sm:px-4 md:hidden"
      >
        <div className="min-w-0 flex-1">
          <LifePilotMark showWordmark />
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 shrink-0"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
      </div>

      {open && (
        <button
          type="button"
          className="mobile-overlay fixed inset-0 z-[45] bg-black/40 backdrop-blur-[2px] md:hidden"
          aria-label="Close menu"
          onClick={() => setOpen(false)}
        />
      )}

      <aside
        className={cn(
          "lp-nav-aside lp-nav-aside--ai fixed inset-y-0 left-0 z-[60] flex h-dvh max-h-dvh w-[min(17.5rem,88vw)] max-w-[17.5rem] flex-col overflow-hidden transition-[transform,width] duration-200 ease-out md:static md:z-[1] md:h-dvh md:max-h-dvh md:w-[15.25rem] md:max-w-none md:shrink-0",
          collapsed && "md:!w-[4.5rem]",
          // Keep sidebar interactive on desktop; only hide off-canvas drawer on small screens
          open ? "translate-x-0" : "max-md:-translate-x-full",
          !open && "max-md:pointer-events-none max-md:invisible"
        )}
      >
        {sidebarBody}
      </aside>
    </>
  );
}
