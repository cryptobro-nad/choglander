import type { Alarm, CalEvent, Occurrence, Recurrence } from "@/lib/types";
import { addDays, atTime, dayKey, sameDay, startOfDay } from "@/lib/time";

/** The demo week's blocks: their ids start with "seed-". The person's own start with "ev-". */
export function isSeedEvent(event: Pick<CalEvent, "id">): boolean {
  return event.id.startsWith("seed-");
}

export function eventDuration(event: CalEvent): number {
  return new Date(event.end).getTime() - new Date(event.start).getTime();
}

/** Calendar dates apart, independent of a 23- or 25-hour daylight-saving day. */
export function calendarDayDistance(from: Date, to: Date): number {
  const date = (value: Date) => Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
  return Math.round((date(to) - date(from)) / 86_400_000);
}

/**
 * All-day events include their first date and exclude the midnight after their last date.
 * Older saved events may end at 23:59 or retain a timed event's hours: include that final date.
 */
export function allDaySpan(event: Pick<CalEvent, "start" | "end">): { start: Date; end: Date; days: number } {
  const start = startOfDay(new Date(event.start));
  const rawEnd = new Date(event.end);
  let end = startOfDay(rawEnd);
  if (rawEnd.getTime() !== end.getTime()) end = addDays(end, 1);
  if (end <= start) end = addDays(start, 1);
  return { start, end, days: calendarDayDistance(start, end) };
}

export function normalizeAllDayEvent(event: CalEvent): CalEvent {
  const { start, end } = allDaySpan(event);
  return { ...event, start: start.toISOString(), end: end.toISOString(), reminderMin: null };
}

/** The editor's last date is inclusive; storage uses the following local midnight. */
export function withAllDayDates(event: CalEvent, first: Date, through: Date): CalEvent {
  const start = startOfDay(first);
  const last = startOfDay(through < start ? start : through);
  return { ...event, start: start.toISOString(), end: addDays(last, 1).toISOString(), reminderMin: null };
}

function matchesDay(recurrence: Recurrence, origin: Date, day: Date): boolean {
  if (recurrence === "none") return dayKeyMatch(origin, day);
  if (recurrence === "daily") return true;
  if (recurrence === "weekly") return origin.getDay() === day.getDay();
  if (recurrence === "weekdays") {
    const d = day.getDay();
    return d >= 1 && d <= 5;
  }
  return false;
}

