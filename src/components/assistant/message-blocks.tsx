"use client";

import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/client-api";
import { notifyDataChanged } from "@/lib/data-events";
import { formatDateOnly } from "@/lib/utils/dates";
import type { AssistantBlock, ChecklistCardData, ProjectCardData, TaskCardData } from "@/lib/ai/types";
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
import { useAssistant } from "./assistant-provider";

function priorityVariant(priority: string): "danger" | "warning" | "secondary" {
  if (priority === "urgent" || priority === "high") return "danger";
  if (priority === "medium") return "warning";
  return "secondary";
}

export function MessageBlocks({ blocks }: { blocks: AssistantBlock[] }) {
  return (
    <div className="mt-3.5 space-y-2.5">
      {blocks.map((block, index) => (
        <Block key={`${block.type}-${index}`} block={block} />
      ))}
    </div>
  );
}

function Block({ block }: { block: AssistantBlock }) {
  if (block.type === "tasks") return <TaskList title={block.title} tasks={block.tasks} />;
  if (block.type === "checklists") {
    return (
      <div className="space-y-2.5">
        {block.checklists.map((checklist) => (
          <ChecklistCard key={checklist.id} checklist={checklist} />
        ))}
      </div>
    );
  }
  if (block.type === "projects") {
    return (
      <div className="space-y-2.5">
        <p className="text-xs font-medium text-muted-foreground">{block.title}</p>
        {block.projects.map((project) => (
          <ProjectCard key={project.id} project={project} />
        ))}
      </div>
    );
  }
  if (block.type === "events") {
    return (
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">{block.title}</p>
        {block.events.map((event) => (
          <div
            key={event.id}
            className="ai-block-card animate-fade-up rounded-xl border border-border/70 bg-surface-soft px-3.5 py-2.5"
          >
            <div className="flex min-w-0 items-start justify-between gap-2">
              <p className="min-w-0 flex-1 break-words text-sm font-medium">{event.title}</p>
              <Badge variant="secondary" className="shrink-0">
                {event.event_type}
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {event.all_day ? "All day" : new Date(event.start_at).toLocaleString()}
              {event.location ? ` · ${event.location}` : ""}
            </p>
          </div>
        ))}
      </div>
    );
  }
  if (block.type === "schedule") {
    return (
      <div className="ai-block-card animate-fade-up min-w-0 rounded-xl border border-border/70 bg-surface-soft p-3 sm:p-3.5">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <p className="min-w-0 flex-1 break-words text-sm font-medium">{block.title}</p>
          <Badge variant="outline" className="shrink-0">
            Suggestion
          </Badge>
        </div>
        <p className="mt-1 break-words text-xs text-muted-foreground">{block.note}</p>
        <ol className="mt-3 space-y-2">
          {block.slots.length === 0 && (
            <li className="text-sm text-muted-foreground">Nothing to place on the plan.</li>
          )}
          {block.slots.map((slot, index) => (
            <li
              key={`${slot.title}-${index}`}
              className="flex min-w-0 flex-col gap-0.5 text-sm sm:flex-row sm:gap-3"
            >
              <span className="shrink-0 text-muted-foreground sm:w-16">{slot.time_label}</span>
              <span className="min-w-0 break-words">
                {slot.title}
                {slot.minutes ? ` · ${slot.minutes}m` : ""}
              </span>
            </li>
          ))}
        </ol>
      </div>
    );
  }
  if (block.type === "confirm") return <ConfirmBlock prompt={block.prompt} action={block.action} />;
  if (block.type === "notice") {
    return <p className="text-sm text-muted-foreground">{block.text}</p>;
  }
  return null;
}

function TaskList({ title, tasks }: { title: string; tasks: TaskCardData[] }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      {tasks.length === 0 ? (
        <p className="ai-block-card rounded-xl border border-dashed px-3.5 py-3 text-sm text-muted-foreground">
          No tasks in this group.
        </p>
      ) : (
        tasks.map((task) => <TaskCard key={task.id} task={task} />)
      )}
    </div>
  );
}

function TaskCard({ task }: { task: TaskCardData }) {
  const { refreshRecords } = useAssistant();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [due, setDue] = useState(task.due_date ?? "");
  const [priority, setPriority] = useState(task.priority);

  async function toggle(checked: boolean) {
    try {
      await api(`/api/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: checked ? "done" : "todo" }),
      });
      notifyDataChanged();
      await refreshRecords();
      toast.success(checked ? `Completed “${task.title}”` : `Reopened “${task.title}”`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the task");
    }
  }

  async function save() {
    setSaving(true);
    try {
      await api(`/api/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: title.trim(),
          due_date: due || null,
          priority,
        }),
      });
      notifyDataChanged();
      await refreshRecords();
      setOpen(false);
      toast.success(`Updated “${title.trim()}”`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the task");
    } finally {
      setSaving(false);
    }
  }

  function openEditor() {
    setTitle(task.title);
    setDue(task.due_date ?? "");
    setPriority(task.priority);
    setOpen(true);
  }

  return (
    <article className="ai-block-card animate-fade-up min-w-0 overflow-hidden rounded-xl border border-border/70 bg-surface-soft px-3 py-2.5 sm:px-3.5">
      <div className="flex min-w-0 items-start gap-2.5 sm:gap-3">
        <Checkbox
          checked={task.status === "done"}
          onCheckedChange={(value) => void toggle(value === true)}
          aria-label={`Mark ${task.title} ${task.status === "done" ? "incomplete" : "complete"}`}
          className="mt-0.5 h-5 w-5 shrink-0"
        />
        <button type="button" className="min-w-0 flex-1 text-left" onClick={openEditor}>
          <p
            className={
              task.status === "done"
                ? "break-words text-sm font-medium text-muted-foreground line-through"
                : "break-words text-sm font-medium"
            }
          >
            {task.title}
          </p>
          <p className="mt-0.5 break-words text-xs text-muted-foreground">
            {task.due_date ? formatDateOnly(task.due_date) : "No deadline"}
            {task.due_time ? ` · ${task.due_time.slice(0, 5)}` : ""}
            {task.project_name ? ` · ${task.project_name}` : ""}
          </p>
        </button>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge variant={priorityVariant(task.priority)}>{task.priority}</Badge>
          {task.overdue && <Badge variant="danger">Overdue</Badge>}
        </div>
      </div>
      <div className="mt-1.5 flex justify-end">
        <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={openEditor}>
          Edit
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Task details</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor={`title-${task.id}`}>Title</Label>
              <Input
                id={`title-${task.id}`}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`due-${task.id}`}>Deadline</Label>
              <Input
                id={`due-${task.id}`}
                type="date"
                value={due}
                onChange={(event) => setDue(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`priority-${task.id}`}>Priority</Label>
              <Select
                value={priority}
                onValueChange={(value) => setPriority(value as typeof priority)}
              >
                <SelectTrigger id={`priority-${task.id}`}>
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
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button type="button" onClick={() => void save()} disabled={saving || !title.trim()}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  );
}

