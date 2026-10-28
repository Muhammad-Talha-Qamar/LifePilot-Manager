import { describe, expect, it } from "vitest";
import {
  calendarToday,
  periodWindow,
  resolveDatePhrase,
} from "./dates";

const now = new Date("2026-10-22T08:00:00.000Z");
const zone = "Asia/Karachi";

describe("date periods", () => {
  it("uses the timezone calendar day", () => {
    expect(calendarToday(zone, now)).toBe("2026-10-22");
  });

  it("treats next month as the following calendar month", () => {
    const next = periodWindow("next_month", zone, 1, now);
    expect(next.from).toBe("2026-11-01");
    expect(next.to).toBe("2026-11-30");
    expect(next.label).toBe("November 2026");
  });

  it("keeps this week inside the current calendar week", () => {
    const week = periodWindow("this_week", zone, 1, now);
    expect(week.from).toBe("2026-10-19");
    expect(week.to).toBe("2026-10-25");
  });

  it("covers seven calendar days including today", () => {
    const upcoming = periodWindow("next_7_days", zone, 1, now);
    expect(upcoming.from).toBe("2026-10-22");
    expect(upcoming.to).toBe("2026-10-28");
  });

  it("asks when next Friday is only one day away", () => {
    const resolved = resolveDatePhrase("next Friday", zone, 1, now);
    expect(resolved?.type).toBe("ambiguous");
    if (resolved?.type === "ambiguous") {
      expect(resolved.options.map((option) => option.date)).toEqual([
        "2026-10-23",
        "2026-10-30",
      ]);
    }
  });

  it("resolves next Monday to the coming Monday", () => {
    const resolved = resolveDatePhrase("next Monday", zone, 1, now);
    expect(resolved).toMatchObject({ type: "day", date: "2026-10-26" });
  });

  it("resolves weekday abbreviations like sat", () => {
    const resolved = resolveDatePhrase("sat", zone, 1, now);
    expect(resolved).toMatchObject({ type: "day", date: "2026-10-24" });
  });
});
