"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
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
import type {
  CalendarEvent,
  Checklist,
  ChecklistItem,
  Task,
} from "@/types";

type ChecklistRow = Checklist & {
  items: ChecklistItem[];
};

type DatedChecklistItem = ChecklistItem & {
  checklist_title: string;
};

function dayKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const key = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null;
}

export default function CalendarPage() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [checklistItems, setChecklistItems] = useState<DatedChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [selected, setSelected] = useState(() => new Date());

  const load = useCallback(async () => {
    try {
      const [ev, ts, cls] = await Promise.all([
        api<CalendarEvent[]>("/api/events"),
        api<Task[]>("/api/tasks"),
        api<ChecklistRow[]>("/api/checklists"),
      ]);
      setEvents(ev);
      setTasks(
        ts.filter(
          (t) =>
            dayKey(t.due_date) &&
            t.status !== "done" &&
            t.status !== "cancelled"
        )
      );
      setChecklistItems(
        cls.flatMap((cl) =>
          cl.items
            .filter((item) => dayKey(item.due_date) && !item.is_completed)
            .map((item) => ({
              ...item,
              checklist_title: cl.title,
            }))
        )
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useDataRefresh(load);

  useEffect(() => {
    void load();
  }, [load]);

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [cursor]);

  const selectedKey = format(selected, "yyyy-MM-dd");

  const dayEvents = events.filter((e) => dayKey(e.start_at) === selectedKey);
  const dayTasks = tasks.filter((t) => dayKey(t.due_date) === selectedKey);
  const dayChecklistItems = checklistItems.filter(
    (item) => dayKey(item.due_date) === selectedKey
  );

  function markersFor(day: Date) {
    const key = format(day, "yyyy-MM-dd");
    return {
      hasEvent: events.some((e) => dayKey(e.start_at) === key),
      hasTask: tasks.some((t) => dayKey(t.due_date) === key),
      hasChecklist: checklistItems.some((item) => dayKey(item.due_date) === key),
    };
  }

  const dayEmpty =
    dayEvents.length === 0 &&
    dayTasks.length === 0 &&
    dayChecklistItems.length === 0;

  return (
    <div className="mx-auto w-full min-w-0 max-w-4xl space-y-4 sm:space-y-5">
      <header className="animate-fade-up">
        <h1 className="page-title">Calendar</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Browse dates, then review events, tasks, and checklists for the day.
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
                const { hasEvent, hasTask, hasChecklist } = markersFor(day);
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
                      !inMonth && "text-muted-foreground/70",
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
                            isSelected
                              ? "bg-primary-foreground/55"
                              : "bg-muted-foreground"
                          )}
                        />
                      )}
                      {hasChecklist && (
                        <span
                          className={cn(
                            "h-1 w-1 rounded-full",
                            isSelected
                              ? "bg-primary-foreground/30"
                              : "bg-emerald-500"
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
                <h2 className="text-sm font-semibold">
                  {format(selected, "EEE, MMM d")}
                </h2>
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

              {dayEmpty ? (
                <p className="text-sm text-muted-foreground">
                  Nothing scheduled for this day.
                </p>
              ) : (
                <>
                  {dayEvents.length > 0 && (
                    <DaySection title="Events">
                      {dayEvents.map((e) => (
                        <li
                          key={e.id}
                          className="lp-glass-soft list-row-enter rounded-xl border px-3 py-2.5"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-medium">{e.title}</p>
                            <Badge variant="secondary">{e.event_type}</Badge>
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {e.all_day
                              ? "All day"
                              : new Date(e.start_at).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                            {e.location ? ` · ${e.location}` : ""}
                          </p>
                        </li>
                      ))}
                    </DaySection>
                  )}

                  {dayTasks.length > 0 && (
                    <DaySection title="Tasks">
                      {dayTasks.map((t) => (
                        <li
                          key={t.id}
                          className="lp-glass-soft list-row-enter rounded-xl border px-3 py-2.5"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-medium">{t.title}</p>
                            <Badge variant="secondary">{t.priority}</Badge>
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            Due {dayKey(t.due_date)}
                            {t.due_time ? ` at ${t.due_time}` : ""}
                          </p>
                        </li>
                      ))}
                    </DaySection>
                  )}

                  {dayChecklistItems.length > 0 && (
                    <DaySection title="Checklist items">
                      {dayChecklistItems.map((item) => (
                        <li
                          key={item.id}
                          className="lp-glass-soft list-row-enter rounded-xl border px-3 py-2.5"
                        >
                          <p className="text-sm font-medium">{item.title}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {item.checklist_title} · Due {dayKey(item.due_date)}
                          </p>
                        </li>
                      ))}
                    </DaySection>
                  )}
                </>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

function DaySection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-4 last:mb-0">
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <ul className="space-y-2.5">{children}</ul>
    </div>
  );
}
