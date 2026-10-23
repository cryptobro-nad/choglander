import { nextAlarm } from "@/lib/calendar";
import { isArtId } from "@/lib/ids";
import type { NativePermissions, NativeRepeat } from "@/lib/native";
import type { TalkPass } from "@/lib/talkPass";
import { formatClock, MONTHS, sameDay, WEEKDAYS } from "@/lib/time";
import type { Alarm, LineEvent, Occurrence } from "@/lib/types";

// Small pure rules behind the screens, kept here so they can be tested without a DOM.

export const MIN_EVENT_MS = 15 * 60_000;
const HOUR_MS = 60 * 60_000;

type Span = { start: string; end: string };

/** Moving Starts carries Ends along, keeping the event's length (never under 15 minutes). */
export function moveStart(span: Span, next: Date): Span {
  const raw = new Date(span.end).getTime() - new Date(span.start).getTime();
  const length = Number.isFinite(raw) ? Math.max(MIN_EVENT_MS, raw) : HOUR_MS;
  return { start: next.toISOString(), end: new Date(next.getTime() + length).toISOString() };
}

/** On save, Ends is never before Starts + 15 minutes. */
export function clampEnd(span: Span): Span {
  const start = new Date(span.start).getTime();
  const end = new Date(span.end).getTime();
  if (!Number.isFinite(start)) return span;
  if (Number.isFinite(end) && end >= start + MIN_EVENT_MS) return span;
  return { start: span.start, end: new Date(start + MIN_EVENT_MS).toISOString() };
}

