"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ProductivityPreferences } from "@/types";

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
  const [openai, setOpenai] = useState<boolean | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    void api<ProductivityPreferences>("/api/preferences")
      .then(setPrefs)
      .catch((error) =>
        toast.error(error instanceof Error ? error.message : "Could not load settings")
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

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <header className="animate-fade-up">
        <h1 className="page-title">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Timezone and working hours help the assistant resolve dates.
        </p>
      </header>

      <section className="lp-glass animate-fade-up rounded-2xl border p-5" style={{ animationDelay: "40ms" }}>
        <h2 className="text-sm font-semibold">Assistant</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {openai === null
            ? "Checking whether the AI assistant is connected…"
            : openai
              ? "The AI assistant is connected and can help with open-ended requests using your saved tasks and checklists."
              : "The full AI assistant is not connected yet. Clear requests still work for tasks, checklists, and dates. An administrator can connect the AI service for richer conversation."}
        </p>
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
