import { describe, expect, it } from "vitest";
import { blankEvent, calendarStamp, dueReminder, hoursOnDay, isSeedEvent, mostRecent, newEventStart, nextStarting, occurrencesOn, upcoming } from "@/lib/calendar";
import { seedEvents, withDemoCalendar } from "@/lib/persist";
import type { CalEvent } from "@/lib/types";

function event(partial: Partial<CalEvent>): CalEvent {
  return {
    id: "1",
    title: "Standup",
    start: "2026-10-13T09:30:00",
    end: "2026-10-13T10:00:00",
    allDay: false,
    recurrence: "none",
    reminderMin: 10,
    color: "lilac",
    notes: "",
    ...partial,
  };
}

describe("calendar", () => {
  it("keeps a one-off on its day", () => {
    const day = new Date(2026, 9, 17, 12);
    const items = occurrencesOn([event({ start: "2026-10-17T09:30:00", end: "2026-10-17T10:00:00" })], day);
    expect(items).toHaveLength(1);
    expect(items[0].start.getHours()).toBe(9);
  });

  it("repeats weekdays and skips Saturday", () => {
    const saturday = new Date(2026, 9, 17, 12);
    const monday = new Date(2026, 9, 19, 12);
    const item = event({ recurrence: "weekdays", start: "2026-10-13T09:30:00", end: "2026-10-13T10:00:00" });
    expect(occurrencesOn([item], saturday)).toHaveLength(0);
    expect(occurrencesOn([item], monday)).toHaveLength(1);
  });

  it("repeats weekly on the original weekday", () => {
    const item = event({ recurrence: "weekly", start: "2026-10-17T12:30:00", end: "2026-10-17T13:30:00" });
    const next = new Date(2026, 9, 24, 8);
    const items = occurrencesOn([item], next);
    expect(items).toHaveLength(1);
    expect(items[0].start.getDate()).toBe(24);
  });

  it("upgrades an empty or thin demo calendar and keeps a real one", () => {
    const now = new Date(2026, 9, 17, 23, 10);
    const seeded = seedEvents(now);
    expect(seeded.length).toBeGreaterThan(8);
    expect(withDemoCalendar([], now).map((item) => item.title)).toEqual(seeded.map((item) => item.title));
    const thin = [event({ id: "seed-standup" }), event({ id: "seed-lunch" })];
    expect(withDemoCalendar(thin, now).length).toBe(seeded.length);
    const custom = [event({ id: "mine" })];
    expect(withDemoCalendar(custom, now)).toBe(custom);
    const saturday = occurrencesOn(seeded, now);
    expect(saturday.some((item) => item.event.title === "Standup")).toBe(false);
    expect(saturday.some((item) => item.event.title === "Bakery run")).toBe(true);
    const next = upcoming(seeded, now, 2)[0];
    expect(next.event.allDay).toBe(false);
    expect(next.event.title).toBe("Brunch");
  });
});

