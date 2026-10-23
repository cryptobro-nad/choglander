import type { LineEvent, NamedEvent, TokenMemory } from "@/lib/types";
import { dayKey, spokenClock, weekKey } from "@/lib/time";

export function freshMemory(relationship: TokenMemory["relationship"] = "lent"): TokenMemory {
  return {
    streak: 0,
    lastMorning: null,
    freezes: 1,
    freezeWeek: null,
    lastSeen: null,
    facts: [],
    recentLineIds: [],
    lineCount: 0,
    dayLine: null,
    relationship,
    snoozeCount: 0,
    lastSnoozeAt: null,
    wakes: [],
    attended: [],
    skipped: [],
  };
}

export function normalizeMemory(memory: Partial<TokenMemory> | null | undefined): TokenMemory {
  const base = freshMemory(memory?.relationship ?? "lent");
  if (!memory) return base;
  return {
    ...base,
    ...memory,
    facts: Array.isArray(memory.facts) ? memory.facts : [],
    recentLineIds: Array.isArray(memory.recentLineIds) ? memory.recentLineIds : [],
    wakes: Array.isArray(memory.wakes) ? memory.wakes : [],
    attended: Array.isArray(memory.attended) ? memory.attended : [],
    skipped: Array.isArray(memory.skipped) ? memory.skipped : [],
    snoozeCount: memory.snoozeCount ?? 0,
    lastSnoozeAt: memory.lastSnoozeAt ?? null,
    ...(memory.calls === undefined ? {} : { calls: Array.isArray(memory.calls) ? memory.calls.filter((call) => typeof call === "string") : [] }),
  };
}

/**
 * What a spoken line said about the day: its caption, the next event it was written for, whether a
 * picked-up call said it, `names` (the bank knows whether the line has the event in it; unknown for a
 * line the AI writer wrote) and `calendar`, a stamp of the calendar it was said against.
 */
export type LineSaid = { caption: string; event?: LineEvent | null; call?: boolean; names?: boolean; calendar?: string };

/** Comparable text: no brackets or invisible characters (the server strips them), one space, lower case. */
function plain(text: string): string {
  return text
    .replace(/[[\]{}<>​-‏⁠﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * The event a line named, or null. A bank line says so itself (`names`); otherwise the caption has to
 * hold the title as whole words, so "Gym" isn't found in "gymnastics".
 */
export function namedEvent(caption: string, event: LineEvent | null | undefined, names?: boolean): NamedEvent | null {
  const title = event?.title?.trim();
  if (!event || !title || names === false) return null;
  if (names === true) return { title, when: event.when };
  const wanted = plain(title);
  if (!wanted) return null;
  const quoted = wanted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const found = new RegExp(`(^|[^\\p{L}\\p{N}])${quoted}($|[^\\p{L}\\p{N}])`, "u").test(plain(caption));
  return found ? { title, when: event.when } : null;
}

/** The most a device adds to the line nonce: far under the billion the server holds a nonce to (src/server/context.ts). */
const DEVICE_SPREAD = 1_000_000;

/**
 * A number fixed for this device, added to the line nonce. Two phones that open the same Chog in the
 * same minute then hear different first calls, and one phone still hears the same lines for the
 * same moment.
 */
export function deviceNonce(deviceId: string): number {
  // A save from before ids, or a hand-edited one, still gets lines.
  const id = typeof deviceId === "string" ? deviceId : "";
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 0x01000193);
  // Stirred, so the low bits the writer reads (nonce % 2, % 3) differ between ids alike but for their end.
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  return (hash >>> 0) % DEVICE_SPREAD;
}

/** How many line ids are remembered, newest first. The server takes as many (LIMITS.recentIds in src/server/context.ts). */
const RECENT_LINES = 48;

/**
 * Remembers a line by id. `said`: what it said about the day, so the next line can tell the event
 * just named from a new or edited one, and the next call can tell what this call said. Pokes and
 * snoozes leave it out, as the writer skips them too.
 */
export function rememberLine(memory: TokenMemory, id: string, said?: LineSaid, now = new Date()): TokenMemory {
  // An evening of calls, pokes and captions says forty-odd lines: a voicemail or a home caption from
  // early on is still remembered, so a line not yet said comes first.
  const recent = [id, ...memory.recentLineIds.filter((item) => item !== id)].slice(0, RECENT_LINES);
  const next = { ...memory, recentLineIds: recent, lineCount: memory.lineCount + 1 };
  if (!said) return next;
  const event = namedEvent(said.caption, said.event, said.names);
  const call = said.call ? { callNamed: { date: dayKey(now), event, ...(said.calendar ? { calendar: said.calendar } : {}) } } : {};
  return { ...next, named: { id, event }, ...call };
}

/** How many calls are remembered whole: more than a judge rings in a row. */
const RECENT_CALLS = 16;

/**
 * Remembers a call in the studio voice as the lines it says, in order, so the next one never replays
 * it (callFollowUps). The lines themselves are remembered one by one as they are said (rememberLine).
 */
export function rememberCall(memory: TokenMemory, ids: string[]): TokenMemory {
  if (ids.length < 2) return memory;
  const call = ids.join(" ");
  return { ...memory, calls: [call, ...(memory.calls ?? []).filter((item) => item !== call)].slice(0, RECENT_CALLS) };
}

export function noteWake(memory: TokenMemory, now = new Date()): TokenMemory {
  const wakes = [{ at: now.toISOString(), hour: now.getHours(), minute: now.getMinutes() }, ...memory.wakes].slice(0, 14);
  return applyMorning({ ...memory, wakes, lastSeen: now.toISOString() }, now);
}

export function noteSnooze(memory: TokenMemory, now = new Date()): TokenMemory {
  return { ...memory, snoozeCount: memory.snoozeCount + 1, lastSnoozeAt: now.toISOString() };
}

function rememberTitle(list: string[], title: string): string[] {
  const clean = title.trim();
  if (!clean) return list;
  return [clean, ...list.filter((item) => item !== clean)].slice(0, 8);
}

export function noteAttended(memory: TokenMemory, title: string): TokenMemory {
  return { ...memory, attended: rememberTitle(memory.attended, title) };
}

export function noteSkipped(memory: TokenMemory, title: string): TokenMemory {
  return { ...memory, skipped: rememberTitle(memory.skipped, title) };
}

export function habitPhrase(memory: TokenMemory): string | null {
  if (memory.wakes.length < 2) return null;
  const minutes = memory.wakes.map((wake) => wake.hour * 60 + wake.minute).sort((a, b) => a - b);
  const mid = minutes[Math.floor(minutes.length / 2)];
  const when = new Date();
  when.setHours(Math.floor(mid / 60), mid % 60, 0, 0);
  return `usually up around ${spokenClock(when)}`;
}

/** The things the user told the Chog themselves, newest first, trimmed and without repeats. */
export function userFacts(memory: TokenMemory): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of memory.facts) {
    const fact = typeof raw === "string" ? raw.trim() : "";
    const key = fact.toLowerCase();
    if (!fact || seen.has(key)) continue;
    seen.add(key);
    out.push(fact);
  }
  return out.slice(0, 8);
}

