import { describe, expect, it } from "vitest";
import {
  MIN_EVENT_MS,
  alarmTitle,
  eventChip,
  calendarFocus,
  clampEnd,
  freezeLabel,
  hourLabelClashes,
  isAbortError,
  moveStart,
  nativeAlarmPlan,
  nextRing,
  parseClockInput,
  permissionGaps,
  plural,
  shareText,
  shareUrl,
  sharedChog,
  streakLabel,
  toggleAlarmDay,
  wakeLine,
  webPlatform,
} from "@/components/app/screen-logic";
import type { Occurrence } from "@/lib/types";

const at = (h: number, m = 0, day = 18) => new Date(2026, 9, day, h, m).toISOString();

describe("event editor", () => {
  it("moves Ends with Starts and keeps the length", () => {
    const next = moveStart({ start: at(10), end: at(11, 30) }, new Date(2026, 9, 19, 14, 0));
    expect(new Date(next.start).getHours()).toBe(14);
    expect(new Date(next.end).getTime() - new Date(next.start).getTime()).toBe(90 * 60_000);
  });

  it("gives a broken event at least 15 minutes when Starts moves", () => {
    const next = moveStart({ start: at(10), end: at(9) }, new Date(2026, 9, 18, 12, 0));
    expect(new Date(next.end).getTime() - new Date(next.start).getTime()).toBe(MIN_EVENT_MS);
  });

  it("clamps Ends to Starts + 15 min on save", () => {
    const fixed = clampEnd({ start: at(14), end: at(11) });
    expect(new Date(fixed.end).getTime() - new Date(fixed.start).getTime()).toBe(MIN_EVENT_MS);
    const fine = { start: at(9), end: at(10) };
    expect(clampEnd(fine)).toEqual(fine);
  });
});

describe("alarm time", () => {
  it("reads a time picker value", () => {
    expect(parseClockInput("07:05")).toEqual({ hour: 7, minute: 5 });
    expect(parseClockInput("23:59:00")).toEqual({ hour: 23, minute: 59 });
  });

  it("refuses an empty or cleared picker instead of turning it into midnight", () => {
    expect(parseClockInput("")).toBeNull();
    expect(parseClockInput("07:")).toBeNull();
    expect(parseClockInput("25:00")).toBeNull();
  });
});

describe("today copy", () => {
  it("pluralises properly", () => {
    expect(plural(1, "morning")).toBe("1 morning");
    expect(plural(3, "morning")).toBe("3 mornings");
    expect(streakLabel(1)).toBe("1 morning in a row");
    expect(streakLabel(0)).toBe("No morning wake-ups yet");
    // Mornings together once, but the streak has lapsed: there have been wake-ups.
    expect(streakLabel(0, true)).toBe("Next wake-up starts a new streak");
    expect(streakLabel(3, true)).toBe("3 mornings in a row");
    expect(freezeLabel(1, 3)).toBe("A missed morning won't break it");
    // A freeze covers one missed morning at a time, however many are banked.
    expect(freezeLabel(2, 3)).toBe("A missed morning won't break it");
    expect(freezeLabel(0, 3)).toBeNull();
    // Day one: no streak yet, so nothing for a freeze to keep.
    expect(freezeLabel(1, 0)).toBeNull();
  });
});

describe("share", () => {
  it("links back to the app with the Chog", () => {
    expect(shareUrl("https://chog.example/", 375)).toBe("https://chog.example/?chog=375");
  });

  it("says who called, quotes the line, and ends on the card's page", () => {
    const text = shareText(375, "Told you.", "https://chog.example/c/375/VG9sZCB5b3Uu");
    expect(text).toBe("Chog #375 just called me.\n\n“Told you.”\n\nhttps://chog.example/c/375/VG9sZCB5b3Uu");
    // An APK built without a public address has no page to link to.
    expect(shareText(375, "Told you.", "")).toBe("Chog #375 just called me.\n\n“Told you.”");
  });

  it("knows a cancelled share sheet from a failure", () => {
    expect(isAbortError(new DOMException("cancel", "AbortError"))).toBe(true);
    expect(isAbortError(new Error("nope"))).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });
});

describe("permissions", () => {
  it("lists only what is missing, notifications first", () => {
    expect(permissionGaps({ notifications: true, fullScreen: true, exact: true })).toEqual([]);
    const gaps = permissionGaps({ notifications: false, fullScreen: true, exact: false });
    expect(gaps.map((gap) => gap.which)).toEqual(["notifications", "exact"]);
  });
});

