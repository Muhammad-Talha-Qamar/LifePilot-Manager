"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  CalendarDays,
  CheckSquare,
  FolderKanban,
  LayoutDashboard,
  ListTodo,
  Menu,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAssistant } from "@/components/assistant/assistant-provider";
import { LifePilotLogo } from "@/components/motion/animate";
import { ThemeToggle } from "./theme-toggle";

const mainNav = [
  { href: "/", label: "AI Assistant", icon: MessageSquare, match: ["/", "/assistant"] },
  { href: "/tasks", label: "Tasks", icon: ListTodo },
  { href: "/checklists", label: "Checklists", icon: CheckSquare },
  { href: "/projects", label: "Projects", icon: FolderKanban },
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

export function Sidebar({ isDemo }: { isDemo: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const { clearChat, busy } = useAssistant();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

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
              active
                ? "lp-nav-link-active"
                : "text-muted-foreground hover:bg-white/15 hover:text-foreground dark:hover:bg-white/10"
            )}
            aria-current={active ? "page" : undefined}
          >
            <Icon
              className={cn(
                "h-[18px] w-[18px] shrink-0 opacity-90 transition-transform duration-200",
                active && "scale-105 text-violet-500 dark:text-violet-300"
              )}
            />
            {!compact && <span>{item.label}</span>}
          </Link>
        );
      })}
    </nav>
  );

  const sidebarBody = (
    <>
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
          className="hidden h-8 w-8 text-muted-foreground md:inline-flex"
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

      <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain px-3", collapsed && "px-2")}>
        <NavLinks onNavigate={() => setOpen(false)} compact={collapsed} />
      </div>

      <div
        className={cn(
          "lp-nav-footer shrink-0 space-y-1 p-3",
          collapsed && "px-2"
        )}
      >
        {isDemo && !collapsed && (
          <div className="lp-nav-demo mb-1 hidden rounded-xl px-3 py-2 text-xs text-muted-foreground sm:block">
            <p className="font-medium text-foreground">Demo mode</p>
            <p className="mt-0.5">Data stays on this device.</p>
          </div>
        )}
        <Link
          href="/settings"
          onClick={() => setOpen(false)}
          title={collapsed ? "Settings" : undefined}
          className={cn(
            "nav-link flex min-h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium",
            collapsed && "justify-center px-0",
            pathname.startsWith("/settings")
              ? "lp-nav-link-active"
              : "text-muted-foreground hover:bg-white/15 hover:text-foreground dark:hover:bg-white/10"
          )}
          aria-current={pathname.startsWith("/settings") ? "page" : undefined}
        >
          <Settings className="h-[18px] w-[18px] shrink-0" />
          {!collapsed && <span>Settings</span>}
        </Link>
        <ThemeToggle collapsed={collapsed} />
        {!collapsed && (
          <div className="hidden items-center gap-3 rounded-xl px-3 py-2 text-sm text-muted-foreground md:flex">
            <span className="lp-nav-avatar flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-transform duration-200 hover:scale-105">
              You
            </span>
            <div className="min-w-0">
              <p className="truncate font-medium text-foreground">Guest</p>
              <p className="truncate text-xs">Sign in when auth is set up</p>
            </div>
          </div>
        )}
      </div>
    </>
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
          "lp-nav-aside lp-nav-aside--ai fixed inset-y-0 left-0 z-[60] flex h-dvh max-h-dvh w-[min(17.5rem,88vw)] max-w-[17.5rem] flex-col overflow-hidden transition-[transform,width] duration-200 ease-out md:static md:z-[1] md:h-auto md:max-h-none md:w-[15.25rem] md:max-w-none",
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
