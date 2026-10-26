"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/client-api";
import { useDataRefresh } from "@/lib/use-data-refresh";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CalendarEvent, Task } from "@/types";

export default function CalendarPage() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [selected, setSelected] = useState(() => new Date());

  async function load() {
    try {
      const [ev, ts] = await Promise.all([
        api<CalendarEvent[]>("/api/events"),
        api<Task[]>("/api/tasks"),
      ]);
      setEvents(ev);
      setTasks(
        ts.filter(
          (t) => t.due_date && t.status !== "done" && t.status !== "cancelled"
        )
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load");
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

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [cursor]);

  const selectedKey = format(selected, "yyyy-MM-dd");

  const dayEvents = events.filter((e) =>
    isSameDay(new Date(e.start_at), selected)
  );
  const dayTasks = tasks.filter((t) => t.due_date === selectedKey);

  function markersFor(day: Date) {
    const key = format(day, "yyyy-MM-dd");
    const hasEvent = events.some((e) => isSameDay(new Date(e.start_at), day));
    const hasTask = tasks.some((t) => t.due_date === key);
    return { hasEvent, hasTask };
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-4xl space-y-4 sm:space-y-5">
      <header className="animate-fade-up">
        <h1 className="page-title">Calendar</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Browse dates, then review events and due tasks for the day.
        </p>
      </header>

      {loading ? (
        <div className="animate-fade flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div
          className="animate-fade-up grid w-full min-w-0 gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]"
          style={{ animationDelay: "40ms" }}
        >
          <section className="lp-glass hover-lift min-w-0 overflow-hidden rounded-2xl border p-3 sm:p-4 md:p-5">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 className="font-display text-base font-semibold tracking-tight">
                {format(cursor, "MMMM yyyy")}
              </h2>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  aria-label="Previous month"
                  onClick={() => setCursor((d) => subMonths(d, 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-xl"
                  onClick={() => {
                    const today = new Date();
                    setCursor(startOfMonth(today));
                    setSelected(today);
                  }}
                >
                  Today
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  aria-label="Next month"
                  onClick={() => setCursor((d) => addMonths(d, 1))}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="mb-2 grid grid-cols-7 gap-1 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                <div key={d} className="py-1">
                  {d}
                </div>
              ))}
            </div>

            <div className="grid w-full min-w-0 grid-cols-7 gap-0.5 sm:gap-1">
              {days.map((day) => {
                const { hasEvent, hasTask } = markersFor(day);
                const inMonth = isSameMonth(day, cursor);
                const isSelected = isSameDay(day, selected);
                const isToday = isSameDay(day, new Date());
                return (
                  <button
                    key={day.toISOString()}
                    type="button"
                    onClick={() => setSelected(day)}
                    className={cn(
                      "calendar-day flex min-h-9 w-full min-w-0 flex-col items-center justify-center rounded-lg px-0.5 py-1 text-xs sm:min-h-11 sm:rounded-xl sm:px-1 sm:py-1.5 sm:text-sm",
                      !inMonth && "text-muted-foreground/45",
                      isSelected
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "hover:bg-white/15 dark:hover:bg-white/10",
                      isToday && !isSelected && "ring-1 ring-primary/35"
                    )}
                    aria-label={format(day, "EEEE, MMMM d")}
                    aria-pressed={isSelected}
                  >
                    <span>{format(day, "d")}</span>
                    <span className="mt-0.5 flex h-1.5 gap-0.5">
                      {hasEvent && (
                        <span
                          className={cn(
                            "h-1 w-1 rounded-full",
                            isSelected ? "bg-primary-foreground/80" : "bg-primary"
                          )}
                        />
                      )}
                      {hasTask && (
                        <span
                          className={cn(
                            "h-1 w-1 rounded-full",
                            isSelected ? "bg-primary-foreground/55" : "bg-muted-foreground"
                          )}
                        />
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <div className="space-y-3">
            <section
              key={selectedKey}
              className="lp-glass animate-fade-up rounded-2xl border p-4 sm:p-5"
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">{format(selected, "EEE, MMM d")}</h2>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label="Previous day"
                    onClick={() => setSelected((d) => addDays(d, -1))}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label="Next day"
                    onClick={() => setSelected((d) => addDays(d, 1))}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Events
              </h3>
              {dayEvents.length === 0 ? (
                <p className="mb-4 text-sm text-muted-foreground">No events.</p>
              ) : (
                <ul className="mb-4 space-y-2.5">
                  {dayEvents.map((e) => (
                    <li key={e.id} className="lp-glass-soft list-row-enter rounded-xl border px-3 py-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium">{e.title}</p>
                        <Badge variant="secondary">{e.event_type}</Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {e.all_day ? "All day" : new Date(e.start_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        {e.location ? ` · ${e.location}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              )}

              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Task due dates
              </h3>
              {dayTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tasks due.</p>
              ) : (
                <ul className="space-y-2.5">
                  {dayTasks.map((t) => (
                    <li key={t.id} className="lp-glass-soft list-row-enter rounded-xl border px-3 py-2.5">
                      <p className="text-sm font-medium">{t.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Due {t.due_date}
                        {t.due_time ? ` at ${t.due_time}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