describe("calendar now line", () => {
  it("hides only the hour label the now-pill would sit on", () => {
    expect(hourLabelClashes(8, 7 + 52 / 60, 64)).toBe(true);
    expect(hourLabelClashes(8, 7 + 43 / 60, 64)).toBe(false);
    expect(hourLabelClashes(7, 7 + 43 / 60, 64)).toBe(false);
  });
});

describe("alarmTitle", () => {
  it("names the caller, so the Android call notification says who is ringing", () => {
    expect(alarmTitle(375)).toBe("Chog #375 is calling");
    expect(alarmTitle(0)).toBe("Chog #0 is calling");
  });
  it("falls back to a plain title when there is no Chog yet", () => {
    expect(alarmTitle(null)).toBe("Chog is calling");
    expect(alarmTitle(undefined)).toBe("Chog is calling");
    expect(alarmTitle(Number.NaN)).toBe("Chog is calling");
  });
});

describe("calendarFocus", () => {
  const item = (key: string, h: number, m: number, minutes: number): Occurrence => {
    const start = new Date(2026, 9, 18, h, m);
    const end = new Date(start.getTime() + minutes * 60_000);
    return {
      key,
      start,
      end,
      event: { id: key, title: key, start: start.toISOString(), end: end.toISOString(), allDay: false, recurrence: "none", reminderMin: null, color: "sky", notes: "" },
    };
  };
  const day = [item("Standup", 9, 30, 15), item("Deep work", 10, 0, 90), item("Lunch", 12, 30, 45)];

  it("talks about what is on right now", () => {
    expect(calendarFocus(day, new Date(2026, 9, 18, 10, 30))?.key).toBe("Deep work");
  });
  it("otherwise the next thing to start, not the last of the day", () => {
    expect(calendarFocus(day, new Date(2026, 9, 18, 8, 0))?.key).toBe("Standup");
    expect(calendarFocus([day[2], day[0]], new Date(2026, 9, 18, 8, 0))?.key).toBe("Standup");
  });
  it("on a day that is over, the last thing that happened", () => {
    expect(calendarFocus(day, new Date(2026, 9, 18, 20, 0))?.key).toBe("Lunch");
    expect(calendarFocus([], new Date(2026, 9, 18, 20, 0))).toBeNull();
  });
  it("moves on to the day's other events every two taps, then comes back", () => {
    const evening = new Date(2026, 9, 18, 20, 0);
    const keys = Array.from({ length: 8 }, (_, peeks) => calendarFocus(day, evening, peeks)?.key);
    expect(keys).toEqual(["Lunch", "Lunch", "Standup", "Standup", "Deep work", "Deep work", "Lunch", "Lunch"]);
    // A day with one event keeps talking about it.
    expect(calendarFocus([day[0]], evening, 5)?.key).toBe("Standup");
  });
});

describe("shared links", () => {
  it("reads back the Chog a shared card names", () => {
    expect(sharedChog(new URL(shareUrl("https://chog.example/", 821)).search)).toBe(821);
    expect(sharedChog("?chog=7&sky=night")).toBe(7);
    expect(sharedChog("?chog=%23642")).toBe(642);
    expect(sharedChog("?chog=1969")).toBe(1969);
  });

  it("ignores anything that is not one of the 1,969", () => {
    for (const search of ["", "?sky=day", "?chog=", "?chog=0", "?chog=1970", "?chog=12abc", "?chog=-3", "?chog=4.5", "?chog=1e3"]) {
      expect(sharedChog(search)).toBeNull();
    }
  });
});

describe("the phone's daily alarm", () => {
  const alarm = { enabled: true, hour: 7, minute: 30, days: [0, 1, 2, 3, 4, 5, 6] };
  const evening = new Date(2026, 9, 18, 21, 0);

  it("arms nothing before onboarding is done, or after Start over", () => {
    expect(nativeAlarmPlan({ onboarded: false, alarm }, evening)).toBeNull();
  });

  it("arms the next real morning, never a pending snooze's time", () => {
    const snoozing = { onboarded: true, alarm, snoozeUntil: new Date(2026, 9, 18, 21, 9).toISOString() };
    const plan = nativeAlarmPlan(snoozing, evening);
    expect(plan?.at).toBe(new Date(2026, 9, 19, 7, 30).getTime());
    expect(plan?.repeat).toEqual({ hour: 7, minute: 30, days: alarm.days });
  });

  it("cancels the daily slot when the alarm is off", () => {
    expect(nativeAlarmPlan({ onboarded: true, alarm: { ...alarm, enabled: false } }, evening)).toEqual({ at: null, repeat: undefined });
  });
});

