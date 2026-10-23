import { afterEach, describe, expect, it } from "vitest";
import { ALARM_WINDOW_MS, alarmSlotKey, dueAlarm, dueReminder, nextAlarm, nextStarting, snoozeDue } from "@/lib/calendar";
import { callHeader, callIntent, callIsLive } from "@/lib/call";
import type { Alarm, CalEvent } from "@/lib/types";

const daily: Alarm = { enabled: true, hour: 7, minute: 30, days: [0, 1, 2, 3, 4, 5, 6] };

function event(partial: Partial<CalEvent>): CalEvent {
  return {
    id: "e1",
    title: "Standup",
    start: new Date(2026, 9, 19, 9, 30).toISOString(),
    end: new Date(2026, 9, 19, 10, 0).toISOString(),
    allDay: false,
    recurrence: "none",
    reminderMin: 10,
    color: "lilac",
    notes: "",
    ...partial,
  };
}

describe("next alarm", () => {
  it("is later today, else the next allowed day", () => {
    const early = new Date(2026, 9, 19, 6, 0);
    expect(nextAlarm(daily, early)?.getTime()).toBe(new Date(2026, 9, 19, 7, 30).getTime());
    const after = new Date(2026, 9, 19, 7, 30, 0, 300);
    expect(nextAlarm(daily, after)?.getTime()).toBe(new Date(2026, 9, 20, 7, 30).getTime());
    const weekdays: Alarm = { ...daily, days: [1, 2, 3, 4, 5] };
    const friday = new Date(2026, 9, 23, 9, 0);
    expect(nextAlarm(weekdays, friday)?.getTime()).toBe(new Date(2026, 9, 26, 7, 30).getTime());
  });

  it("prefers a pending snooze, and is off when disabled or broken", () => {
    const now = new Date(2026, 9, 19, 7, 31);
    const until = new Date(2026, 9, 19, 7, 40).toISOString();
    expect(nextAlarm(daily, now, until)?.toISOString()).toBe(until);
    expect(nextAlarm({ ...daily, enabled: false }, now)).toBeNull();
    expect(nextAlarm({ ...daily, minute: Number.NaN }, now)).toBeNull();
  });
});

describe("the page alarm loop", () => {
  it("rings a slot once, inside a ten minute window", () => {
    const at = new Date(2026, 9, 19, 7, 30, 0);
    expect(dueAlarm(daily, new Date(at.getTime() - 1000), null)).toBeNull();
    const key = dueAlarm(daily, at, null);
    expect(key).toBe("2026-10-19-7:30");
    expect(dueAlarm(daily, new Date(at.getTime() + 4 * 60_000), key)).toBeNull();
    // A tab throttled to one tick a minute still rings late, not never.
    expect(dueAlarm(daily, new Date(at.getTime() + 9 * 60_000), null)).toBe(key);
    expect(dueAlarm(daily, new Date(at.getTime() + ALARM_WINDOW_MS), null)).toBeNull();
    // Yesterday's key does not block today.
    expect(dueAlarm(daily, at, "2026-10-18-7:30")).toBe(key);
  });

  it("skips days the alarm is not set for", () => {
    const sunday = new Date(2026, 9, 18, 7, 31);
    expect(dueAlarm({ ...daily, days: [1, 2, 3, 4, 5] }, sunday, null)).toBeNull();
    expect(dueAlarm({ ...daily, enabled: false }, sunday, null)).toBeNull();
  });

  it("rings a snooze when it runs out, and drops a stale one", () => {
    const until = new Date(2026, 9, 19, 7, 39);
    expect(snoozeDue(until.toISOString(), new Date(2026, 9, 19, 7, 38, 59))).toBe(false);
    expect(snoozeDue(until.toISOString(), until)).toBe(true);
    expect(snoozeDue(until.toISOString(), new Date(until.getTime() + ALARM_WINDOW_MS))).toBe(false);
    expect(snoozeDue(null, until)).toBe(false);
    expect(snoozeDue("not a date", until)).toBe(false);
  });

  it("keys the slot by local day, so a repeated hour at the clock change cannot ring twice", () => {
    expect(alarmSlotKey(daily, new Date(2026, 9, 25, 7, 30))).toBe("2026-10-25-7:30");
    expect(alarmSlotKey({ hour: 2, minute: 30 }, new Date(2026, 9, 25, 2, 30))).toBe("2026-10-25-2:30");
  });
});