describe("a new event's default start", () => {
  // Mon 19 Oct 2026.
  const at = (hour: number, minute = 0, day = 19) => new Date(2026, 9, day, hour, minute);

  it("takes the next whole hour today in the daytime, from 8 AM", () => {
    expect(newEventStart(at(14, 10), at(14, 10))).toEqual(at(15));
    expect(newEventStart(at(0), at(3, 0))).toEqual(at(8));
    expect(newEventStart(at(0), at(7, 30))).toEqual(at(8));
    expect(newEventStart(at(0), at(19, 10))).toEqual(at(20));
  });

  it("takes the next half hour in the evening, never a start already past", () => {
    // It used to be 8 PM at any hour from 8 PM on, which had begun or passed.
    expect(newEventStart(at(0), at(20, 0))).toEqual(at(20, 30));
    expect(newEventStart(at(0), at(20, 10))).toEqual(at(20, 30));
    expect(newEventStart(at(0), at(20, 40))).toEqual(at(21));
    expect(newEventStart(at(0), at(22, 45))).toEqual(at(23));
  });

  it("leaves ten minutes to type a title, so the event hasn't begun when it's saved", () => {
    expect(newEventStart(at(0), at(20, 25))).toEqual(at(21));
    expect(newEventStart(at(0), at(14, 55))).toEqual(at(15, 30));
    expect(newEventStart(at(0), at(22, 55))).toEqual(at(9, 0, 20));
  });

  it("moves to tomorrow at 9 when an hour no longer fits today", () => {
    expect(newEventStart(at(0), at(23, 0))).toEqual(at(9, 0, 20));
    expect(newEventStart(at(0), at(23, 50))).toEqual(at(9, 0, 20));
  });

  it("is always after now on today, at any minute of the day", () => {
    for (let minute = 0; minute < 24 * 60; minute += 5) {
      const now = at(Math.floor(minute / 60), minute % 60);
      const start = newEventStart(at(12), now);
      expect(start.getTime(), now.toString()).toBeGreaterThan(now.getTime());
      const sameDay = start.getDate() === now.getDate();
      expect(sameDay ? start.getHours() * 60 + start.getMinutes() <= 23 * 60 : start.getHours() === 9, now.toString()).toBe(true);
    }
  });

  it("keeps a daytime hour on another day, whatever the clock says", () => {
    expect(newEventStart(at(0, 0, 20), at(21, 30))).toEqual(at(20, 0, 20));
    expect(newEventStart(at(0, 0, 21), at(6, 10))).toEqual(at(8, 0, 21));
    expect(newEventStart(at(0, 0, 21), at(14, 10))).toEqual(at(15, 0, 21));
  });

  it("drafts an untitled hour from that start", () => {
    const draft = blankEvent(at(20, 30));
    expect(new Date(draft.start)).toEqual(at(20, 30));
    expect(new Date(draft.end)).toEqual(at(21, 30));
    expect(draft.title).toBe("");
    expect(isSeedEvent(draft)).toBe(false);
  });
});

describe("the next event, on a tie", () => {
  // Tue 20 Oct 2026, 14:10: Add defaults to 15:00, the seeded Design review's time.
  const now = new Date(2026, 9, 20, 14, 10);
  const review = event({ id: "seed-v3-review-tue", title: "Design review", start: "2026-10-20T15:00:00", end: "2026-10-20T15:45:00" });
  const mine = event({ id: "ev-mine", title: "Call mum", start: "2026-10-20T15:00:00", end: "2026-10-20T16:00:00" });

  it("prefers the person's own event over a sample one, wherever it sits", () => {
    expect(nextStarting([review, mine], now)?.event.id).toBe("ev-mine");
    expect(nextStarting([mine, review], now)?.event.id).toBe("ev-mine");
    expect(upcoming([review, mine], now).map((item) => item.event.id)).toEqual(["ev-mine", "seed-v3-review-tue"]);
    expect(occurrencesOn([review, mine], now).map((item) => item.event.id)).toEqual(["ev-mine", "seed-v3-review-tue"]);
  });

  it("then prefers the one added last", () => {
    const earlier = event({ id: "ev-a", title: "Plan", start: "2026-10-20T15:00:00", end: "2026-10-20T16:00:00" });
    const later = event({ id: "ev-b", title: "Pack", start: "2026-10-20T15:00:00", end: "2026-10-20T15:30:00" });
    expect(nextStarting([review, earlier, later], now)?.event.id).toBe("ev-b");
    expect(nextStarting([later, review, earlier], now)?.event.id).toBe("ev-a");
  });

  it("still puts an earlier sample block first", () => {
    const standup = event({ id: "seed-v3-standup", start: "2026-10-20T14:30:00", end: "2026-10-20T14:45:00" });
    expect(nextStarting([mine, standup], now)?.event.id).toBe("seed-v3-standup");
  });

  it("looks back the same way for the event just finished", () => {
    const later = new Date(2026, 9, 20, 17, 0);
    expect(mostRecent([review, mine], later)?.event.id).toBe("ev-mine");
  });

  it("knows a sample block by its id", () => {
    expect(isSeedEvent(review)).toBe(true);
    expect(isSeedEvent(mine)).toBe(false);
  });
});