function ChecklistCard({ checklist }: { checklist: ChecklistCardData }) {
  const { refreshRecords } = useAssistant();
  const done = checklist.items.filter((item) => item.is_completed).length;
  const percent = checklist.items.length
    ? Math.round((done / checklist.items.length) * 100)
    : 0;

  async function toggle(itemId: string, completed: boolean) {
    try {
      await api(`/api/checklists/${checklist.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          itemAction: completed ? "complete" : "uncomplete",
          item_id: itemId,
        }),
      });
      notifyDataChanged();
      await refreshRecords();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the checklist item");
    }
  }

  return (
    <article className="ai-block-card animate-fade-up min-w-0 overflow-hidden rounded-xl border border-border/70 bg-surface-soft p-3 sm:p-3.5">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-sm font-medium">{checklist.title}</p>
          <p className="text-xs text-muted-foreground">
            {done}/{checklist.items.length} complete
            {checklist.project_name ? ` · ${checklist.project_name}` : ""}
          </p>
        </div>
        <span className="text-sm font-medium text-primary">{percent}%</span>
      </div>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="progress-bar-fill h-full rounded-full bg-primary"
          style={{ width: `${percent}%` }}
        />
      </div>
      <ul className="mt-3 space-y-1.5">
        {checklist.items.map((item) => (
          <li key={item.id} className="list-row flex min-h-10 items-center gap-2.5 rounded-lg px-1 hover:bg-card/50">
            <Checkbox
              checked={item.is_completed}
              onCheckedChange={(value) => void toggle(item.id, value === true)}
              aria-label={`${item.is_completed ? "Reopen" : "Complete"} ${item.title}`}
              className="h-5 w-5"
            />
            <span
              className={
                item.is_completed
                  ? "text-sm text-muted-foreground line-through"
                  : "text-sm"
              }
            >
              {item.title}
            </span>
          </li>
        ))}
        {checklist.items.length === 0 && (
          <li className="text-sm text-muted-foreground">No items yet.</li>
        )}
      </ul>
    </article>
  );
}

function ProjectCard({ project }: { project: ProjectCardData }) {
  const { refreshRecords } = useAssistant();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(project.name);
  const [deadline, setDeadline] = useState(project.deadline ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await api(`/api/projects/${project.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: name.trim(), deadline: deadline || null }),
      });
      notifyDataChanged();
      await refreshRecords();
      setOpen(false);
      toast.success(`Updated “${name.trim()}”`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the project");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ai-block-card animate-fade-up w-full min-w-0 overflow-hidden rounded-xl border border-border/70 bg-surface-soft p-3 text-left sm:p-3.5"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium">{project.name}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {project.deadline ? `Deadline ${formatDateOnly(project.deadline)}` : "No deadline"} ·{" "}
              {project.status}
            </p>
          </div>
          <Badge variant={priorityVariant(project.priority)}>{project.progress_percent}%</Badge>
        </div>
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${project.progress_percent}%` }}
          />
        </div>
        {project.tasks.length > 0 && (
          <ul className="mt-2.5 space-y-1 text-xs text-muted-foreground">
            {project.tasks.slice(0, 4).map((task) => (
              <li key={task.id}>
                {task.title}
                {task.due_date ? ` · ${formatDateOnly(task.due_date)}` : ""}
              </li>
            ))}
          </ul>
        )}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Project details</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor={`project-${project.id}`}>Name</Label>
              <Input
                id={`project-${project.id}`}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`project-due-${project.id}`}>Deadline</Label>
              <Input
                id={`project-due-${project.id}`}
                type="date"
                value={deadline}
                onChange={(event) => setDeadline(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button type="button" onClick={() => void save()} disabled={saving || !name.trim()}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ConfirmBlock({
  prompt,
  action,
}: {
  prompt: string;
  action: { tool: string; args: Record<string, unknown> };
}) {
  const { confirm, dismissPending, busy } = useAssistant();
  return (
    <div className="ai-block-card animate-scale-in rounded-xl border border-border/80 bg-surface-soft p-3.5">
      <p className="text-sm">{prompt}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={busy} onClick={() => void confirm(action)}>
          Confirm delete
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void dismissPending()}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
