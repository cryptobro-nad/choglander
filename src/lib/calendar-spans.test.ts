import { describe, expect, it } from "vitest";
import { allDaySpan, normalizeAllDayEvent, occurrencesBetween, occurrencesOn, withAllDayDates } from "@/lib/calendar";
import type { CalEvent } from "@/lib/types";

const day = (month: number, date: number, hour = 0) => new Date(2026, month - 1, date, hour);
const event = (start: Date, end: Date, extra: Partial<CalEvent> = {}): CalEvent => ({
  id: "ev-trip", title: "Trip", start: start.toISOString(), end: end.toISOString(), allDay: false,
  recurrence: "none", reminderMin: null, color: "sky", notes: "", ...extra,
});

describe("multi-day occurrences", () => {
  it("keeps a one-off visible on every overlapping day, including days far after its start", () => {
    const trip = event(day(10, 1, 18), day(10, 9, 10));
    for (let date = 1; date <= 9; date++) {
      const occurrences = occurrencesOn([trip], day(10, date));
      expect(occurrences, `October ${date}`).toHaveLength(1);
      expect(occurrences[0].start).toEqual(day(10, 1, 18));
      expect(occurrences[0].end).toEqual(day(10, 9, 10));
    }
    expect(occurrencesOn([trip], day(10, 10))).toHaveLength(0);
  });

  it("finds a weekly occurrence that began several days before the visible range", () => {
    const trip = event(day(10, 1, 18), day(10, 4, 10), { recurrence: "weekly" });
    const occurrences = occurrencesOn([trip], day(10, 10));
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0].start).toEqual(day(10, 8, 18));
    expect(occurrences[0].end).toEqual(day(10, 11, 10));
  });

  it("uses exclusive end boundaries, without a duplicate on the next date", () => {
    const trip = event(day(10, 1), day(10, 4));
    expect(occurrencesOn([trip], day(10, 3))).toHaveLength(1);
    expect(occurrencesOn([trip], day(10, 4))).toHaveLength(0);
    expect(occurrencesBetween(trip, day(10, 5), day(10, 5))).toEqual([]);
  });
});

describe("all-day dates", () => {
  it("preserves the entire multi-day range, with a stable occurrence key on each date", () => {
    const trip = event(day(10, 22), day(10, 27), { allDay: true });
    const keys = [22, 23, 24, 25, 26].map((date) => occurrencesOn([trip], day(10, date))[0]?.key);
    expect(keys.every(Boolean)).toBe(true);
    expect(new Set(keys).size).toBe(1);
    expect(occurrencesOn([trip], day(10, 27))).toEqual([]);
  });

  // Run this suite with TZ=Europe/Helsinki and TZ=America/New_York too: these cover both
  // regions' spring-forward and fall-back dates, without assuming the machine's local zone.
  it.each([[3, 8], [3, 29], [10, 25], [11, 1]])("ends at local midnight across the clock change on %i/%i", (month, date) => {
    const first = day(month, date);
    const next = day(month, date + 1);
    const weekly = event(day(month, date - 7), day(month, date - 6), { allDay: true, recurrence: "weekly" });
    const occurrence = occurrencesOn([weekly], first)[0];
    expect(occurrence.start).toEqual(first);
    expect(occurrence.end).toEqual(next);
    expect(occurrencesOn([weekly], next)).toEqual([]);
    expect(occurrence.end.getTime() - occurrence.start.getTime()).toBe(
      86_400_000 + (next.getTimezoneOffset() - first.getTimezoneOffset()) * 60_000,
    );
  });

  it("normalizes legacy 23:59 and timed all-day values without adding a date to an exclusive end", () => {
    const old = event(day(10, 23, 9), new Date(2026, 9, 23, 23, 59), { allDay: true, reminderMin: 10 });
    expect(normalizeAllDayEvent(old)).toMatchObject({ start: day(10, 23).toISOString(), end: day(10, 24).toISOString(), reminderMin: null });
    expect(allDaySpan(event(day(10, 23), day(10, 24))).days).toBe(1);
  });

  it("converts inclusive editor dates to the following local midnight, clamping a reversed range", () => {
    const trip = event(day(10, 23), day(10, 24), { allDay: true });
    const edited = withAllDayDates(trip, day(10, 24), day(10, 26));
    expect(edited.start).toBe(day(10, 24).toISOString());
    expect(edited.end).toBe(day(10, 27).toISOString());
    expect(allDaySpan(edited).days).toBe(3);
    expect(withAllDayDates(trip, day(10, 25), day(10, 23)).end).toBe(day(10, 26).toISOString());
  });
});
