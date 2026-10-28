"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ProductivityPreferences, UserMemory } from "@/types";

const ZONES = [
  "Asia/Karachi",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Europe/London",
  "America/New_York",
  "America/Los_Angeles",
  "UTC",
];

export default function SettingsPage() {
  const [prefs, setPrefs] = useState<ProductivityPreferences | null>(null);
  const [memories, setMemories] = useState<UserMemory[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [openai, setOpenai] = useState<boolean | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [memoryBusy, setMemoryBusy] = useState(false);

  async function loadMemories() {
    const data = await api<{ memories: UserMemory[] }>("/api/memories");
    setMemories(data.memories ?? []);
  }

  useEffect(() => {
    void api<ProductivityPreferences>("/api/preferences")
      .then(setPrefs)
      .catch((error) =>
        toast.error(error instanceof Error ? error.message : "Could not load settings")
      );
    void loadMemories().catch((error) =>
      toast.error(error instanceof Error ? error.message : "Could not load memories")
    );
    void api<{ openai: boolean }>("/api/health")
      .then((health) => setOpenai(health.openai))
      .catch(() => setOpenai(null));
    void api<{ isDemo: boolean }>("/api/auth/me")
      .then((me) => setIsDemo(me.isDemo))
      .catch(() => setIsDemo(false));
  }, []);

  async function resetBoard(sample: boolean) {
    if (resetting) return;
    setResetting(true);
    try {
      await api("/api/demo/reset", {
        method: "POST",
        body: JSON.stringify({ sample }),
      });
      toast.success(sample ? "Sample data loaded" : "Board cleared");
      window.location.reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update board");
    } finally {
      setResetting(false);
    }
  }

  async function save() {
    if (!prefs) return;
    setSaving(true);
    try {
      const saved = await api<ProductivityPreferences>("/api/preferences", {
        method: "PUT",
        body: JSON.stringify({
          timezone: prefs.timezone,
          preferred_working_hours_start: prefs.preferred_working_hours_start,
          preferred_working_hours_end: prefs.preferred_working_hours_end,
          default_task_duration_minutes: prefs.default_task_duration_minutes,
          week_starts_on: prefs.week_starts_on,
        }),
      });
      setPrefs(saved);
      toast.success("Settings saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save settings");
    } finally {
      setSaving(false);
    }
  }

  async function saveMemoryEdit(id: string) {
    if (memoryBusy) return;
    const content = editDraft.trim();
    if (!content) {
      toast.error("Memory cannot be empty");
      return;
    }
    setMemoryBusy(true);
    try {
      await api<UserMemory>("/api/memories", {
        method: "PUT",
        body: JSON.stringify({ id, content }),
      });
      setEditingId(null);
      setEditDraft("");
      await loadMemories();
      toast.success("Memory updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update memory");
    } finally {
      setMemoryBusy(false);
    }
  }

  async function removeMemory(id: string) {
    if (memoryBusy) return;
    setMemoryBusy(true);
    try {
      await api(`/api/memories?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      setMemories((current) => current.filter((memory) => memory.id !== id));
      if (editingId === id) {
        setEditingId(null);
        setEditDraft("");
      }
      toast.success("Memory deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete memory");
    } finally {
      setMemoryBusy(false);
    }
  }

  async function clearMemories() {
    if (memoryBusy) return;
    setMemoryBusy(true);
    try {
      await api("/api/memories?clear_all=true", { method: "DELETE" });
      setMemories([]);
      setEditingId(null);
      setEditDraft("");
      toast.success("All memories cleared");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not clear memories");
    } finally {
      setMemoryBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <header className="animate-fade-up">
        <h1 className="page-title">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Timezone, working hours, and what the assistant should remember across chats.
        </p>
      </header>

      <section className="lp-glass animate-fade-up rounded-2xl border p-5" style={{ animationDelay: "40ms" }}>
        <h2 className="text-sm font-semibold">Assistant</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {openai === null
            ? "Checking whether the AI assistant is connected…"
            : openai
              ? "Cloud AI is connected. Talk naturally — like ChatGPT — and LifePilot will update your tasks and checklists."
              : "Cloud AI is not connected yet (no OpenAI key). Everyday phrasing still works for tasks, checklists, and dates. Add OPENAI_API_KEY on the server for full open-ended understanding."}
        </p>
      </section>

      <section className="lp-glass animate-fade-up rounded-2xl border p-5" style={{ animationDelay: "60ms" }}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Assistant memory</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Persistent preferences and context notes you asked LifePilot to keep. Task status always comes from your board, not from memory.
            </p>
          </div>
          {memories.length > 0 && (
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              disabled={memoryBusy}
              onClick={() => void clearMemories()}
            >
              Clear all
            </Button>
          )}
        </div>
        <div className="mt-4 space-y-3">
          {memories.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No saved memories yet. In chat, say “remember that I prefer concise summaries” or similar.
            </p>
          ) : (
            memories.map((memory) => (
              <div key={memory.id} className="rounded-xl border border-border/60 bg-background/40 p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="rounded-md bg-muted px-1.5 py-0.5 capitalize">{memory.category}</span>
                  {memory.key && <span>{memory.key}</span>}
                </div>
                {editingId === memory.id ? (
                  <div className="mt-2 space-y-2">
                    <textarea
                      value={editDraft}
                      onChange={(event) => setEditDraft(event.target.value)}
                      rows={3}
                      maxLength={500}
                      className="lp-glass-input w-full rounded-xl border px-3 py-2 text-sm outline-none transition-[border-color,box-shadow] duration-150 focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        className="rounded-xl"
                        disabled={memoryBusy}
                        onClick={() => void saveMemoryEdit(memory.id)}
                      >
                        Save
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-xl"
                        disabled={memoryBusy}
                        onClick={() => {
                          setEditingId(null);
                          setEditDraft("");
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
                    <p className="text-sm leading-relaxed">{memory.content}</p>
                    <div className="flex shrink-0 gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="rounded-xl"
                        disabled={memoryBusy}
                        onClick={() => {
                          setEditingId(memory.id);
                          setEditDraft(memory.content);
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="rounded-xl"
                        disabled={memoryBusy}
                        onClick={() => void removeMemory(memory.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </section>

      {prefs && (
        <section className="lp-glass animate-fade-up rounded-2xl border p-5" style={{ animationDelay: "80ms" }}>
          <h2 className="text-sm font-semibold">Schedule</h2>
          <div className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="timezone">Timezone</Label>
              <select
                id="timezone"
                value={prefs.timezone}
                onChange={(event) => setPrefs({ ...prefs, timezone: event.target.value })}
                className="lp-glass-input h-10 w-full rounded-xl border px-3 text-sm outline-none transition-[border-color,box-shadow] duration-150 focus-visible:ring-2 focus-visible:ring-ring"
              >
                {!ZONES.includes(prefs.timezone) && (
                  <option value={prefs.timezone}>{prefs.timezone}</option>
                )}
                {ZONES.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="start">Work starts</Label>
                <Input
                  id="start"
                  type="time"
                  value={prefs.preferred_working_hours_start ?? ""}
                  onChange={(event) =>
                    setPrefs({ ...prefs, preferred_working_hours_start: event.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="end">Work ends</Label>
                <Input
                  id="end"
                  type="time"
                  value={prefs.preferred_working_hours_end ?? ""}
                  onChange={(event) =>
                    setPrefs({ ...prefs, preferred_working_hours_end: event.target.value })
                  }
                />
              </div>
            </div>
            <Button type="button" className="rounded-xl" onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : "Save settings"}
            </Button>
          </div>
        </section>
      )}

      {isDemo && (
        <section className="lp-glass animate-fade-up rounded-2xl border p-5" style={{ animationDelay: "120ms" }}>
          <h2 className="text-sm font-semibold">Your board</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            New accounts start empty. Clear everything, or load optional sample data to explore.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              disabled={resetting}
              onClick={() => void resetBoard(false)}
            >
              Clear my data
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="rounded-xl"
              disabled={resetting}
              onClick={() => void resetBoard(true)}
            >
              Load sample data
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
