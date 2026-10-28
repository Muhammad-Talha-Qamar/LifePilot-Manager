"use client";

import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/client-api";
import { notifyDataChanged } from "@/lib/data-events";
import { formatDateOnly } from "@/lib/utils/dates";
import type {
  AssistantBlock,
  ChecklistCardData,
  ProjectCardData,
  TaskCardData,
} from "@/lib/ai/types";
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
  if (!blocks.length) return null;
  const onlyInterpretation = blocks.every((block) => block.type === "interpretation");
  return (
    <div
      className={
        onlyInterpretation
          ? "w-full min-w-0 max-w-full space-y-2"
          : "mt-1 w-full min-w-0 max-w-full space-y-2.5 sm:mt-1.5"
      }
    >
      {blocks.map((block, index) => (
        <Block key={`${block.type}-${index}`} block={block} />
      ))}
    </div>
  );
}

function Block({ block }: { block: AssistantBlock }) {
  const { send, busy } = useAssistant();

  if (block.type === "steps") {
    return (
      <div className="ai-block-card rounded-xl border border-border/60 bg-surface-soft/80 px-3 py-2.5">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {block.title}
        </p>
        <ul className="mt-1.5 space-y-1">
          {block.steps.map((step, index) => (
            <li
              key={`${step.name}-${index}`}
              className="flex items-center gap-2 text-[12px] text-foreground/90 sm:text-[13px]"
            >
              <span
                className={
                  step.status === "done"
                    ? "text-emerald-600"
                    : step.status === "error"
                      ? "text-rose-600"
                      : "text-muted-foreground"
                }
                aria-hidden
              >
                {step.status === "done" ? "✓" : step.status === "error" ? "!" : "·"}
              </span>
              <span>{step.label}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (block.type === "followups") {
    return (
      <div className="flex flex-wrap gap-1.5 pt-0.5" role="group" aria-label="Suggested follow-ups">
        {block.suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            disabled={busy}
            onClick={() => void send(suggestion)}
            className="ai-suggestion !rounded-lg !px-2.5 !py-1 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:!rounded-xl sm:text-xs"
          >
            {suggestion}
          </button>
        ))}
      </div>
    );
  }

  if (block.type === "tasks") return <TaskList title={block.title} tasks={block.tasks} />;
  if (block.type === "checklists") {
    return (
      <div className="w-full min-w-0 space-y-2.5">
        {block.checklists.map((checklist) => (
          <ChecklistCard key={checklist.id} checklist={checklist} />
        ))}
      </div>
    );
  }
  if (block.type === "projects") {
    return (
      <div className="w-full min-w-0 space-y-2.5">
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
    return (
      <div
        className={`ai-notice ai-notice--${block.tone} animate-fade-up`}
        role={block.tone === "error" ? "alert" : "status"}
      >
        <span className="ai-notice__label">
          {block.tone === "success" ? "Done" : block.tone === "error" ? "Failed" : "Note"}
        </span>
        <p className="ai-notice__text">{block.text}</p>
      </div>
    );
  }
  if (block.type === "interpretation") {
    return (
      <div
        className={
          block.uncertain
            ? "ai-interpretation ai-interpretation--uncertain animate-interpretation"
            : "ai-interpretation animate-interpretation"
        }
        role="status"
        aria-label={`${block.label}: ${block.text}`}
      >
        <span className="ai-interpretation__label">{block.label}</span>
        <span className="ai-interpretation__text">“{block.text}”</span>
      </div>
    );
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
  const { refreshRecords, busy } = useAssistant();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [due, setDue] = useState(task.due_date ?? "");
  const [priority, setPriority] = useState(task.priority);

  async function toggle(checked: boolean) {
    if (toggling || busy) return;
    setToggling(true);
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
    } finally {
      setToggling(false);
    }
  }

  async function save() {
    if (saving) return;
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
          disabled={toggling || busy}
          onCheckedChange={(value) => void toggle(value === true)}
          aria-label={`Mark ${task.title} ${task.status === "done" ? "incomplete" : "complete"}`}
          aria-busy={toggling || undefined}
          className="mt-0.5 h-5 w-5 shrink-0"
        />
        <button
          type="button"
          className="min-w-0 flex-1 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={openEditor}
        >
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
            {toggling ? " · Updating…" : ""}
          </p>
        </button>
        <div className="flex max-w-[40%] shrink-0 flex-col items-end gap-1">
          <Badge variant={priorityVariant(task.priority)} className="max-w-full truncate">
            {task.priority}
          </Badge>
          {task.overdue && <Badge variant="danger">Overdue</Badge>}
        </div>
      </div>
      <div className="mt-1.5 flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 min-w-11 text-xs"
          onClick={openEditor}
        >
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
  const { refreshRecords, busy } = useAssistant();
  const [pendingItem, setPendingItem] = useState<string | null>(null);
  const done = checklist.items.filter((item) => item.is_completed).length;
  const percent = checklist.items.length
    ? Math.round((done / checklist.items.length) * 100)
    : 0;

  async function toggle(itemId: string, completed: boolean) {
    if (pendingItem || busy) return;
    setPendingItem(itemId);
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
      toast.success(completed ? "Item checked off" : "Item reopened");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the checklist item");
    } finally {
      setPendingItem(null);
    }
  }

  return (
    <article className="ai-block-card animate-fade-up box-border w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-border/70 bg-surface-soft p-3 sm:p-3.5">
      <div className="flex min-w-0 items-start justify-between gap-2 sm:items-center sm:gap-3">
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-medium [overflow-wrap:anywhere]">{checklist.title}</p>
          <p className="mt-0.5 break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">
            {done}/{checklist.items.length} complete
          </p>
        </div>
        <span className="shrink-0 pt-0.5 text-sm font-medium text-primary tabular-nums">
          {percent}%
        </span>
      </div>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="progress-bar-fill h-full rounded-full bg-primary"
          style={{ width: `${percent}%` }}
        />
      </div>
      <ul className="mt-3 space-y-1.5">
        {checklist.items.map((item) => (
          <li
            key={item.id}
            className="list-row flex min-h-10 min-w-0 items-start gap-2.5 rounded-lg px-1 py-1.5 hover:bg-card/50 sm:items-center"
          >
            <Checkbox
              checked={item.is_completed}
              disabled={pendingItem === item.id || busy}
              onCheckedChange={(value) => void toggle(item.id, value === true)}
              aria-label={`${item.is_completed ? "Reopen" : "Complete"} ${item.title}`}
              aria-busy={pendingItem === item.id || undefined}
              className="mt-0.5 h-5 w-5 shrink-0 sm:mt-0"
            />
            <span
              className={
                item.is_completed
                  ? "min-w-0 flex-1 break-words text-sm text-muted-foreground line-through [overflow-wrap:anywhere]"
                  : "min-w-0 flex-1 break-words text-sm [overflow-wrap:anywhere]"
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
        className="ai-block-card animate-fade-up box-border w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-border/70 bg-surface-soft p-3 text-left sm:p-3.5"
      >
        <div className="flex min-w-0 items-start justify-between gap-2 sm:gap-3">
          <div className="min-w-0 flex-1">
            <p className="break-words text-sm font-medium [overflow-wrap:anywhere]">{project.name}</p>
            <p className="mt-0.5 break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">
              {project.deadline ? `Deadline ${formatDateOnly(project.deadline)}` : "No deadline"} ·{" "}
              {project.status}
            </p>
          </div>
          <Badge variant={priorityVariant(project.priority)} className="shrink-0">
            {project.progress_percent}%
          </Badge>
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
              <li key={task.id} className="min-w-0 break-words [overflow-wrap:anywhere]">
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
    <div className="ai-block-card animate-scale-in box-border w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-border/80 bg-surface-soft p-3 sm:p-3.5">
      <p className="break-words text-sm [overflow-wrap:anywhere]">{prompt}</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button
          type="button"
          size="sm"
          className="w-full sm:w-auto"
          disabled={busy}
          onClick={() => void confirm(action)}
        >
          Confirm delete
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="w-full sm:w-auto"
          disabled={busy}
          onClick={() => void dismissPending()}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
