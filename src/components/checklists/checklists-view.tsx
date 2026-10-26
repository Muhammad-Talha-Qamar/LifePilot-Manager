"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus } from "lucide-react";
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

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header className="animate-fade-up flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Checklists</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Spacious lists with clear progress — no clutter.
          </p>
        </div>
        <Button onClick={() => setOpen(true)} className="rounded-xl">
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
              className="lp-glass hover-lift animate-fade-up rounded-2xl border p-5"
              style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold tracking-tight">{cl.title}</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {cl.progress.completed}/{cl.progress.total} complete
                  </p>
                </div>
                <span className="text-sm font-medium text-primary">{cl.progress.percent}%</span>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="progress-bar-fill h-full rounded-full bg-primary"
                  style={{ width: `${cl.progress.percent}%` }}
                />
              </div>
              <ul className="mt-4 space-y-1">
                {cl.items.map((item) => (
                  <li key={item.id}>
                    <label className="list-row lp-row-hover flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2">
                      <Checkbox
                        checked={item.is_completed}
                        onCheckedChange={() => void toggle(cl.id, item)}
                        className="h-5 w-5"
                      />
                      <span
                        className={
                          item.is_completed
                            ? "task-done text-sm text-muted-foreground line-through"
                            : "text-sm"
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New checklist</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="cl-title">Title</Label>
              <Input
                id="cl-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="cl-items">Items (one per line)</Label>
              <textarea
                id="cl-items"
                className="lp-glass-input min-h-[100px] w-full rounded-xl border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
    </div>
  );
}
