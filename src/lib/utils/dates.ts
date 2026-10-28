import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

const MONTHS: Record<string, number> = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  sept: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};

export function calendarToday(timezone: string, now = new Date()): string {
  return formatInTimeZone(now, timezone, "yyyy-MM-dd");
}

export function addCalendarDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function weekdayIndex(ymd: string): number {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function formatDateOnly(dateStr: string | null): string {
  if (!dateStr) return "No deadline";
  const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function formatMonthLabel(ymd: string): string {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d || 1)));
}

export function getUserNow(timezone: string): Date {
  const today = calendarToday(timezone);
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

export function formatDateInTz(
  date: Date | string,
  timezone: string,
  pattern = "MMM d, yyyy"
): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return formatInTimeZone(d, timezone, pattern);
}

export function formatFriendlyDate(dateStr: string | null, timezone: string): string {
  if (!dateStr) return "No date";
  const day = dateStr.slice(0, 10);
  const today = calendarToday(timezone);
  if (day === today) return "Today";
  if (day === addCalendarDays(today, 1)) return "Tomorrow";
  if (day === addCalendarDays(today, -1)) return "Yesterday";
  return formatDateOnly(day);
}

export function isOverdue(
  dueDate: string | null,
  dueTime: string | null,
  timezone: string,
  status: string,
  now = new Date()
): boolean {
  if (!dueDate || status === "done" || status === "cancelled") return false;
  const today = calendarToday(timezone, now);
  const day = dueDate.slice(0, 10);
  if (day < today) return true;
  if (day > today) return false;
  if (!dueTime) return false;
  const nowTime = formatInTimeZone(now, timezone, "HH:mm");
  return dueTime.slice(0, 5) < nowTime;
}

export function isDueToday(
  dueDate: string | null,
  timezone: string,
  now = new Date()
): boolean {
  if (!dueDate) return false;
  return dueDate.slice(0, 10) === calendarToday(timezone, now);
}

export interface DayResolution {
  type: "day";
  date: string;
  label: string;
}

export interface RangeResolution {
  type: "range";
  kind: PeriodKind;
  from: string;
  to: string;
  label: string;
}

export interface AmbiguousResolution {
  type: "ambiguous";
  question: string;
  options: { label: string; date: string }[];
}

export type DatePhraseResult = DayResolution | RangeResolution | AmbiguousResolution;

export type PeriodKind =
  | "today"
  | "tomorrow"
  | "yesterday"
  | "this_week"
  | "next_week"
  | "this_month"
  | "next_month"
  | "next_7_days"
  | "overdue"
  | "no_deadline"
  | "range";

export interface PeriodWindow {
  kind: PeriodKind;
  from: string | null;
  to: string | null;
  label: string;
}

function weekWindow(today: string, weekStartsOn: 0 | 1, offset: number): { from: string; to: string } {
  const diff = (weekdayIndex(today) - weekStartsOn + 7) % 7;
  const from = addCalendarDays(today, -diff + offset * 7);
  return { from, to: addCalendarDays(from, 6) };
}

function monthWindow(today: string, offset: number): { from: string; to: string; label: string } {
  const [y, m] = today.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1 + offset, 1));
  const end = new Date(Date.UTC(y, m + offset, 0));
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
    label: formatMonthLabel(start.toISOString().slice(0, 10)),
  };
}

export function periodWindow(
  kind: PeriodKind,
  timezone: string,
  weekStartsOn: 0 | 1 = 1,
  now = new Date(),
  custom?: { from?: string; to?: string }
): PeriodWindow {
  const today = calendarToday(timezone, now);
  if (kind === "today") return { kind, from: today, to: today, label: "Today" };
  if (kind === "tomorrow") {
    const day = addCalendarDays(today, 1);
    return { kind, from: day, to: day, label: "Tomorrow" };
  }
  if (kind === "yesterday") {
    const day = addCalendarDays(today, -1);
    return { kind, from: day, to: day, label: "Yesterday" };
  }
  if (kind === "this_week" || kind === "next_week") {
    const window = weekWindow(today, weekStartsOn, kind === "this_week" ? 0 : 1);
    return {
      kind,
      ...window,
      label: kind === "this_week" ? "This week" : "Next week",
    };
  }
  if (kind === "this_month" || kind === "next_month") {
    const window = monthWindow(today, kind === "this_month" ? 0 : 1);
    return { kind, from: window.from, to: window.to, label: window.label };
  }
  if (kind === "next_7_days") {
    return {
      kind,
      from: today,
      to: addCalendarDays(today, 6),
      label: "The next 7 days",
    };
  }
  if (kind === "overdue") return { kind, from: null, to: addCalendarDays(today, -1), label: "Overdue" };
  if (kind === "no_deadline") return { kind, from: null, to: null, label: "No deadline" };
  return {
    kind: "range",
    from: custom?.from ?? null,
    to: custom?.to ?? null,
    label:
      custom?.from && custom?.to
        ? `${formatDateOnly(custom.from)} – ${formatDateOnly(custom.to)}`
        : "Custom range",
  };
}