/**
 * Notes the writer can say out loud: the user's own facts first (newest first, up to four),
 * then the lived-in notes the writer reads for callbacks ("skipped Standup", "snoozed 3 times").
 * Only facts fill {fact}: pass userFacts(memory) as LineContext.facts.
 */
export function memoryNotes(memory: TokenMemory, now = new Date()): string[] {
  const notes: string[] = [];
  const habit = habitPhrase(memory);
  if (habit) notes.push(habit);
  const streak = streakNow(memory, now);
  if (streak >= 2) notes.push(`${streak} mornings in a row`);
  if (memory.snoozeCount > 0) notes.push(memory.snoozeCount === 1 ? "snoozed once" : `snoozed ${memory.snoozeCount} times`);
  if (memory.attended[0]) notes.push(`showed up for ${memory.attended[0]}`);
  if (memory.skipped[0]) notes.push(`skipped ${memory.skipped[0]}`);
  return [...userFacts(memory).slice(0, 4), ...notes];
}

/** Whole calendar days from one day key ("2026-10-12") to another, daylight saving aside; null if unreadable. */
function daysBetween(from: string, to: string): number | null {
  const start = /^(\d{4})-(\d{2})-(\d{2})$/.exec(from);
  const end = /^(\d{4})-(\d{2})-(\d{2})$/.exec(to);
  if (!start || !end) return null;
  const at = (match: RegExpExecArray) => new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
  return Math.round((at(end) - at(start)) / 86_400_000);
}

/**
 * Counts a morning. The day after the last one adds to the streak; a streak freeze (one a week)
 * covers a single missed morning, never more, so a wake-up once a week is not "mornings in a row".
 */
export function applyMorning(memory: TokenMemory, now = new Date()): TokenMemory {
  const today = dayKey(now);
  if (memory.lastMorning === today) return memory;
  const week = weekKey(now);
  let freezes = memory.freezes;
  let freezeWeek = memory.freezeWeek;
  if (freezeWeek !== week) {
    freezes = 1;
    freezeWeek = week;
  }
  const gap = memory.lastMorning ? daysBetween(memory.lastMorning, today) : null;
  let streak = memory.streak;
  if (!memory.lastMorning || gap === 1) streak += 1;
  else if (gap === 2 && freezes > 0) {
    freezes -= 1;
    streak += 1;
  } else streak = 1;
  return { ...memory, streak, lastMorning: today, freezes, freezeWeek };
}

/**
 * The streak as it stands today, not as it stood at the last wake-up: kept while the last morning was
 * today or yesterday, or the day before with this week's freeze to cover the gap (as applyMorning
 * would), and 0 once it has lapsed. "4 mornings in a row" five days after the fourth is not true.
 */
export function streakNow(memory: TokenMemory, now = new Date()): number {
  if (!memory.lastMorning || memory.streak <= 0) return 0;
  const gap = daysBetween(memory.lastMorning, dayKey(now));
  if (gap === null || gap <= 1) return memory.streak;
  return gap === 2 && weekFreezes(memory, now) > 0 ? memory.streak : 0;
}

/** This week's streak freezes (a new week brings one back, as applyMorning counts them). */
function weekFreezes(memory: TokenMemory, now: Date): number {
  return memory.freezeWeek === weekKey(now) ? memory.freezes : 1;
}

/** Streak freezes left for a morning still to be missed: this week's, less the one yesterday's missed morning takes. */
export function freezesNow(memory: TokenMemory, now = new Date()): number {
  const gap = memory.lastMorning ? daysBetween(memory.lastMorning, dayKey(now)) : null;
  return Math.max(0, weekFreezes(memory, now) - (gap === 2 ? 1 : 0));
}

export function absenceHours(memory: TokenMemory, now = new Date()): number {
  if (!memory.lastSeen) return 0;
  return (now.getTime() - new Date(memory.lastSeen).getTime()) / 36e5;
}
