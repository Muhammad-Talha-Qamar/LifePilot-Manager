"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  FolderKanban,
  ListTodo,
  Loader2,
  Plus,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/client-api";
import { notifyDataChanged } from "@/lib/data-events";
import { useDataRefresh } from "@/lib/use-data-refresh";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { ProductivitySummary, Profile, Project, Reminder, Task } from "@/types";

type DashboardData = {
  profile: Profile;
  isDemo: boolean;
  openaiConfigured: boolean;
  summary: ProductivitySummary;
  projects: (Project & { progress: { percent: number } })[];
  reminders: Reminder[];
};

function PriorityBadge({ priority }: { priority: string }) {
  const variant =
    priority === "urgent" || priority === "high"
      ? "danger"
      : priority === "medium"
        ? "warning"
        : "secondary";
  return <Badge variant={variant as "danger"}>{priority}</Badge>;
}

function TaskRow({ task }: { task: Task }) {
  return (
    <li className="list-row flex items-start justify-between gap-3 border-b border-border/50 py-2.5 last:border-0">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{task.title}</p>
        <p className="text-xs text-muted-foreground">
          {task.due_date ?? "No due date"}
          {task.category ? ` · ${task.category}` : ""}
        </p>
      </div>
      <PriorityBadge priority={task.priority} />
    </li>
  );
}

function SoftPanel({
  title,
  children,
  action,
  className,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "lp-glass hover-lift rounded-2xl border",
        className
      )}
    >
      <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-4">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {action}
      </div>
      <div className="px-5 pb-4">{children}</div>
    </section>
  );
}