function weekdayTarget(token: string): number | null {
  const name = token.toLowerCase();
  const idx = WEEKDAYS.indexOf(name as (typeof WEEKDAYS)[number]);
  return idx === -1 ? null : idx;
}

function upcomingWeekday(
  today: string,
  target: number,
  mode: "upcoming" | "next"
): DayResolution | AmbiguousResolution {
  let soon = (target - weekdayIndex(today) + 7) % 7;
  if (mode === "next" && soon === 0) soon = 7;
  const soonDate = addCalendarDays(today, soon);
  const name = WEEKDAYS[target];
  const pretty = name.charAt(0).toUpperCase() + name.slice(1);
  if (mode === "next" && soon === 1) {
    const later = addCalendarDays(soonDate, 7);
    return {
      type: "ambiguous",
      question: `“Next ${pretty}” could be ${formatDateOnly(soonDate)} or ${formatDateOnly(later)}. Which date should I use?`,
      options: [
        { label: formatDateOnly(soonDate), date: soonDate },
        { label: formatDateOnly(later), date: later },
      ],
    };
  }
  return { type: "day", date: soonDate, label: formatDateOnly(soonDate) };
}

function parseNamedDate(normalized: string, today: string): string | null {
  const iso = normalized.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];

  const monthFirst = normalized.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?\b/
  );
  const dayFirst = normalized.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)(?:\s+(\d{4}))?\b/
  );
  const match = monthFirst
    ? { month: monthFirst[1], day: Number(monthFirst[2]), year: monthFirst[3] }
    : dayFirst
      ? { month: dayFirst[2], day: Number(dayFirst[1]), year: dayFirst[3] }
      : null;
  if (!match || match.day < 1 || match.day > 31) return null;
  const month = MONTHS[match.month];
  const year = match.year ? Number(match.year) : Number(today.slice(0, 4));
  const date = new Date(Date.UTC(year, month, match.day)).toISOString().slice(0, 10);
  if (!match.year && date < today) {
    return new Date(Date.UTC(year + 1, month, match.day)).toISOString().slice(0, 10);
  }
  return date;
}

export function resolveDatePhrase(
  input: string,
  timezone: string,
  weekStartsOn: 0 | 1 = 1,
  now = new Date()
): DatePhraseResult | null {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[?.!,]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b(tommorow|tommorrow|tomorow|tmrw|tmrrw|tmr)\b/g, "tomorrow")
    // Common weekday abbreviations people type in chat
    .replace(/\b(mon|monday)\b/g, "monday")
    .replace(/\b(tue|tues|tuesday)\b/g, "tuesday")
    .replace(/\b(wed|weds|wednesday)\b/g, "wednesday")
    .replace(/\b(thu|thur|thurs|thursday)\b/g, "thursday")
    .replace(/\b(fri|friday)\b/g, "friday")
    .replace(/\b(sat|saturday)\b/g, "saturday")
    .replace(/\b(sun|sunday)\b/g, "sunday")
    .trim();
  if (!normalized) return null;

  const today = calendarToday(timezone, now);

  if (/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(normalized)) {
    return {
      type: "ambiguous",
      question:
        "That numeric date is ambiguous. Please use a format like 2026-10-26 or 26 October.",
      options: [],
    };
  }

  if (normalized === "today" || normalized === "tonight") {
    return { type: "day", date: today, label: "Today" };
  }
  if (normalized === "tomorrow") {
    const date = addCalendarDays(today, 1);
    return { type: "day", date, label: "Tomorrow" };
  }
  if (normalized === "yesterday") {
    const date = addCalendarDays(today, -1);
    return { type: "day", date, label: "Yesterday" };
  }
  if (normalized === "day after tomorrow") {
    const date = addCalendarDays(today, 2);
    return { type: "day", date, label: formatDateOnly(date) };
  }

  const inDays = normalized.match(/^in\s+(\d+)\s+days?$/);
  if (inDays) {
    const date = addCalendarDays(today, Number(inDays[1]));
    return { type: "day", date, label: formatDateOnly(date) };
  }

  if (normalized === "next week" || normalized === "this week") {
    const window = weekWindow(today, weekStartsOn, normalized === "this week" ? 0 : 1);
    return {
      type: "range",
      kind: normalized === "this week" ? "this_week" : "next_week",
      ...window,
      label: normalized === "this week" ? "This week" : "Next week",
    };
  }

  if (
    normalized === "next month" ||
    normalized === "this month" ||
    normalized === "the next month"
  ) {
    const offset = normalized === "this month" ? 0 : 1;
    const window = monthWindow(today, offset);
    return {
      type: "range",
      kind: offset === 0 ? "this_month" : "next_month",
      from: window.from,
      to: window.to,
      label: window.label,
    };
  }

  if (
    normalized === "next 7 days" ||
    normalized === "upcoming 7 days" ||
    normalized === "upcoming seven days" ||
    normalized === "the next 7 days" ||
    normalized === "the upcoming seven days"
  ) {
    return {
      type: "range",
      kind: "next_7_days",
      from: today,
      to: addCalendarDays(today, 6),
      label: "The next 7 days",
    };
  }

  const nextNamed = normalized.match(/^(?:next|this)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/);
  if (nextNamed) {
    const target = weekdayTarget(nextNamed[1]);
    if (target === null) return null;
    const mode = normalized.startsWith("next ") ? "next" : "upcoming";
    return upcomingWeekday(today, target, mode);
  }

  const bare = normalized.match(/^(?:on\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/);
  if (bare) {
    const target = weekdayTarget(bare[1]);
    if (target === null) return null;
    return upcomingWeekday(today, target, "upcoming");
  }

  const named = parseNamedDate(normalized, today);
  if (named) return { type: "day", date: named, label: formatDateOnly(named) };

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return { type: "day", date: normalized, label: formatDateOnly(normalized) };
  }

  return null;
}

