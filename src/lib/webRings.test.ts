import { afterEach, describe, expect, it } from "vitest";
import { alarmTitle } from "@/components/app/screen-logic";
import { ALARM_WINDOW_MS, alarmSlotKey, dueAlarm, dueReminder } from "@/lib/calendar";
import { MAX_RINGS } from "@/lib/ringPush";
import type { Alarm, CalEvent, SavedState } from "@/lib/types";
import { missedRing, webRings } from "@/lib/webRings";

const daily: Alarm = { enabled: true, hour: 7, minute: 30, days: [0, 1, 2, 3, 4, 5, 6] };
const off: Alarm = { ...daily, enabled: false };
const web = { artId: 642, native: false };
const MIN = 60_000;

type RingState = Parameters<typeof webRings>[0];

function desk(partial: Partial<SavedState> = {}): RingState {
  return {
    onboarded: true,
    alarm: off,
    lastAlarmKey: null,
    events: [],
    fired: [],
    snoozeUntil: null,
    snoozeTest: false,
    ringAt: null,
    later: null,
    ...partial,
  };
}

function event(partial: Partial<CalEvent>): CalEvent {
  return {
    id: "ev-standup",
    title: "Standup",
    start: new Date(2026, 9, 19, 9, 30).toISOString(),
    end: new Date(2026, 9, 19, 9, 45).toISOString(),
    allDay: false,
    recurrence: "none",
    reminderMin: 10,
    color: "lilac",
    notes: "",
    ...partial,
  };
}

// Monday 19 Oct 2026, 08:00 local.
const monday = new Date(2026, 9, 19, 8, 0);