/** "07:30" → { hour: 7, minute: 30 }. An empty or partial time picker value gives null. */
export function parseClockInput(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/**
 * The event a call is about, under the line, when the line itself doesn't say it (a recorded line is
 * about the kind of event, "the meeting", never its title): "Standup · half past nine". Null when
 * there is no event or the line names it. `aside`: the line is about something else, so the chip
 * says where the event stands, "Next: Standup · half past nine", or "Now: Gym" once it has started.
 */
export function eventChip(event: LineEvent | null | undefined, caption: string, now: Date, aside = false): string | null {
  const title = event?.title?.trim();
  if (!event || !title || caption.toLowerCase().includes(title.toLowerCase())) return null;
  // A sample-week event is labelled, so nobody mistakes it for a plan of their own.
  const sample = event.sample ? " · sample" : "";
  if (event.minutesUntil <= 0) {
    // Over (a reminder put off past its end): it is neither on now nor next.
    if (event.minutesLeft != null && event.minutesLeft <= 0) return null;
    return aside ? `Now: ${title}${sample}` : `${title} · on now${sample}`;
  }
  const lead = aside ? "Next: " : "";
  if (event.minutesUntil < 60) return `${lead}${title} · in ${plural(Math.max(1, Math.round(event.minutesUntil)), "minute")}${sample}`;
  const at = new Date(now.getTime() + event.minutesUntil * 60_000);
  const tomorrow = at.toDateString() !== now.toDateString();
  return `${lead}${title} · ${tomorrow ? "tomorrow, " : ""}${event.when}${sample}`;
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The streak chip, as it stands today (streakNow). Before the first wake-up there is no morning
 * together yet, whatever the hour, and "Ring me in 30 s" is a test that doesn't count, so the chip says
 * morning; once a streak has lapsed (`lapsed`), the next wake-up starts one.
 */
export function streakLabel(streak: number, lapsed = false): string {
  if (streak > 0) return `${plural(streak, "morning")} in a row`;
  return lapsed ? "Next wake-up starts a new streak" : "No morning wake-ups yet";
}

/**
 * The streak freeze, said as what it does. Hidden until there is a streak for it to keep: on day one
 * "1 streak freeze" explains nothing. A freeze covers one missed morning at a time (applyMorning), so
 * two of them never make two missed mornings in a row safe.
 */
export function freezeLabel(freezes: number, streak: number): string | null {
  if (freezes <= 0 || streak <= 0) return null;
  return "A missed morning won't break it";
}

export function shareUrl(origin: string, artId: number): string {
  return `${origin.replace(/\/+$/, "")}/?chog=${artId}`;
}

/**
 * What goes with a shared card: who called, the line, and the card's own page (whose link preview
 * is the card). No link when there is no public address to give (an APK built without one).
 */
export function shareText(artId: number, caption: string, link: string): string {
  return [`Chog #${artId} just called me.`, `“${caption}”`, link].filter(Boolean).join("\n\n");
}

/** The Chog a shared link names ("?chog=821", as shareUrl builds it), or null. */
export function sharedChog(search: string): number | null {
  const value = new URLSearchParams(search).get("chog")?.trim().replace(/^#/, "");
  if (!value || !/^\d+$/.test(value)) return null;
  const artId = Number(value);
  return isArtId(artId) ? artId : null;
}

/** The alarm's title: the Android notification shows it as the caller ("Chog #375 is calling"). */
export function alarmTitle(artId?: number | null): string {
  return typeof artId === "number" && Number.isInteger(artId) && artId >= 0 ? `Chog #${artId} is calling` : "Chog is calling";
}

/**
 * What the phone's daily alarm slot should hold. Null: arm nothing and drop any pending snooze
 * (onboarding isn't finished, or it was started over: nobody has set an alarm). Otherwise the next
 * real morning, `at: null` when the alarm is off. A pending snooze is not consulted: the phone keeps
 * it in a slot of its own, and putting it in the daily slot too would ring twice.
 */
export function nativeAlarmPlan(state: { onboarded: boolean; alarm: Alarm }, now: Date): { at: number | null; repeat?: NativeRepeat } | null {
  if (!state.onboarded) return null;
  const { alarm } = state;
  const when = nextAlarm(alarm, now);
  return {
    at: when ? when.getTime() : null,
    repeat: alarm.enabled ? { hour: alarm.hour, minute: alarm.minute, days: alarm.days } : undefined,
  };
}

/** When the wake-up call next rings, in words ("tomorrow at 7:30 am"), or null when it won't. */
export function nextRing(alarm: Alarm, now: Date): string | null {
  const at = nextAlarm(alarm, now);
  if (!at) return null;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const weekday = WEEKDAYS[at.getDay()];
  const day = sameDay(at, now) ? "today" : sameDay(at, tomorrow) ? "tomorrow" : at.getDay() === now.getDay() ? `next ${weekday}` : `on ${weekday}`;
  return `${day} at ${formatClock(at)}`;
}

/** The Today sheet's alarm line: when it next rings, or plainly that it won't. */
export function wakeLine(alarm: Alarm, now: Date): string {
  const next = nextRing(alarm, now);
  if (next) return `Wakes you ${next}`;
  return alarm.enabled && alarm.days.length === 0 ? "No days picked, so the wake-up call is off" : "The wake-up call is off";
}

const PASS_KIND_LABEL: Record<TalkPass["kind"], string> = { team: "Team", judge: "Judge", guest: "Guest" };

/**
 * A saved Live Talk invite in Settings: its kind and when it ends ("Judge invite · until 2 Nov"), with
 * the hour for one that ends within a few days. One whose payload can't be read is still kept: the
 * server is the judge of it.
 */
export function inviteLabel(pass: TalkPass | null, now: Date): string {
  if (!pass) return "Checked each time you talk.";
  const end = new Date(pass.exp * 1000);
  const left = end.getTime() - now.getTime();
  const date = `${end.getDate()} ${MONTHS[end.getMonth()].slice(0, 3)}${left > 0 && left < 3 * 86_400_000 ? `, ${formatClock(end)}` : ""}`;
  return `${PASS_KIND_LABEL[pass.kind]} invite · ${left > 0 ? "until" : "ended"} ${date}`;
}

/** The alarm's days with `day` switched, or null when that would leave none: a wake-up call needs a day. */
export function toggleAlarmDay(days: readonly number[], day: number): number[] | null {
  const next = days.includes(day) ? days.filter((item) => item !== day) : [...days, day].sort((a, b) => a - b);
  return next.length ? next : null;
}

export type WebPlatform = "android" | "ios" | "desktop";

/** Which kind of browser the web app is in, for the wake-up advice. iPadOS says it is a Mac, but has touch. */
export function webPlatform(userAgent: string, touchPoints = 0): WebPlatform {
  if (/android/i.test(userAgent)) return "android";
  if (/iphone|ipad|ipod/i.test(userAgent) || (/macintosh/i.test(userAgent) && touchPoints > 1)) return "ios";
  return "desktop";
}

export function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError";
}

export type PermissionGap = { which: "notifications" | "fullscreen" | "exact"; label: string; why: string };

/** What the Android alarm is missing, said plainly, in the order worth fixing. */
export function permissionGaps(perms: NativePermissions): PermissionGap[] {
  const gaps: PermissionGap[] = [];
  if (!perms.notifications) gaps.push({ which: "notifications", label: "Notifications are off", why: "Without them the call can't appear at all." });
  if (!perms.fullScreen) gaps.push({ which: "fullscreen", label: "Full-screen calls are off", why: "The call can't ring over the lock screen." });
  if (!perms.exact) gaps.push({ which: "exact", label: "Exact alarms are off", why: "Android may ring late, whenever it gets round to it." });
  return gaps;
}

/** Hour labels hide while the now-pill sits within this many pixels, the way a phone calendar does. */
export function hourLabelClashes(hour: number, nowHours: number, pxPerHour: number, clearance = 18): boolean {
  return Math.abs(hour - nowHours) * pxPerHour < clearance;
}

/**
 * What the calendar's Chog talks about on the day on screen: the item on right now, else the next
 * one to start, else (a day that is over) the last one, which the line then treats as finished.
 * `peeks`: taps on the Chog. Every two taps it moves on to the day's other items, in order, then
 * back, so six taps aren't the same three lines about one event.
 */
export function calendarFocus(timed: Occurrence[], now: Date, peeks = 0): Occurrence | null {
  const current = timed.find((item) => item.start <= now && item.end > now);
  const next = timed.filter((item) => item.start > now).sort((a, b) => a.start.getTime() - b.start.getTime())[0];
  const last = [...timed].sort((a, b) => b.end.getTime() - a.end.getTime())[0];
  const focus = current ?? next ?? last ?? null;
  const others = timed.filter((item) => item !== focus).sort((a, b) => a.start.getTime() - b.start.getTime());
  const turn = Math.floor(Math.max(0, peeks) / 2) % (others.length + 1);
  return turn === 0 ? focus : others[turn - 1];
}