export function DashboardView() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [briefing, setBriefing] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickTitle, setQuickTitle] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const dash = await api<DashboardData>("/api/dashboard");
      setData(dash);
      try {
        const brief = await api<{ briefing: string }>("/api/ai/briefing");
        setBriefing(brief.briefing);
      } catch {
        const s = dash.summary;
        setBriefing(
          `You have ${s.today_tasks.length} task(s) today, ${s.overdue_tasks.length} overdue, and ${s.upcoming_events.length} upcoming event(s).`
        );
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useDataRefresh(() => {
    void load();
  });

  async function quickAddTask() {
    if (!quickTitle.trim()) {
      toast.error("Title is required");
      return;
    }
    setCreating(true);
    try {
      await api("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: quickTitle.trim(),
          priority: "medium",
          due_date: format(new Date(), "yyyy-MM-dd"),
        }),
      });
      toast.success("Task created");
      notifyDataChanged();
      setQuickOpen(false);
      setQuickTitle("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create task");
    } finally {
      setCreating(false);
    }
  }

  if (loading || !data) {
    return (
      <div className="animate-fade flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading overview…
      </div>
    );
  }

  const name = data.profile.full_name?.split(" ")[0] || "there";
  const tz = data.profile.timezone;
  const nowLabel = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: tz,
  });

  const stats = [
    { label: "Today", value: data.summary.today_tasks.length, icon: ListTodo },
    { label: "Overdue", value: data.summary.overdue_tasks.length, icon: AlertTriangle },
    { label: "Events", value: data.summary.upcoming_events.length, icon: Calendar },
    {
      label: "7-day done",
      value: `${data.summary.completion_rate_7d}%`,
      icon: CheckCircle2,
    },
  ];

  return (
    <div className="mx-auto w-full min-w-0 max-w-4xl space-y-4 sm:space-y-5">
      <header className="animate-fade-up flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{nowLabel}</p>
          <h1 className="page-title break-words">Overview, {name}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setQuickOpen(true)} className="rounded-xl">
            <Plus className="h-4 w-4" />
            Quick task
          </Button>
          <Button variant="outline" asChild className="rounded-xl">
            <Link href="/">
              <Sparkles className="h-4 w-4" />
              Ask assistant
            </Link>
          </Button>
        </div>
      </header>

      <section
        className="lp-glass-soft animate-fade-up rounded-2xl border px-5 py-4"
        style={{ animationDelay: "40ms" }}
      >
        <div className="flex items-start gap-3">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div>
            <h2 className="text-sm font-semibold">Daily briefing</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap">
              {briefing}
            </p>
            {!data.openaiConfigured && (
              <p className="mt-2 text-xs text-muted-foreground">
                Model offline — briefing built from your saved data.
              </p>
            )}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stats.map((stat, index) => (
          <div
            key={stat.label}
            className="lp-glass hover-lift animate-fade-up flex min-w-0 items-center gap-2 rounded-xl border px-2.5 py-2.5 sm:gap-2.5 sm:px-3.5 sm:py-3"
            style={{ animationDelay: `${60 + index * 45}ms` }}
          >
            <stat.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="text-base font-semibold leading-none tracking-tight sm:text-lg">
                {stat.value}
              </p>
              <p className="mt-1 truncate text-[11px] text-muted-foreground sm:text-xs">
                {stat.label}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <SoftPanel title="Today's tasks" className="animate-fade-up">
          {data.summary.today_tasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing due today.</p>
          ) : (
            <ul>
              {data.summary.today_tasks.map((t) => (
                <TaskRow key={t.id} task={t} />
              ))}
            </ul>
          )}
        </SoftPanel>

        <SoftPanel
          className="animate-fade-up"
          title={
            <span className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400" />
              Overdue
            </span>
          }
        >
          {data.summary.overdue_tasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">You&apos;re caught up.</p>
          ) : (
            <ul>
              {data.summary.overdue_tasks.map((t) => (
                <TaskRow key={t.id} task={t} />
              ))}
            </ul>
          )}
        </SoftPanel>

        <SoftPanel title="Upcoming deadlines" className="animate-fade-up">
          {data.summary.upcoming_deadlines.length === 0 ? (
            <p className="text-sm text-muted-foreground">No upcoming deadlines.</p>
          ) : (
            <ul>
              {data.summary.upcoming_deadlines.slice(0, 6).map((t) => (
                <TaskRow key={t.id} task={t} />
              ))}
            </ul>
          )}
        </SoftPanel>

        <SoftPanel title="Upcoming events" className="animate-fade-up">
          {data.summary.upcoming_events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No upcoming events.</p>
          ) : (
            <ul>
              {data.summary.upcoming_events.map((e) => (
                <li key={e.id} className="list-row border-b border-border/50 py-2.5 last:border-0">
                  <p className="text-sm font-medium">{e.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(e.start_at).toLocaleString(undefined, {
                      timeZone: tz,
                    })}
                    {e.location ? ` · ${e.location}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </SoftPanel>
      </div>

      <SoftPanel
        className="animate-fade-up"
        title={
          <span className="flex items-center gap-2">
            <FolderKanban className="h-4 w-4 text-muted-foreground" />
            Active projects
          </span>
        }
        action={
          <Button variant="ghost" size="sm" asChild>
            <Link href="/projects">View all</Link>
          </Button>
        }
      >
        <div className="grid gap-2.5 sm:grid-cols-2">
          {data.projects.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active projects.</p>
          ) : (
            data.projects.map((p) => (
              <div
                key={p.id}
                className="lp-glass-soft hover-lift rounded-xl border p-3.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{p.name}</p>
                  <span className="text-xs font-medium text-primary">{p.progress.percent}%</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="progress-bar-fill h-full rounded-full bg-primary"
                    style={{ width: `${p.progress.percent}%` }}
                  />
                </div>
                {p.deadline && (
                  <p className="mt-2 text-xs text-muted-foreground">Deadline {p.deadline}</p>
                )}
              </div>
            ))
          )}
        </div>
      </SoftPanel>

      {data.reminders.length > 0 && (
        <SoftPanel title="Reminders" className="animate-fade-up">
          <ul>
            {data.reminders.map((r) => (
              <li
                key={r.id}
                className="list-row flex items-start justify-between gap-3 border-b border-border/50 py-2.5 last:border-0"
              >
                <div>
                  <p className="text-sm font-medium">{r.title}</p>
                  {r.body && <p className="text-xs text-muted-foreground">{r.body}</p>}
                </div>
                {!r.is_read && <Badge variant="warning">New</Badge>}
              </li>
            ))}
          </ul>
        </SoftPanel>
      )}

      <Dialog open={quickOpen} onOpenChange={setQuickOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Quick task</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="quick-task-title">Title</Label>
            <Input
              id="quick-task-title"
              value={quickTitle}
              onChange={(e) => setQuickTitle(e.target.value)}
              placeholder="What needs doing today?"
              onKeyDown={(e) => {
                if (e.key === "Enter") void quickAddTask();
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQuickOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void quickAddTask()} disabled={creating || !quickTitle.trim()}>
              {creating ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
