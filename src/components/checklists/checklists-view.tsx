"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/client-api";
import { notifyDataChanged } from "@/lib/data-events";
import { useDataRefresh } from "@/lib/use-data-refresh";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Checklist, ChecklistItem } from "@/types";

type ChecklistRow = Checklist & {
  items: ChecklistItem[];
  progress: { total: number; completed: number; percent: number };
};

export function ChecklistsView() {
  const [rows, setRows] = useState<ChecklistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [itemsText, setItemsText] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<ChecklistRow[]>("/api/checklists");
      setRows(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load");
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

  async function create() {
    if (!title.trim()) return;
    const items = itemsText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((t) => ({ title: t }));
    try {
      await api("/api/checklists", {
        method: "POST",
        body: JSON.stringify({ title: title.trim(), items }),
      });
      toast.success("Checklist created");
      notifyDataChanged();
      setOpen(false);
      setTitle("");
      setItemsText("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Create failed");
    }
  }

  async function toggle(checklistId: string, item: ChecklistItem) {
    try {
      await api(`/api/checklists/${checklistId}`, {
        method: "PATCH",
        body: JSON.stringify({
          itemAction: item.is_completed ? "uncomplete" : "complete",
          item_id: item.id,
        }),
      });
      notifyDataChanged();
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  }

  async function remove(id: string) {
    try {
      await api(`/api/checklists/${id}`, { method: "DELETE" });
      toast.success("Checklist deleted");
      notifyDataChanged();
      setConfirmId(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-3xl space-y-5">
      <header className="animate-fade-up flex flex-wrap items-end justify-between gap-3 sm:gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="page-title">Checklists</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Spacious lists with clear progress — no clutter.
          </p>
        </div>
        <Button onClick={() => setOpen(true)} className="w-full shrink-0 rounded-xl sm:w-auto">
          <Plus className="h-4 w-4" /> New checklist
        </Button>
      </header>

      {loading ? (
        <div className="animate-fade flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="lp-glass-soft animate-fade-up rounded-2xl border border-dashed px-5 py-12 text-center text-sm text-muted-foreground">
          No checklists yet. Create one or ask the assistant.
        </div>
      ) : (
        <div className="grid gap-3">
          {rows.map((cl, index) => (
            <article
              key={cl.id}
              className="lp-glass hover-lift animate-fade-up box-border w-full min-w-0 max-w-full overflow-hidden rounded-2xl border p-4 sm:p-5"
              style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
            >
              <div className="flex min-w-0 items-start justify-between gap-2 sm:items-center sm:gap-3">
                <div className="min-w-0 flex-1">
                  <h2 className="break-words text-base font-semibold tracking-tight [overflow-wrap:anywhere]">
                    {cl.title}
                  </h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {cl.progress.completed}/{cl.progress.total} complete
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <span className="text-sm font-medium text-primary tabular-nums">
                    {cl.progress.percent}%
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-foreground/70 hover:text-foreground"
                    aria-label={`Delete ${cl.title}`}
                    onClick={() => setConfirmId(cl.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="progress-bar-fill h-full rounded-full bg-primary"
                  style={{ width: `${cl.progress.percent}%` }}
                />
              </div>
              <ul className="mt-4 space-y-1">
                {cl.items.map((item) => (
                  <li key={item.id} className="min-w-0">
                    <label className="list-row lp-row-hover flex min-h-11 min-w-0 cursor-pointer items-start gap-3 rounded-xl px-2.5 py-2 sm:items-center">
                      <Checkbox
                        checked={item.is_completed}
                        onCheckedChange={() => void toggle(cl.id, item)}
                        className="mt-0.5 h-5 w-5 shrink-0 sm:mt-0"
                      />
                      <span
                        className={
                          item.is_completed
                            ? "task-done min-w-0 flex-1 break-words text-sm text-muted-foreground line-through [overflow-wrap:anywhere]"
                            : "min-w-0 flex-1 break-words text-sm [overflow-wrap:anywhere]"
                        }
                      >
                        {item.title}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="min-w-0">
          <DialogHeader>
            <DialogTitle>New checklist</DialogTitle>
          </DialogHeader>
          <div className="min-w-0 space-y-3">
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="cl-title">Title</Label>
              <Input
                id="cl-title"
                className="w-full min-w-0"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="cl-items">Items (one per line)</Label>
              <textarea
                id="cl-items"
                className="lp-glass-input min-h-[100px] w-full min-w-0 rounded-xl border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={itemsText}
                onChange={(e) => setItemsText(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void create()}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(confirmId)} onOpenChange={(o) => !o && setConfirmId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this checklist?</DialogTitle>
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