function dayKeyMatch(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function occurrencesBetween(event: CalEvent, rangeStart: Date, rangeEnd: Date): Occurrence[] {
  const origin = new Date(event.start);
  const duration = Math.max(15 * 60 * 1000, eventDuration(event));
  if (!Number.isFinite(origin.getTime()) || !Number.isFinite(duration) || rangeEnd <= rangeStart) return [];
  const allDay = event.allDay ? allDaySpan(event) : null;
  const out: Occurrence[] = [];
  const add = (start: Date, end: Date) => {
    if (end > rangeStart && start < rangeEnd) out.push({ event, start, end, key: `${event.id}@${start.toISOString()}` });
  };
  // A one-off can begin weeks before the visible day. Test its whole span without scanning dates.
  if (event.recurrence === "none") {
    add(allDay?.start ?? origin, allDay?.end ?? new Date(origin.getTime() + duration));
    return out;
  }
  // A repeating multi-day event can also begin well before the range and still overlap it.
  const earliest = allDay ? addDays(startOfDay(rangeStart), -allDay.days) : startOfDay(new Date(rangeStart.getTime() - duration));
  const cursor = new Date(Math.max(earliest.getTime(), startOfDay(origin).getTime()));
  const last = new Date(rangeEnd);
  while (cursor <= last) {
    if (matchesDay(event.recurrence, origin, cursor)) {
      const start = new Date(cursor);
      if (event.allDay) {
        start.setHours(0, 0, 0, 0);
      } else {
        start.setHours(origin.getHours(), origin.getMinutes(), 0, 0);
      }
      const end = allDay ? addDays(start, allDay.days) : new Date(start.getTime() + duration);
      const originDay = startOfDay(origin).getTime();
      if (startOfDay(start).getTime() >= originDay) add(start, end);
    }
    cursor.setDate(cursor.getDate() + 1);
    if (out.length > 400) break;
  }
  return out;
}

/**
 * Earliest first (latest first with direction -1). At the same start the person's own event comes
 * before a sample block, then the one added last (events are kept in the order they were added),
 * so a block just added at a seeded block's time is the one the Chog talks about.
 */
function byStart(events: CalEvent[], direction: 1 | -1 = 1) {
  const added = new Map(events.map((event, index) => [event, index]));
  return (a: Occurrence, b: Occurrence) =>
    direction * (a.start.getTime() - b.start.getTime()) ||
    Number(isSeedEvent(a.event)) - Number(isSeedEvent(b.event)) ||
    (added.get(b.event) ?? 0) - (added.get(a.event) ?? 0);
}

export function occurrencesOn(events: CalEvent[], day: Date): Occurrence[] {
  const start = startOfDay(day);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return events.flatMap((event) => occurrencesBetween(event, start, end)).sort(byStart(events));
}

/**
 * Where an occurrence sits on one day, in wall-clock hours from midnight (so a clock change never
 * shifts it). One that began the day before starts at 0 (continued); one past midnight ends at 24.
 */
export function hoursOnDay(item: Pick<Occurrence, "start" | "end">, day: Date): { start: number; end: number; continued: boolean; continues: boolean } {
  const from = startOfDay(day);
  const to = addDays(from, 1);
  const hours = (date: Date) => date.getHours() + date.getMinutes() / 60;
  const continued = item.start < from;
  return { start: continued ? 0 : hours(item.start), end: item.end >= to ? 24 : hours(item.end), continued, continues: item.end > to };
}

export function upcoming(events: CalEvent[], now: Date, withinDays = 2): Occurrence[] {
  const end = new Date(now);
  end.setDate(end.getDate() + withinDays);
  return events
    .flatMap((event) => occurrencesBetween(event, now, end))
    .filter((item) => item.end > now && !item.event.allDay)
    .sort(byStart(events));
}

/** The next thing that has not started yet. An event already under way is not "next". */
export function nextStarting(events: CalEvent[], now: Date, withinDays = 2): Occurrence | null {
  return upcoming(events, now, withinDays).find((item) => item.start > now) ?? null;
}

export function mostRecent(events: CalEvent[], now: Date): Occurrence | null {
  const start = new Date(now);
  start.setDate(start.getDate() - 1);
  const items = events
    .flatMap((event) => occurrencesBetween(event, start, now))
    .filter((item) => item.end <= now)
    .sort(byStart(events, -1));
  return items[0] ?? null;
}

/**
 * Where Add starts a new event. Today it starts at least ten minutes from now (typing a title takes
 * a moment, and an event already under way is never the "next" one): the next whole hour (from
 * 8 AM), else the next half hour after that margin, 11 PM at the latest, else tomorrow at 9.
 * Another day gets the next whole hour after now's, kept between 8 AM and 8 PM.
 */
export function newEventStart(day: Date, now: Date): Date {
  const start = atTime(day, Math.min(20, Math.max(8, now.getHours() + 1)), 0);
  const soon = new Date(now.getTime() + 10 * 60_000);
  if (!sameDay(day, now) || start > soon) return start;
  const half = new Date(soon);
  half.setMinutes(soon.getMinutes() < 30 ? 30 : 60, 0, 0);
  return sameDay(half, now) && half <= atTime(now, 23, 0) ? half : atTime(addDays(now, 1), 9, 0);
}

export function newEventId(): string {
  return `ev-${Math.random().toString(36).slice(2, 10)}`;
}

/** A new, untitled hour from start. */
export function blankEvent(start: Date): CalEvent {
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return {
    id: newEventId(),
    title: "",
    start: new Date(start).toISOString(),
    end: end.toISOString(),
    allDay: false,
    recurrence: "none",
    reminderMin: 10,
    color: "lilac",
    notes: "",
  };
}

export const EVENT_COLORS: Record<CalEvent["color"], { bg: string; ink: string; bar: string }> = {
  lilac: { bg: "#efe7ff", ink: "#3b2a6d", bar: "#7b5cff" },
  sage: { bg: "#e5f6ea", ink: "#1a4a30", bar: "#2f9d62" },
  butter: { bg: "#fff1cc", ink: "#5c4310", bar: "#e0a106" },
  rose: { bg: "#ffe3ea", ink: "#6d2438", bar: "#e4567a" },
  sky: { bg: "#e3f2ff", ink: "#16395c", bar: "#2f86d6" },
};

/** How far past its minute an alarm may still ring (a throttled or frozen tab ticks late). */
export const ALARM_WINDOW_MS = 10 * 60_000;
/** How far past its moment a reminder may still ring, when that runs past the start ("At the time"). */
export const REMINDER_WINDOW_MS = 5 * 60_000;

/** One key per alarm slot per day. Rung once, a slot never rings again. */
export function alarmSlotKey(alarm: Pick<Alarm, "hour" | "minute">, day: Date): string {
  return `${dayKey(day)}-${alarm.hour}:${alarm.minute}`;
}

/** The next moment the daily alarm rings, strictly after `now`. Local wall clock, so DST-safe. */
export function nextAlarm(alarm: Alarm, now: Date, snoozeUntil: string | null = null): Date | null {
  if (snoozeUntil) {
    const snooze = new Date(snoozeUntil);
    if (snooze.getTime() > now.getTime() + 1000) return snooze;
  }
  if (!alarm.enabled || !Number.isFinite(alarm.hour) || !Number.isFinite(alarm.minute)) return null;
  for (let i = 0; i < 8; i++) {
    const date = new Date(now);
    date.setDate(now.getDate() + i);
    if (!alarm.days.includes(date.getDay())) continue;
    date.setHours(alarm.hour, alarm.minute, 0, 0);
    if (date.getTime() > now.getTime() + 1000) return date;
  }
  return null;
}

/**
 * The alarm slot that should ring now on the page, or null. A slot rings once (lastKey), and
 * only inside its window, so a late tick still rings and a fresh load an hour later does not.
 */
export function dueAlarm(alarm: Alarm, now: Date, lastKey: string | null): string | null {
  if (!alarm.enabled || !alarm.days.includes(now.getDay())) return null;
  const target = new Date(now);
  target.setHours(alarm.hour, alarm.minute, 0, 0);
  const delta = now.getTime() - target.getTime();
  if (delta < 0 || delta >= ALARM_WINDOW_MS) return null;
  const key = alarmSlotKey(alarm, now);
  return key === lastKey ? null : key;
}

/** True once a snooze has run out (and only for a while after, so a stale one is dropped). */
export function snoozeDue(snoozeUntil: string | null, now: Date): boolean {
  if (!snoozeUntil) return false;
  const at = Date.parse(snoozeUntil);
  if (!Number.isFinite(at)) return false;
  const late = now.getTime() - at;
  return late >= 0 && late < ALARM_WINDOW_MS;
}

/**
 * The first reminder due now that has not rung yet. A reminder of the person's own is due from its
 * moment until the event starts, so one whose moment had already passed when the event was saved
 * (or while the tab slept) still rings once, straight away. "At the time" may ring up to
 * REMINDER_WINDOW_MS late. A sample block only rings in the REMINDER_WINDOW_MS after its moment:
 * the demo week is never "saved inside its window", and a wide window would let the 4:30 Dentist
 * ring over a judge's first visit instead of the greeting.
 * `fired` holds the occurrences already rung: editing an event keeps its key unless it moves.
 */
export function dueReminder(events: CalEvent[], now: Date, fired: string[]): Occurrence | null {
  for (const item of upcoming(events, now, 2)) {
    if (item.event.reminderMin == null || fired.includes(item.key)) continue;
    const moment = item.start.getTime() - item.event.reminderMin * 60_000;
    const until = isSeedEvent(item.event) ? moment + REMINDER_WINDOW_MS : Math.max(item.start.getTime(), moment + REMINDER_WINDOW_MS);
    if (now.getTime() >= moment && now.getTime() < until) return item;
  }
  return null;
}

/** A short stamp of the calendar's events: it changes whenever one is added, edited or deleted. */
export function calendarStamp(events: CalEvent[]): string {
  let h = 5381;
  for (const event of events) {
    const text = `${event.id}|${event.title}|${event.start}|${event.end}|${event.allDay}|${event.recurrence};`;
    for (let i = 0; i < text.length; i++) h = (Math.imul(h, 33) + text.charCodeAt(i)) >>> 0;
  }
  return `${events.length}.${h.toString(36)}`;
}