describe("webRings: what a closed tab still gets", () => {
  it("lists nothing on the phone, which arms its own alarms, or before setup is done", () => {
    const busy = desk({ alarm: daily, ringAt: monday.getTime() + 30_000, events: [event({})] });
    expect(webRings(busy, monday, { artId: 642, native: true })).toEqual([]);
    expect(webRings({ ...busy, onboarded: false }, monday, web)).toEqual([]);
    expect(webRings(desk(), monday, web)).toEqual([]);
  });

  it("lists the wake-up for the week ahead, a slot a day, named as the page names it", () => {
    const rings = webRings(desk({ alarm: daily }), monday, web);
    expect(rings).toHaveLength(7);
    // Today's 7:30 has passed, so the first is Tuesday's.
    expect(new Date(rings[0].at)).toEqual(new Date(2026, 9, 20, 7, 30));
    expect(new Date(rings[6].at)).toEqual(new Date(2026, 9, 26, 7, 30));
    for (const ring of rings) {
      const at = new Date(ring.at);
      // The same id the page's loop gives the ring it would ring at that moment.
      expect(ring.id).toBe(`alarm:${dueAlarm(daily, at, null)}`);
      expect(ring.title).toBe(alarmTitle(642));
      expect(ring.title).toBe("Chog #642 is calling");
      expect(ring.body).toBe("Tap to answer.");
    }
  });

  it("keeps to the alarm's days and leaves out the slot already rung", () => {
    const weekdays: Alarm = { ...daily, days: [1, 2, 3, 4, 5] };
    const early = new Date(2026, 9, 19, 6, 0);
    const rang = alarmSlotKey(weekdays, early);
    const rings = webRings(desk({ alarm: weekdays, lastAlarmKey: rang }), early, web);
    const days = rings.map((ring) => new Date(ring.at).getDay());
    // Tuesday to Friday: the weekend is off, and next Monday's 7:30 is more than a week away.
    expect(days).toEqual([2, 3, 4, 5]);
    expect(rings.some((ring) => ring.id === `alarm:${rang}`)).toBe(false);
    expect(webRings(desk({ alarm: off }), early, web)).toEqual([]);
  });

  it("names the caller plainly when no Chog is picked", () => {
    const [ring] = webRings(desk({ alarm: daily }), monday, { artId: null, native: false });
    expect(ring.title).toBe(alarmTitle(null));
  });

  it("lists a reminder at its moment, under the page's own id, and only for their own events", () => {
    const own = event({});
    const sample = event({ id: "seed-v3-standup" });
    const quiet = event({ id: "ev-quiet", reminderMin: null });
    const rings = webRings(desk({ events: [own, sample, quiet] }), monday, web);
    expect(rings).toHaveLength(1);
    expect(new Date(rings[0].at)).toEqual(new Date(2026, 9, 19, 9, 20));
    expect(rings[0].title).toBe("Standup in 10 min · Chog #642");
    const due = dueReminder([own], new Date(rings[0].at), []);
    expect(rings[0].id).toBe(`reminder:${due?.key}`);
  });

  it("says now for a reminder at the start, and leaves out one already rung or past", () => {
    const atStart = event({ reminderMin: 0 });
    expect(webRings(desk({ events: [atStart] }), monday, web)[0].title).toBe("Standup now · Chog #642");
    const due = dueReminder([event({})], new Date(2026, 9, 19, 9, 21), []);
    expect(webRings(desk({ events: [event({})], fired: [due!.key] }), monday, web)).toEqual([]);
    // Its moment has passed: the open page rings that one itself.
    expect(webRings(desk({ events: [event({})] }), new Date(2026, 9, 19, 9, 25), web)).toEqual([]);
  });

  it("covers two days of a repeating event, and no further", () => {
    const standup = event({ recurrence: "daily" });
    const rings = webRings(desk({ events: [standup] }), monday, web);
    expect(rings.map((ring) => new Date(ring.at).getDate())).toEqual([19, 20]);
  });

  it("lists a pending snooze, test ring and Remind me in 5, each at its saved moment", () => {
    const snoozeUntil = new Date(monday.getTime() + 9 * MIN).toISOString();
    const ringAt = monday.getTime() + 30_000;
    const later = { at: monday.getTime() + 5 * MIN, rangAt: monday.getTime(), event: { title: "Standup", when: "half past nine", minutesUntil: 8, minutesLeft: 23 } };
    const rings = webRings(desk({ snoozeUntil, ringAt, later }), monday, web);
    expect(rings.map((ring) => ring.id)).toEqual([`test:${ringAt}`, `later:${later.at}`, `snooze:${snoozeUntil}`]);
    expect(rings[0].title).toBe("Chog #642 is calling");
    // Five minutes on, the event is three minutes away.
    expect(rings[1].title).toBe("Standup in 3 min · Chog #642");
    expect(rings[2].title).toBe("Chog #642 is calling");
  });

  it("lets Remind me in 5 call as the caller when it has no event, or the event is over by then", () => {
    const plain = { at: monday.getTime() + 5 * MIN, rangAt: monday.getTime() };
    expect(webRings(desk({ later: plain }), monday, web)[0].title).toBe("Chog #642 is calling");
    const ending = { ...plain, event: { title: "Standup", when: "eight", minutesUntil: -10, minutesLeft: 3 } };
    expect(webRings(desk({ later: ending }), monday, web)[0].title).toBe("Chog #642 is calling");
  });

  it("drops what is already due, so the open page rings it and the server never sends it late", () => {
    const rings = webRings(desk({ ringAt: monday.getTime() - 1000, snoozeUntil: new Date(monday.getTime() - MIN).toISOString() }), monday, web);
    expect(rings).toEqual([]);
  });

  it("keeps the list short and earliest first", () => {
    const many = Array.from({ length: 40 }, (_, i) => event({ id: `ev-${i}`, start: new Date(2026, 9, 19, 10, i).toISOString(), end: new Date(2026, 9, 19, 11, i).toISOString() }));
    const rings = webRings(desk({ alarm: daily, events: many }), monday, web);
    expect(rings).toHaveLength(MAX_RINGS);
    expect(rings.map((ring) => ring.at)).toEqual([...rings.map((ring) => ring.at)].sort((a, b) => a - b));
  });
});

