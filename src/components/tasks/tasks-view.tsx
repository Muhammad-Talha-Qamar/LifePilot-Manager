"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/client-api";
import { notifyDataChanged } from "@/lib/data-events";
import { useDataRefresh } from "@/lib/use-data-refresh";
import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Priority, Task, TaskStatus } from "@/types";

export function TasksView() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [dueDate, setDueDate] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("query", query.trim());
      if (status !== "all") params.set("status", status);
      const data = await api<Task[]>(`/api/tasks?${params}`);
      setTasks(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load tasks");
    } finally {
      setLoading(false);
    }
  }, [query, status]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 200);
    return () => clearTimeout(t);
  }, [load]);

  useDataRefresh(() => {
    void load();
  });

  async function createTask() {
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    setSaving(true);
    try {
      await api<Task>("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          priority,
          due_date: dueDate || null,
          status: "todo" as TaskStatus,
        }),
      });
      toast.success("Task created");
      notifyDataChanged();
      setOpen(false);
      setTitle("");
      setDueDate("");
      setPriority("medium");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Create failed");
    } finally {
      setSaving(false);
    }
  }

  async function toggleComplete(task: Task) {
    const next: TaskStatus = task.status === "done" ? "todo" : "done";
    try {
      await api(`/api/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      });
      notifyDataChanged();
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  }

  async function remove(id: string) {
    try {
      await api(`/api/tasks/${id}`, { method: "DELETE" });
      toast.success("Task deleted");
      notifyDataChanged();
      setConfirmId(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-3xl space-y-4 sm:space-y-5">
      <header className="animate-fade-up flex flex-wrap items-end justify-between gap-3 sm:gap-4">
        <div className="min-w-0">
          <h1 className="page-title">Tasks</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Search, filter, and complete work in one clean list.
          </p>
        </div>
        <Button onClick={() => setOpen(true)} className="rounded-xl">
          <Plus className="h-4 w-4" /> New task
        </Button>
      </header>

      <div className="animate-fade-up flex flex-wrap gap-2 sm:gap-2.5" style={{ animationDelay: "40ms" }}>
        <Input
          className="w-full max-w-full rounded-xl sm:max-w-xs"
          placeholder="Search tasks…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search tasks"
        />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-full rounded-xl sm:w-[150px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="todo">Todo</SelectItem>
            <SelectItem value="in_progress">In progress</SelectItem>
            <SelectItem value="done">Done</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div
        className="lp-glass animate-fade-up rounded-2xl border"
        style={{ animationDelay: "80ms" }}
      >
        <div className="border-b border-border/60 px-5 py-3">
          <p className="text-sm text-muted-foreground">
            {loading ? "Loading…" : `${tasks.length} task${tasks.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="px-2 py-1 sm:px-3">
          {loading ? (
            <div className="flex items-center gap-2 px-3 py-8 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading
            </div>
          ) : tasks.length === 0 ? (
            <p className="animate-fade py-12 text-center text-sm text-muted-foreground">
              No tasks yet. Create one or ask the assistant.
            </p>
          ) : (
            <ul>
              {tasks.map((task, index) => (
                <li
                  key={task.id}
                  className="list-row list-row-enter lp-row-hover flex min-w-0 items-center gap-2 rounded-xl px-2 py-2.5 sm:gap-3 sm:px-3 sm:py-3"
                  style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}
                >
                  <Checkbox
                    checked={task.status === "done"}
                    onCheckedChange={() => void toggleComplete(task)}
                    aria-label={`Mark ${task.title} ${task.status === "done" ? "incomplete" : "complete"}`}
                    className="h-5 w-5 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className={
                        task.status === "done"
                          ? "task-done break-words text-sm text-muted-foreground line-through"
                          : "break-words text-sm font-medium"
                      }
                    >
                      {task.title}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {task.due_date || "No due date"}
                      {task.category ? ` · ${task.category}` : ""}
                    </p>
                  </div>
                  <Badge
                    variant={
                      task.priority === "urgent" || task.priority === "high"
                        ? "danger"
                        : task.priority === "medium"
                          ? "warning"
                          : "secondary"
                    }
                  >
                    {task.priority}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0 text-muted-foreground opacity-70 transition-opacity hover:opacity-100"
                    aria-label={`Delete ${task.title}`}
                    onClick={() => setConfirmId(task.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New task</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="task-title">Title</Label>
              <Input
                id="task-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void createTask();
                }}
              />
            </div>
            <div>
              <Label>Priority</Label>
              <Select
                value={priority}
                onValueChange={(v) => setPriority(v as Priority)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="due">Due date</Label>
              <Input
                id="due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void createTask()} disabled={saving}>
              {saving ? "Saving…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(confirmId)} onOpenChange={(o) => !o && setConfirmId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this task?</DialogTitle>
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
