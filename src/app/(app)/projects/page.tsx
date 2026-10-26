"use client";

import { useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
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
import type { Project } from "@/types";

type ProjectRow = Project & {
  progress: { percent: number };
  task_count?: number;
};

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  async function load() {
    try {
      const data = await api<ProjectRow[]>("/api/projects");
      setProjects(data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useDataRefresh(() => {
    void load();
  });

  useEffect(() => {
    void load();
  }, []);

  async function remove(id: string) {
    try {
      await api(`/api/projects/${id}`, { method: "DELETE" });
      toast.success("Project deleted");
      notifyDataChanged();
      setConfirmId(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header className="animate-fade-up">
        <h1 className="page-title">Projects</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Deadlines and progress from your linked tasks and checklists.
        </p>
      </header>

      {loading ? (
        <div className="animate-fade flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : projects.length === 0 ? (
        <div className="lp-glass-soft animate-fade-up rounded-2xl border border-dashed px-5 py-12 text-center text-sm text-muted-foreground">
          No projects yet. Ask the assistant to create one.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {projects.map((p, index) => (
            <article
              key={p.id}
              className="lp-glass hover-lift animate-fade-up rounded-2xl border p-5"
              style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="min-w-0 flex-1 break-words text-base font-semibold tracking-tight">
                  {p.name}
                </h2>
                <div className="flex shrink-0 items-center gap-1">
                  <Badge variant="secondary">{p.priority}</Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-foreground/70 hover:text-foreground"
                    aria-label={`Delete ${p.name}`}
                    onClick={() => setConfirmId(p.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {p.description || "No description"}
              </p>
              <div className="mt-4 mb-1.5 flex justify-between text-xs text-muted-foreground">
                <span className="font-medium text-primary">{p.progress.percent}%</span>
                <span>{p.deadline ? `Due ${p.deadline}` : "No deadline"}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="progress-bar-fill h-full rounded-full bg-primary"
                  style={{ width: `${p.progress.percent}%` }}
                />
              </div>
              {typeof p.task_count === "number" && (
                <p className="mt-3 text-xs text-muted-foreground">
                  {p.task_count} linked task{p.task_count === 1 ? "" : "s"}
                </p>
              )}
            </article>
          ))}
        </div>
      )}

      <Dialog open={Boolean(confirmId)} onOpenChange={(o) => !o && setConfirmId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this project?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">This cannot be undone.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmId && void remove(confirmId)}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