describe("reminders", () => {
  it("ring from their moment until the event starts, once", () => {
    const events = [event({})];
    expect(dueReminder(events, new Date(2026, 9, 19, 9, 19, 59), [])).toBeNull();
    const due = dueReminder(events, new Date(2026, 9, 19, 9, 20), []);
    expect(due?.event.title).toBe("Standup");
    expect(dueReminder(events, new Date(2026, 9, 19, 9, 24), [])?.key).toBe(due?.key);
    // A late tick (a frozen tab, a locked phone) still rings before the start, not never.
    expect(dueReminder(events, new Date(2026, 9, 19, 9, 29, 59), [])?.key).toBe(due?.key);
    expect(dueReminder(events, new Date(2026, 9, 19, 9, 30), [])).toBeNull();
    expect(dueReminder(events, new Date(2026, 9, 19, 9, 21), [due!.key])).toBeNull();
  });

  it("ignore events without a reminder", () => {
    expect(dueReminder([event({ reminderMin: null })], new Date(2026, 9, 19, 9, 20), [])).toBeNull();
  });
});

describe("what is next", () => {
  it("skips an event that is already under way", () => {
    const now = new Date(2026, 9, 19, 9, 40);
    const running = event({});
    const later = event({ id: "e2", title: "Lunch", start: new Date(2026, 9, 19, 12, 30).toISOString(), end: new Date(2026, 9, 19, 13, 30).toISOString() });
    expect(nextStarting([running, later], now)?.event.title).toBe("Lunch");
    expect(nextStarting([running], now)).toBeNull();
  });
});

describe("call header", () => {
  it("names the call by kind and phase", () => {
    expect(callHeader({ kind: "call", phase: "ringing" })).toBe("Incoming call");
    expect(callHeader({ kind: "alarm", phase: "ringing" })).toBe("Wake-up call");
    expect(callHeader({ kind: "alarm", phase: "wake" })).toBe("Wake-up call");
    expect(callHeader({ kind: "reminder", phase: "ringing" })).toBe("Reminder");
    expect(callHeader({ kind: "call", phase: "talking" })).toBe("On the line");
    expect(callHeader({ kind: "alarm", phase: "talking" })).toBe("On the line");
    // Once the Chog has said its piece, the screen says so rather than "On the line".
    expect(callHeader({ kind: "reminder", phase: "done" })).toBe("Call ended");
    expect(callHeader({ kind: "voicemail", phase: "talking" })).toBe("Voicemail");
    expect(callHeader({ kind: "alarm", phase: "done", title: "Snoozed" })).toBe("Snoozed");
  });

  it("knows what to say and which calls block a new one", () => {
    expect(callIntent("alarm")).toBe("morning");
    expect(callIntent("reminder")).toBe("reminder");
    expect(callIntent("voicemail")).toBe("voicemail");
    expect(callIntent("call")).toBe("greeting");
    expect(callIsLive(null)).toBe(false);
    expect(callIsLive({ phase: "done" })).toBe(false);
    expect(callIsLive({ phase: "ringing" })).toBe(true);
  });
});

describe("clock change (Europe/Helsinki, 25 Oct 2026)", () => {
  const saved = process.env.TZ;
  afterEach(() => {
    process.env.TZ = saved;
  });

  it("keeps the alarm at 7:30 local across the fall-back", () => {
    process.env.TZ = "Europe/Helsinki";
    const saturday = new Date(2026, 9, 24, 8, 0);
    const next = nextAlarm(daily, saturday);
    expect(next?.getDate()).toBe(25);
    expect(next?.getHours()).toBe(7);
    expect(next?.getMinutes()).toBe(30);
    // 25 hours pass between Saturday 7:30 and Sunday 7:30 on that night.
    const prev = new Date(2026, 9, 24, 7, 30);
    expect((next!.getTime() - prev.getTime()) / 3_600_000).toBe(25);
  });
});

describe("spoken event times", () => {
  it("reads the clock face to five minutes, never rounding an event to the wrong quarter", async () => {
    const { spokenWhen } = await import("@/lib/time");
    const at = (h: number, m: number) => spokenWhen(new Date(2026, 9, 19, h, m));
    expect(at(18, 25)).toBe("twenty-five past six");
    expect(at(9, 30)).toBe("half past nine");
    expect(at(8, 50)).toBe("ten to nine");
    expect(at(10, 45)).toBe("quarter to eleven");
    expect(at(7, 0)).toBe("seven");
    expect(at(12, 0)).toBe("noon");
    expect(at(0, 0)).toBe("midnight");
    expect(at(23, 58)).toBe("midnight");
    expect(at(11, 58)).toBe("noon");
    expect(at(14, 5)).toBe("five past two");
    expect(at(14, 35)).toBe("twenty-five to three");
  });
});