export function resolveRelativeDate(
  input: string,
  timezone: string,
  weekStartsOn: 0 | 1 = 1,
  now = new Date()
): string | null {
  const resolved = resolveDatePhrase(input, timezone, weekStartsOn, now);
  if (!resolved || resolved.type !== "day") return null;
  return resolved.date;
}

export function detectPeriodKind(text: string): PeriodKind | null {
  const n = text.toLowerCase();
  if (/\boverdue\b|\bpast due\b|\blate tasks?\b/.test(n)) return "overdue";
  if (/\bno deadline\b|\bwithout (a )?deadline\b|\bno due date\b|\bundated\b/.test(n)) {
    return "no_deadline";
  }
  if (/\bday after tomorrow\b/.test(n)) return null;
  if (/\btomorrow\b|\btmrw\b|\btommorow\b/.test(n)) return "tomorrow";
  if (/\byesterday\b/.test(n)) return "yesterday";
  if (/\btoday\b|\btonight\b/.test(n)) return "today";
  if (/\bnext month\b/.test(n)) return "next_month";
  if (/\bthis month\b/.test(n)) return "this_month";
  if (/\bnext week\b/.test(n)) return "next_week";
  if (/\bthis week\b/.test(n)) return "this_week";
  if (/\b(next|upcoming)\s+(7|seven)\s+days\b/.test(n)) return "next_7_days";
  // Bare "upcoming" (show my upcoming tasks) → next 7 days
  if (/\bupcoming\b/.test(n)) return "next_7_days";
  return null;
}

export function dateOnlyToUtcNoon(dateStr: string): string {
  return fromZonedTime(`${dateStr}T12:00:00`, "UTC").toISOString();
}

export function combineDateAndTime(
  dateStr: string,
  timeStr: string | null,
  timezone: string
): Date {
  if (timeStr) return fromZonedTime(`${dateStr}T${timeStr}`, timezone);
  return fromZonedTime(`${dateStr}T00:00:00`, timezone);
}

export function zonedDayIso(dateStr: string, timezone: string, end = false): string {
  return fromZonedTime(
    `${dateStr.slice(0, 10)}T${end ? "23:59:59" : "00:00:00"}`,
    timezone
  ).toISOString();
}

export function eventLocalDate(startAt: string, timezone: string): string {
  const parsed = new Date(startAt);
  if (Number.isNaN(parsed.getTime())) return startAt.slice(0, 10);
  return formatInTimeZone(parsed, timezone, "yyyy-MM-dd");
}

export function priorityWeight(priority: string): number {
  switch (priority) {
    case "urgent":
      return 4;
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
    default:
      return 0;
  }
}