describe("a reminder", () => {
  // Mon 19 Oct 2026.
  const at = (hour: number, minute = 0, day = 19) => new Date(2026, 9, day, hour, minute);
  const call = (start: Date, reminderMin: number | null, partial: Partial<CalEvent> = {}) =>
    event({ id: "ev-call", title: "Call mom", start: start.toISOString(), end: new Date(start.getTime() + 30 * 60_000).toISOString(), reminderMin, ...partial });

  it("rings at once for an event saved inside its reminder window, until it starts", () => {
    // Added at 18:36 for 18:39 with the default "10 minutes before": its moment, 18:29, has passed.
    const added = [call(at(18, 39), 10)];
    const due = dueReminder(added, at(18, 36), []);
    expect(due?.event.title).toBe("Call mom");
    expect(dueReminder(added, at(18, 38), [])?.key).toBe(due?.key);
    expect(dueReminder(added, at(18, 39), [])).toBeNull();
  });

  it("rings 'An hour before' at once for an event half an hour away, and not before its moment", () => {
    expect(dueReminder([call(at(15, 0), 60)], at(14, 30), [])?.event.title).toBe("Call mom");
    expect(dueReminder([call(at(16, 0), 60)], at(14, 30), [])).toBeNull();
    expect(dueReminder([call(at(16, 0), 60)], at(15, 0), [])?.event.title).toBe("Call mom");
  });

  it("never rings twice for the same occurrence, edited or not", () => {
    const key = dueReminder([call(at(18, 39), 10)], at(18, 36), [])!.key;
    expect(dueReminder([call(at(18, 39), 10)], at(18, 37), [key])).toBeNull();
    // A new title or another reminder after it rang: the same occurrence, so no second call.
    expect(dueReminder([call(at(18, 39), 0, { title: "Call mum" })], at(18, 39), [key])).toBeNull();
    // Moved to another time, it is a new occurrence with a reminder of its own.
    expect(dueReminder([call(at(18, 45), 10)], at(18, 37), [key])?.start).toEqual(at(18, 45));
  });

  it("keeps 'At the time' ringing at the start, up to five minutes late", () => {
    const events = [call(at(18, 38), 0)];
    expect(dueReminder(events, new Date(at(18, 38).getTime() - 1000), [])).toBeNull();
    expect(dueReminder(events, at(18, 38), [])?.event.title).toBe("Call mom");
    expect(dueReminder(events, new Date(at(18, 43).getTime() - 1000), [])).not.toBeNull();
    expect(dueReminder(events, at(18, 43), [])).toBeNull();
  });

  it("rings each day of a repeating event once", () => {
    const daily = [call(at(9, 30), 10, { recurrence: "daily" })];
    const today = dueReminder(daily, at(9, 25), [])!;
    expect(today.start).toEqual(at(9, 30));
    expect(dueReminder(daily, at(9, 26), [today.key])).toBeNull();
    const tomorrow = dueReminder(daily, at(9, 21, 20), [today.key]);
    expect(tomorrow?.start).toEqual(at(9, 30, 20));
    expect(tomorrow?.key).not.toBe(today.key);
  });

  it("rings tonight for an event just after midnight, and not early for one tomorrow morning", () => {
    expect(dueReminder([call(at(0, 20, 20), 60)], at(23, 30), [])?.start).toEqual(at(0, 20, 20));
    expect(dueReminder([call(at(9, 0, 20), 10)], at(23, 30), [])).toBeNull();
  });

  it("rings the soonest first when two are due", () => {
    const hour = call(at(15, 0), 60, { id: "ev-hour", title: "Pitch" });
    const ten = call(at(14, 40), 10, { id: "ev-ten", title: "Pack" });
    const first = dueReminder([hour, ten], at(14, 35), [])!;
    expect(first.event.title).toBe("Pack");
    expect(dueReminder([hour, ten], at(14, 35), [first.key])?.event.title).toBe("Pitch");
  });

  it("keeps a sample block to the five minutes after its moment, so it never rings over a first visit", () => {
    // The demo week's Dentist at 4:30 with "30 minutes before": due 4:00 to 4:05, not until 4:30.
    const dentist = (id: string) => call(at(16, 30), 30, { id, title: "Dentist" });
    expect(dueReminder([dentist("seed-v3-dentist")], at(16, 0), [])?.event.title).toBe("Dentist");
    expect(dueReminder([dentist("seed-v3-dentist")], new Date(at(16, 5).getTime() - 1000), [])).not.toBeNull();
    expect(dueReminder([dentist("seed-v3-dentist")], at(16, 5), [])).toBeNull();
    expect(dueReminder([dentist("seed-v3-dentist")], at(16, 10), [])).toBeNull();
    // The same block of the person's own still rings until it starts.
    expect(dueReminder([dentist("ev-dentist")], at(16, 10), [])?.event.title).toBe("Dentist");
    expect(dueReminder([dentist("ev-dentist")], at(16, 30), [])).toBeNull();
  });

  it("has nothing to ring for an all-day block", () => {
    const birthday = call(at(0, 0), 0, { allDay: true, end: at(0, 0, 20).toISOString() });
    expect(dueReminder([birthday], at(0, 1), [])).toBeNull();
    expect(dueReminder([birthday], at(9, 0), [])).toBeNull();
  });
});