describe("eventChip", () => {
  const now = new Date(2026, 9, 19, 7, 30);
  it("names the event under a line that doesn't", () => {
    expect(eventChip({ title: "Standup", when: "half past nine", minutesUntil: 120 }, "Meeting later. Mute yourself.", now)).toBe("Standup · half past nine");
    expect(eventChip({ title: "Dentist", when: "eight", minutesUntil: 12 }, "Open wide.", now)).toBe("Dentist · in 12 minutes");
    expect(eventChip({ title: "Gym", when: "seven", minutesUntil: -5 }, "Go.", now)).toBe("Gym · on now");
    expect(eventChip({ title: "Flight", when: "six", minutesUntil: 22 * 60 + 30 }, "Pack.", now)).toBe("Flight · tomorrow, six");
  });
  it("says where the event stands under a line about something else: next, or on now", () => {
    expect(eventChip({ title: "Standup", when: "half past nine", minutesUntil: 120 }, "Desk lunch.", now, true)).toBe("Next: Standup · half past nine");
    expect(eventChip({ title: "Dentist", when: "eight", minutesUntil: 12 }, "Open wide.", now, true)).toBe("Next: Dentist · in 12 minutes");
    expect(eventChip({ title: "Call mum back", when: "seven", minutesUntil: 0 }, "Paused the hoover.", now, true)).toBe("Now: Call mum back");
    expect(eventChip({ title: "Gym", when: "seven", minutesUntil: -5, sample: true }, "Go.", now, true)).toBe("Now: Gym · sample");
  });
  it("stays away when the line says the event, or there is none", () => {
    expect(eventChip({ title: "Standup", when: "half past nine", minutesUntil: 120 }, "Standup at half past nine.", now)).toBeNull();
    expect(eventChip(null, "Hello.", now)).toBeNull();
    expect(eventChip({ title: "  ", when: "nine", minutesUntil: 30 }, "Hello.", now)).toBeNull();
  });
  it("never calls an event that has ended on now", () => {
    expect(eventChip({ title: "Gym", when: "six", minutesUntil: -75, minutesLeft: -15 }, "Go.", now)).toBeNull();
    expect(eventChip({ title: "Gym", when: "six", minutesUntil: -45, minutesLeft: 15 }, "Go.", now, true)).toBe("Now: Gym");
  });
});

describe("wake-up line", () => {
  // Sunday 18 October 2026.
  const weekdays = { enabled: true, hour: 7, minute: 30, days: [1, 2, 3, 4, 5] };
  const sunday = (h: number, m = 0) => new Date(2026, 9, 18, h, m);

  it("says when it next rings: today, tomorrow, a weekday, or next week", () => {
    expect(nextRing({ ...weekdays, days: [0] }, sunday(6))).toBe("today at 7:30 am");
    expect(nextRing(weekdays, sunday(9))).toBe("tomorrow at 7:30 am");
    expect(nextRing({ ...weekdays, days: [3] }, sunday(9))).toBe("on Wednesday at 7:30 am");
    expect(nextRing({ ...weekdays, days: [0] }, sunday(9))).toBe("next Sunday at 7:30 am");
    expect(wakeLine(weekdays, sunday(9))).toBe("Wakes you tomorrow at 7:30 am");
  });

  it("never promises a call that won't come", () => {
    expect(wakeLine({ ...weekdays, enabled: false }, sunday(9))).toBe("The wake-up call is off");
    expect(wakeLine({ ...weekdays, days: [] }, sunday(9))).toBe("No days picked, so the wake-up call is off");
    expect(nextRing({ ...weekdays, days: [] }, sunday(9))).toBeNull();
  });

  it("won't take away the last day", () => {
    expect(toggleAlarmDay([1, 3], 3)).toEqual([1]);
    expect(toggleAlarmDay([5, 1], 3)).toEqual([1, 3, 5]);
    expect(toggleAlarmDay([2], 2)).toBeNull();
  });
});

describe("webPlatform", () => {
  it("tells an Android browser, an iPhone or iPad, and a computer apart", () => {
    expect(webPlatform("Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36", 5)).toBe("android");
    expect(webPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1", 5)).toBe("ios");
    // iPadOS asks for the desktop site and says it is a Mac; only the touch points give it away.
    expect(webPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15", 5)).toBe("ios");
    expect(webPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15", 0)).toBe("desktop");
    expect(webPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36")).toBe("desktop");
  });
});