describe("webRings across a clock change (Europe/Helsinki)", () => {
  const saved = process.env.TZ;
  afterEach(() => {
    process.env.TZ = saved;
  });

  it("keeps the wake-up at 7:30 local through the fall-back, 25 hours after Saturday's", () => {
    process.env.TZ = "Europe/Helsinki";
    const saturday = new Date(2026, 9, 24, 8, 0);
    const rings = webRings(desk({ alarm: daily }), saturday, web);
    const [sunday, mondayRing] = rings;
    expect(new Date(sunday.at).toISOString()).toBe("2026-10-25T05:30:00.000Z");
    expect(new Date(mondayRing.at).toISOString()).toBe("2026-10-26T05:30:00.000Z");
    expect((sunday.at - new Date(2026, 9, 24, 7, 30).getTime()) / 3_600_000).toBe(25);
    expect(sunday.id).toBe(`alarm:${dueAlarm(daily, new Date(sunday.at), null)}`);
  });

  it("keeps the wake-up at 7:30 local through the spring-forward, 23 hours after Saturday's", () => {
    process.env.TZ = "Europe/Helsinki";
    const saturday = new Date(2027, 2, 27, 8, 0);
    const [sunday] = webRings(desk({ alarm: daily }), saturday, web);
    expect(new Date(sunday.at).toISOString()).toBe("2027-03-28T04:30:00.000Z");
    expect((sunday.at - new Date(2027, 2, 27, 7, 30).getTime()) / 3_600_000).toBe(23);
  });

  it("times a reminder on the local clock the morning after the change", () => {
    process.env.TZ = "Europe/Helsinki";
    const saturday = new Date(2026, 9, 24, 20, 0);
    const standup = event({ start: new Date(2026, 9, 25, 9, 30).toISOString(), end: new Date(2026, 9, 25, 9, 45).toISOString() });
    const [ring] = webRings(desk({ events: [standup] }), saturday, web);
    expect(new Date(ring.at).toISOString()).toBe("2026-10-25T07:20:00.000Z");
  });
});

describe("missedRing: a tapped notification the page can no longer ring", () => {
  const slotAt = new Date(2026, 9, 19, 7, 30);
  const slot = alarmSlotKey(daily, slotAt);
  const alarmLink = { id: `alarm:${slot}`, at: slotAt.getTime() };

  it("leaves the wake-up to the loop inside its window, and to voicemail after it", () => {
    const state = desk({ alarm: daily });
    expect(missedRing(state, alarmLink, new Date(slotAt.getTime() + 3 * MIN))).toBeNull();
    expect(missedRing(state, alarmLink, new Date(slotAt.getTime() + ALARM_WINDOW_MS + MIN))).toEqual({});
    // Rung already (the page was open, or this tab rang it while hidden): nothing more.
    expect(missedRing({ ...state, lastAlarmKey: slot }, alarmLink, new Date(slotAt.getTime() + 30 * MIN))).toBeNull();
    // Half a day old: it only opens the app.
    expect(missedRing(state, alarmLink, new Date(slotAt.getTime() + 13 * 60 * MIN))).toBeNull();
  });

  it("drops a wake-up's snooze that came and went, but leaves a test ring's to the loop", () => {
    const until = new Date(slotAt.getTime() + 9 * MIN).toISOString();
    const link = { id: `snooze:${until}`, at: Date.parse(until) };
    const lateNow = new Date(link.at + ALARM_WINDOW_MS + MIN);
    expect(missedRing(desk({ snoozeUntil: until }), link, new Date(link.at + MIN))).toBeNull();
    expect(missedRing(desk({ snoozeUntil: until }), link, lateNow)).toEqual({ snoozeUntil: null, snoozeTest: false });
    expect(missedRing(desk({ snoozeUntil: until, snoozeTest: true }), link, lateNow)).toBeNull();
    expect(missedRing(desk({ snoozeUntil: null }), link, lateNow)).toBeNull();
  });

  it("marks a reminder rung once its event has started, and not before", () => {
    const own = event({});
    const key = dueReminder([own], new Date(2026, 9, 19, 9, 21), [])!.key;
    const link = { id: `reminder:${key}`, at: new Date(2026, 9, 19, 9, 20).getTime() };
    const state = desk({ events: [own] });
    expect(missedRing(state, link, new Date(2026, 9, 19, 9, 28))).toBeNull();
    expect(missedRing(state, link, new Date(2026, 9, 19, 9, 31))).toEqual({ fired: [key] });
    expect(missedRing({ ...state, fired: [key] }, link, new Date(2026, 9, 19, 9, 31))).toBeNull();
    expect(missedRing(desk(), link, new Date(2026, 9, 19, 9, 31))).toBeNull();
  });

  it("leaves a test ring and Remind me in 5 to the loop, which voicemails them itself", () => {
    const at = slotAt.getTime();
    expect(missedRing(desk({ ringAt: at }), { id: `test:${at}`, at }, new Date(at + 20 * MIN))).toBeNull();
    expect(missedRing(desk({ later: { at, rangAt: at - 5 * MIN } }), { id: `later:${at}`, at }, new Date(at + 20 * MIN))).toBeNull();
  });
});