describe("where an event sits on a day", () => {
  // Wed 21 and Thu 22 Oct 2026.
  const at = (hour: number, minute = 0, day = 21) => new Date(2026, 9, day, hour, minute);

  it("draws a gig past midnight from the top of the next day, not again at its start hour", () => {
    const gig = event({ title: "Late gig", start: at(23, 30).toISOString(), end: at(1, 30, 22).toISOString() });
    const [wednesday] = occurrencesOn([gig], at(12));
    expect(hoursOnDay(wednesday, at(12))).toEqual({ start: 23.5, end: 24, continued: false, continues: true });
    const [thursday] = occurrencesOn([gig], at(12, 0, 22));
    expect(hoursOnDay(thursday, at(12, 0, 22))).toEqual({ start: 0, end: 1.5, continued: true, continues: false });
  });

  it("keeps an early event at its own hour", () => {
    const bus = event({ title: "Night bus", start: at(2, 15, 22).toISOString(), end: at(3, 0, 22).toISOString() });
    const [item] = occurrencesOn([bus], at(0, 0, 22));
    expect(hoursOnDay(item, at(0, 0, 22))).toEqual({ start: 2.25, end: 3, continued: false, continues: false });
  });

  it("ends a block that stops at midnight at the bottom of its day, without carrying on", () => {
    const late = event({ start: at(23).toISOString(), end: at(0, 0, 22).toISOString() });
    const [item] = occurrencesOn([late], at(12));
    expect(hoursOnDay(item, at(12))).toEqual({ start: 23, end: 24, continued: false, continues: false });
    expect(occurrencesOn([late], at(12, 0, 22))).toHaveLength(0);
  });
});

describe("the calendar's stamp", () => {
  it("changes when an event is added, edited or deleted, and only then", () => {
    const week = seedEvents(new Date(2026, 9, 19, 9, 0));
    const stamp = calendarStamp(week);
    expect(calendarStamp([...week])).toBe(stamp);
    const added = [...week, { ...blankEvent(new Date(2026, 9, 19, 15, 30)), id: "ev-1", title: "Pitch" }];
    expect(calendarStamp(added)).not.toBe(stamp);
    expect(calendarStamp(week.map((event, i) => (i === 0 ? { ...event, title: `${event.title}!` } : event)))).not.toBe(stamp);
    expect(calendarStamp(week.slice(1))).not.toBe(stamp);
  });
});
