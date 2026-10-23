import { ALARM_WINDOW_MS, alarmSlotKey, isSeedEvent, REMINDER_WINDOW_MS, upcoming } from "@/lib/calendar";
import { agedEvent } from "@/lib/call";
import { ALARM_DAYS_AHEAD, MAX_RINGS, RING_HORIZON_MS, type RingPush } from "@/lib/ringPush";
import type { SavedState } from "@/lib/types";

// The web app's rings for a closed tab (see ringPush.ts): which ones the server should send, and
// what a tapped one that came too late leaves behind. The phone app arms its own alarms instead.

/** A notification tapped later than this is old news: it opens the app and nothing more. */
export const MISSED_STALE_MS = 12 * 60 * 60_000;
const ANSWER = "Tap to answer.";

type RingState = Pick<SavedState, "onboarded" | "alarm" | "lastAlarmKey" | "events" | "fired" | "snoozeUntil" | "snoozeTest" | "ringAt" | "later">;

/** "Chog #375", the caller as alarmTitle names it. */
function chogName(artId: number | null | undefined): string {
  return typeof artId === "number" && Number.isInteger(artId) && artId >= 0 ? `Chog #${artId}` : "Chog";
}

/** "Standup in 10 min · Chog #642", or "Standup now · Chog #642" when it rings at the start. */
function eventTitle(title: string, minutes: number, who: string): string {
  const name = title.trim() || "Your event";
  return `${name} ${minutes >= 1 ? `in ${Math.round(minutes)} min` : "now"} · ${who}`;
}

/**
 * The rings the server should send while the tab is closed, earliest first: everything the page's
 * own loop (dueRing in ChogApp) would ring in the next RING_HORIZON_MS, and the wake-up for the
 * week. Each keeps the id that loop gives it, so a tap lands on the same ring. Nothing on the phone
 * (it arms its own alarms) or before setup is done (nobody has set an alarm yet).
 */
export function webRings(state: RingState, now: Date, options: { artId: number | null; native: boolean }): RingPush[] {
  if (options.native || !state.onboarded) return [];
  const who = chogName(options.artId);
  const caller = `${who} is calling`;
  const from = now.getTime();
  const rings: RingPush[] = [];
  const add = (id: string, at: number, title: string) => {
    if (at > from && !rings.some((ring) => ring.id === id)) rings.push({ id, at, title, body: ANSWER });
  };

  // "Ring me in 30 s", a snooze and "Remind me in 5" are saved with their moment.
  if (typeof state.ringAt === "number") add(`test:${state.ringAt}`, state.ringAt, caller);
  if (state.snoozeUntil) {
    const at = Date.parse(state.snoozeUntil);
    if (Number.isFinite(at)) add(`snooze:${state.snoozeUntil}`, at, caller);
  }
  const later = state.later;
  if (later && typeof later.at === "number") {
    // The event as it will stand when the call comes back, as the page will ring it (agedEvent).
    const event = later.event ? agedEvent(later.event, later.rangAt, later.at) : null;
    const over = event?.minutesLeft != null && event.minutesLeft <= 0;
    add(`later:${later.at}`, later.at, event && !over ? eventTitle(event.title, event.minutesUntil, who) : caller);
  }

  // The wake-up, one slot a day, keyed as the page keys it (alarmSlotKey); the one already rung is
  // left out. Each day's time, and the week's end, are set on the local clock, so a clock change
  // moves the instants with it.
  const { alarm } = state;
  if (alarm.enabled && Number.isFinite(alarm.hour) && Number.isFinite(alarm.minute)) {
    const weekOn = new Date(now);
    weekOn.setDate(now.getDate() + ALARM_DAYS_AHEAD);
    for (let i = 0; i <= ALARM_DAYS_AHEAD; i++) {
      const date = new Date(now);
      date.setDate(now.getDate() + i);
      if (!alarm.days.includes(date.getDay())) continue;
      date.setHours(alarm.hour, alarm.minute, 0, 0);
      const key = alarmSlotKey(alarm, date);
      if (key !== state.lastAlarmKey && date <= weekOn) add(`alarm:${key}`, date.getTime(), caller);
    }
  }

  // Reminders for their own events. The sample week is left out: it is not their plans, and a
  // closed tab is not worth waking for a demo's dentist.
  for (const item of upcoming(state.events, now, 2)) {
    const { event } = item;
    if (event.reminderMin == null || isSeedEvent(event) || state.fired.includes(item.key)) continue;
    const at = item.start.getTime() - event.reminderMin * 60_000;
    if (at <= from + RING_HORIZON_MS) add(`reminder:${item.key}`, at, eventTitle(event.title, event.reminderMin, who));
  }

  return rings.sort((a, b) => a.at - b.at).slice(0, MAX_RINGS);
}

/**
 * A tapped notification for a ring the page can no longer ring: the change that settles it, so the
 * page leaves its voicemail instead. Null while it can still ring (the page's loop rings it within
 * the second), once it has rung or been put off, and for a notification hours old. A test ring and
 * "Remind me in 5" need nothing here: the loop leaves the voicemail of one that came due unseen.
 */
export function missedRing(state: RingState, link: { id: string; at: number }, now: Date): Partial<SavedState> | null {
  const late = now.getTime() - link.at;
  if (late < 0 || late > MISSED_STALE_MS) return null;
  if (link.id.startsWith("alarm:")) {
    // Past its window the loop never rings that slot, so there is nothing to mark.
    return link.id.slice("alarm:".length) !== state.lastAlarmKey && late >= ALARM_WINDOW_MS ? {} : null;
  }
  if (link.id.startsWith("snooze:")) {
    const until = link.id.slice("snooze:".length);
    if (state.snoozeUntil !== until || state.snoozeTest === true || late < ALARM_WINDOW_MS) return null;
    return { snoozeUntil: null, snoozeTest: false };
  }
  if (link.id.startsWith("reminder:")) {
    const key = link.id.slice("reminder:".length);
    const at = key.lastIndexOf("@");
    const event = state.events.find((item) => key.slice(0, at) === item.id);
    const start = Date.parse(key.slice(at + 1));
    if (!event || at < 0 || !Number.isFinite(start) || state.fired.includes(key)) return null;
    // A reminder of their own still rings until its event starts (dueReminder).
    const until = isSeedEvent(event) ? link.at + REMINDER_WINDOW_MS : Math.max(start, link.at + REMINDER_WINDOW_MS);
    if (now.getTime() < until) return null;
    return { fired: [...state.fired, key].slice(-200) };
  }
  return null;
}
