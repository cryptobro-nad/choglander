import { isSeedEvent } from "@/lib/calendar";
import { normalizeMemory } from "@/lib/memory";
import { cleanAlarmStyle, DEFAULT_ALARM_STYLE } from "@/lib/ringtones";
import { looksLikePass } from "@/lib/talkPass";
import type { Alarm, CalEvent, ChogMeta, EventColor, Recurrence, SavedState } from "@/lib/types";
import { addDays, atTime, startOfDay } from "@/lib/time";

/** The phone's own saved state. */
export const KEY = "chog-calls-v1";
/** The judge desk keeps its own state, so a judge always lands on the same reproducible desk. */
export const JUDGE_KEY = `${KEY}:judge`;
/** Metadata of Chogs that are not bundled, so a chosen Chog opens offline (and from an alarm). */
const META_KEY = `${KEY}:meta`;
const seedMarker = (key: string) => `${key}:seed`;
/** The art id the judge desk opens on: the Hype Man, the main act (FIRST_CALLER in chog.ts). */
export const JUDGE_ART = 642;

export function storageKey(judge: boolean): string {
  return judge ? JUDGE_KEY : KEY;
}

export function defaultAlarm(): Alarm {
  return { enabled: true, hour: 7, minute: 30, days: [0, 1, 2, 3, 4, 5, 6] };
}

function block(
  id: string,
  day: Date,
  hour: number,
  minute: number,
  durationMin: number,
  title: string,
  color: EventColor,
  recurrence: Recurrence = "none",
): CalEvent {
  const start = atTime(day, hour, minute);
  return {
    id,
    title,
    start: start.toISOString(),
    end: new Date(start.getTime() + durationMin * 60 * 1000).toISOString(),
    allDay: false,
    recurrence,
    reminderMin: 10,
    color,
    notes: "",
  };
}

/**
 * Bump when seedEvents changes. Seeded ids start with `seed-v${SEED_VERSION}-`. A saved calendar
 * whose demo blocks came from an older seed is refreshed once (the person's own events are kept).
 * A missing marker counts as 0.
 */
export const SEED_VERSION = 3;

type Seed = {
  key: string;
  /** 0 = Sunday … 6 = Saturday: the weekday a weekly event sits on. Omit for weekdays. */
  weekday?: number;
  hour: number;
  minute: number;
  minutes: number;
  title: string;
  color: EventColor;
  recurrence: Recurrence;
  reminderMin: number | null;
};

/**
 * A believable adult week that repeats, so every day has a demo day: work on weekdays,
 * errands and people at the weekend. Titles are short nouns so they read naturally
 * inside spoken lines ("Standup at half past nine", "Dentist is in a few minutes").
 */
const WEEK: Seed[] = [
  { key: "standup", hour: 9, minute: 30, minutes: 15, title: "Standup", color: "lilac", recurrence: "weekdays", reminderMin: 10 },
  { key: "deep-work", hour: 10, minute: 0, minutes: 90, title: "Deep work", color: "sky", recurrence: "weekdays", reminderMin: null },
  { key: "lunch", hour: 12, minute: 30, minutes: 45, title: "Lunch", color: "sage", recurrence: "weekdays", reminderMin: null },
  { key: "gym-mon", weekday: 1, hour: 18, minute: 0, minutes: 60, title: "Gym", color: "sage", recurrence: "weekly", reminderMin: 15 },
  { key: "review-tue", weekday: 2, hour: 15, minute: 0, minutes: 45, title: "Design review", color: "rose", recurrence: "weekly", reminderMin: 10 },
  { key: "book-club", weekday: 2, hour: 19, minute: 30, minutes: 90, title: "Book club", color: "butter", recurrence: "weekly", reminderMin: 15 },
  { key: "one-on-one", weekday: 3, hour: 14, minute: 0, minutes: 30, title: "One-on-one", color: "lilac", recurrence: "weekly", reminderMin: 10 },
  { key: "gym-wed", weekday: 3, hour: 18, minute: 0, minutes: 60, title: "Gym", color: "sage", recurrence: "weekly", reminderMin: 15 },
  { key: "review-thu", weekday: 4, hour: 15, minute: 0, minutes: 45, title: "Design review", color: "rose", recurrence: "weekly", reminderMin: 10 },
  { key: "dinner", weekday: 4, hour: 19, minute: 30, minutes: 90, title: "Dinner", color: "rose", recurrence: "weekly", reminderMin: 15 },
  { key: "drinks", weekday: 5, hour: 18, minute: 30, minutes: 120, title: "Drinks", color: "butter", recurrence: "weekly", reminderMin: 15 },
  { key: "bakery", weekday: 6, hour: 10, minute: 0, minutes: 60, title: "Bakery run", color: "sage", recurrence: "weekly", reminderMin: 15 },
  { key: "haircut", weekday: 6, hour: 13, minute: 0, minutes: 45, title: "Haircut", color: "sky", recurrence: "weekly", reminderMin: 15 },
  { key: "dinner-party", weekday: 6, hour: 19, minute: 30, minutes: 150, title: "Dinner party", color: "rose", recurrence: "weekly", reminderMin: 30 },
  { key: "brunch", weekday: 0, hour: 11, minute: 0, minutes: 90, title: "Brunch", color: "butter", recurrence: "weekly", reminderMin: 15 },
  { key: "walk", weekday: 0, hour: 15, minute: 0, minutes: 60, title: "Long walk", color: "sage", recurrence: "weekly", reminderMin: null },
  { key: "groceries", weekday: 0, hour: 17, minute: 30, minutes: 45, title: "Groceries", color: "sky", recurrence: "weekly", reminderMin: 15 },
];

export function seedEvents(now: Date): CalEvent[] {
  const today = startOfDay(now);
  // Recurring events start on this week's Sunday so the whole week view is filled.
  const sunday = addDays(today, -today.getDay());
  const id = (key: string) => `seed-v${SEED_VERSION}-${key}`;
  const events: CalEvent[] = WEEK.map((seed) => {
    const origin = seed.weekday === undefined ? sunday : addDays(sunday, seed.weekday);
    return {
      ...block(id(seed.key), origin, seed.hour, seed.minute, seed.minutes, seed.title, seed.color, seed.recurrence),
      reminderMin: seed.reminderMin,
    };
  });
  // Bin day: an all-day reminder of adult life, every Thursday.
  events.push({
    id: id("bins"),
    title: "Bin day",
    start: atTime(addDays(sunday, 4), 0, 0).toISOString(),
    end: atTime(addDays(sunday, 4), 23, 59).toISOString(),
    allDay: true,
    recurrence: "weekly",
    reminderMin: null,
    color: "butter",
    notes: "",
  });
  // One dentist appointment, this afternoon on a weekday, otherwise next Monday.
  const weekday = today.getDay() >= 1 && today.getDay() <= 5;
  const dentistDay = weekday ? today : addDays(today, today.getDay() === 6 ? 2 : 1);
  events.push({ ...block(id("dentist"), dentistDay, 16, 30, 45, "Dentist", "sky"), reminderMin: 30 });
  return events;
}

/** The first demo calendar was two pale blocks. Replace only that, never a person's own events. */
export function withDemoCalendar(events: CalEvent[], now: Date): CalEvent[] {
  const thin = events.length === 0 || (events.every((event) => event.id.startsWith("seed-")) && events.length < 5);
  return thin ? seedEvents(now) : events;
}

export function defaultSaved(): SavedState {
  return {
    version: 1,
    deviceId: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `dev-${Date.now()}`,
    userName: "",
    artId: null,
    onboarded: false,
    mute: false,
    liveVoice: false,
    alarm: defaultAlarm(),
    alarmStyle: { ...DEFAULT_ALARM_STYLE },
    events: [],
    memory: {},
    voicemails: [],
    fired: [],
    lastAlarmKey: null,
    seeded: false,
    snoozeUntil: null,
  };
}

const RECURRENCES: readonly Recurrence[] = ["none", "daily", "weekdays", "weekly"];
const COLORS: readonly EventColor[] = ["lilac", "sage", "butter", "rose", "sky"];

const validDate = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));

/**
 * The saved calendar, cleaned: an event with no string id or title, or a start or end that is not
 * a date, is dropped (one bad entry must never stop the app from opening); any other missing
 * field gets its default.
 */
export function cleanEvents(raw: unknown): CalEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: CalEvent[] = [];
  const ids = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const event = item as Partial<Record<keyof CalEvent, unknown>>;
    if (typeof event.id !== "string" || !event.id || ids.has(event.id)) continue;
    if (typeof event.title !== "string") continue;
    if (!validDate(event.start) || !validDate(event.end)) continue;
    const start = Date.parse(event.start);
    ids.add(event.id);
    out.push({
      id: event.id,
      title: event.title,
      start: event.start,
      end: Date.parse(event.end) >= start ? event.end : event.start,
      allDay: event.allDay === true,
      recurrence: RECURRENCES.includes(event.recurrence as Recurrence) ? (event.recurrence as Recurrence) : "none",
      reminderMin: typeof event.reminderMin === "number" && Number.isFinite(event.reminderMin) && event.reminderMin >= 0 ? event.reminderMin : null,
      color: COLORS.includes(event.color as EventColor) ? (event.color as EventColor) : "sky",
      notes: typeof event.notes === "string" ? event.notes : "",
    });
  }
  return out;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadSaved(key: string = KEY): SavedState {
  try {
    const raw = storage()?.getItem(key);
    if (!raw) return defaultSaved();
    const parsed = JSON.parse(raw) as SavedState;
    if (!parsed || parsed.version !== 1) return defaultSaved();
    return {
      ...defaultSaved(),
      ...parsed,
      alarm: { ...defaultAlarm(), ...(parsed.alarm || {}) },
      alarmStyle: cleanAlarmStyle(parsed.alarmStyle),
      events: cleanEvents(parsed.events),
      snoozeUntil: parsed.snoozeUntil ?? null,
      memory: Object.fromEntries(Object.entries(parsed.memory || {}).map(([id, item]) => [id, normalizeMemory(item)])),
      voicemails: Array.isArray(parsed.voicemails) ? parsed.voicemails : [],
      fired: Array.isArray(parsed.fired) ? parsed.fired : [],
    };
  } catch {
    return defaultSaved();
  }
}

export function writeSaved(state: SavedState, key: string = KEY) {
  try {
    storage()?.setItem(key, JSON.stringify(state));
  } catch {
    /* private mode or a full disk: the session still works */
  }
}

/** "Start over": forgets this desk's state. Other desks and the metadata cache are kept. */
export function clearSaved(key: string = KEY) {
  try {
    storage()?.removeItem(key);
    storage()?.removeItem(seedMarker(key));
  } catch {
    /* nothing to clear */
  }
}

function readSeedVersion(key: string): number {
  try {
    return Number(storage()?.getItem(seedMarker(key)) ?? 0) || 0;
  } catch {
    return 0;
  }
}

function writeSeedVersion(key: string, version: number) {
  try {
    storage()?.setItem(seedMarker(key), String(version));
  } catch {
    /* the next load tries again */
  }
}

const isSeed = isSeedEvent;

/** A v2 sample "Farmers market" becomes v3's "Bakery run" (a title the person changed is theirs). */
function withoutMarket(event: CalEvent): CalEvent {
  if (!isSeed(event) || !event.id.endsWith("-market")) return event;
  const id = event.id.replace(/^seed-v\d+-/, `seed-v${SEED_VERSION}-`).replace(/-market$/, "-bakery");
  return { ...event, id, title: event.title === "Farmers market" ? "Bakery run" : event.title };
}

/**
 * The sample week laid out again when it no longer sits at its own hours. Its blocks are saved as
 * moments, so after a move to another time zone Standup would show at midnight. Only the sample
 * blocks still there come back (a deleted one stays deleted; one the person edited has a new id
 * and is theirs). Null when nothing moved, a change of summer time included.
 */
export function rezonedSamples(events: CalEvent[], now: Date): CalEvent[] | null {
  const fresh = new Map(seedEvents(now).map((event) => [event.id, event]));
  const clock = (iso: string) => {
    const at = new Date(iso);
    return at.getHours() * 60 + at.getMinutes();
  };
  const moved = events.some((event) => {
    const seed = fresh.get(event.id);
    return seed != null && clock(seed.start) !== clock(event.start);
  });
  return moved ? events.map((event) => fresh.get(event.id) ?? event) : null;
}

/**
 * Seeding rules, pure. The demo calendar is added once (when !seeded) and never comes back after
 * the person deletes it, except on a judge desk left empty. When the seed content changes
 * (seedVersion < SEED_VERSION), demo blocks that are still there are refreshed once to this week;
 * the person's own events are never touched.
 * The judge desk starts onboarded with Chog #642, the Hype Man.
 */
export function prepareSaved(
  state: SavedState,
  now: Date,
  options: { judge?: boolean; seedVersion?: number } = {},
): { state: SavedState; seedVersion: number; changed: boolean } {
  let next = state;
  const version = options.seedVersion ?? 0;
  if (!next.seeded) {
    next = { ...next, seeded: true, events: [...next.events.filter((event) => !isSeed(event)), ...seedEvents(now)] };
  } else if (version === 2 && next.events.some(isSeed)) {
    // v3 only renamed Saturday's "Farmers market" to "Bakery run". Done in place, so sample blocks
    // someone deleted stay deleted and ones they edited keep their edits.
    next = { ...next, events: next.events.map(withoutMarket) };
  } else if (version < SEED_VERSION && next.events.some(isSeed)) {
    next = { ...next, events: [...next.events.filter((event) => !isSeed(event)), ...seedEvents(now)] };
  } else if (options.judge && next.events.length === 0) {
    // The judge desk is the demo: its calls, Today and Talk build on the sample week, so a desk left
    // with an empty calendar gets the sample week back on the next visit.
    next = { ...next, events: seedEvents(now) };
  } else {
    const rezoned = rezonedSamples(next.events, now);
    if (rezoned) next = { ...next, events: rezoned };
  }
  if (options.judge && !next.onboarded) {
    next = { ...next, artId: JUDGE_ART, userName: next.userName || "Judge", onboarded: true };
  }
  return { state: next, seedVersion: SEED_VERSION, changed: next !== state || version !== SEED_VERSION };
}

export type SavedPatch = Partial<SavedState> | ((prev: SavedState) => SavedState);

/** A small external store for useSyncExternalStore: null on the server, the saved state in a browser. */
export type SavedStore = {
  key: string;
  get: () => SavedState | null;
  set: (patch: SavedPatch) => void;
  subscribe: (listener: () => void) => () => void;
  /** Forgets everything on this desk and starts again from a fresh, seeded state. */
  reset: () => void;
};

const stores = new Map<string, SavedStore>();

/** The judge desk's Chog before the Hype Man became the main act. */
const OLD_JUDGE_ART = 375;

function openSaved(key: string, judge: boolean, now: Date): SavedState {
  const prepared = prepareSaved(loadSaved(key), now, { judge, seedVersion: readSeedVersion(key) });
  let state = prepared.state;
  let changed = prepared.changed;
  // A desk opened before the Hype Man took the first call still holds #375: it moves over once.
  // A judge who picks #375 again afterwards keeps it.
  if (judge && !readFlag("judge-main-act")) {
    if (state.artId === OLD_JUDGE_ART) {
      state = { ...state, artId: JUDGE_ART };
      changed = true;
    }
    writeFlag("judge-main-act");
  }
  if (changed) {
    writeSaved(state, key);
    writeSeedVersion(key, prepared.seedVersion);
  }
  return state;
}

/** Drops ?reset=1 from the address once it has been honoured, so a reload keeps the new state. */
function takeResetParam(): boolean {
  const url = new URL(window.location.href);
  if (url.searchParams.get("reset") !== "1") return false;
  url.searchParams.delete("reset");
  try {
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    /* the address keeps the flag; the state is still reset only once per load */
  }
  return true;
}

/**
 * Takes a Live Talk invite (?pass=) from the address and drops it from there, so it never sits in
 * the history or a screenshot of the address bar. Null when there is none, or it isn't shaped like one.
 */
export function takePassParam(): string | null {
  const url = new URL(window.location.href);
  const pass = url.searchParams.get("pass");
  if (pass === null) return null;
  url.searchParams.delete("pass");
  try {
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    /* the address keeps it; the pass is still saved */
  }
  const clean = pass.trim();
  return looksLikePass(clean) ? clean : null;
}

/** The desk's state with this invite kept, or as it was when there is none or it is already kept. */
export function withTalkPass(state: SavedState, pass: unknown): SavedState {
  return looksLikePass(pass) && state.talkPass !== pass ? { ...state, talkPass: pass } : state;
}

/**
 * The Live Talk pass this person holds: the one kept on this desk, else the one on the other desk.
 * An invite is for the person, not the desk, so a judge link opened on / still works on /judge.
 */
export function heldPass(judge: boolean, state: SavedState | null): string | null {
  if (looksLikePass(state?.talkPass)) return state.talkPass;
  try {
    const other = JSON.parse(storage()?.getItem(storageKey(!judge)) ?? "null") as { talkPass?: unknown } | null;
    return looksLikePass(other?.talkPass) ? other.talkPass : null;
  } catch {
    return null;
  }
}

/**
 * The store for one desk (the phone, or the judge desk). The first read in a browser honours
 * ?reset=1, then seeds and migrates. Starting over keeps a Live Talk invite: it isn't part of the desk.
 */
export function savedStore(judge: boolean): SavedStore {
  const key = storageKey(judge);
  const existing = stores.get(key);
  if (existing) return existing;
  let current: SavedState | null = null;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  const init = (): SavedState => {
    if (current) return current;
    let held: string | undefined;
    if (takeResetParam()) {
      held = loadSaved(key).talkPass;
      clearSaved(key);
    }
    current = openSaved(key, judge, new Date());
    const kept = withTalkPass(current, held);
    if (kept !== current) {
      current = kept;
      writeSaved(kept, key);
    }
    // Another tab saved: this one takes the newer state, so its own next save builds on it instead
    // of writing back what it had and erasing that tab's change. (A removal is skipped: Start over
    // in the other tab writes its fresh state right after.)
    window.addEventListener("storage", (event) => {
      if (event.key !== key || event.newValue == null || event.storageArea !== storage()) return;
      current = loadSaved(key);
      emit();
    });
    return current;
  };
  const store: SavedStore = {
    key,
    get: () => (typeof window === "undefined" ? null : init()),
    set: (patch) => {
      if (typeof window === "undefined") return;
      const base = init();
      const next = typeof patch === "function" ? patch(base) : { ...base, ...patch };
      if (next === base) return;
      current = next;
      writeSaved(next, key);
      emit();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reset: () => {
      if (typeof window === "undefined") return;
      const held = current?.talkPass;
      clearSaved(key);
      const fresh = openSaved(key, judge, new Date());
      current = withTalkPass(fresh, held);
      if (current !== fresh) writeSaved(current, key);
      emit();
    },
  };
  stores.set(key, store);
  return store;
}

/**
 * Forgets the Live Talk invite on both desks: heldPass finds one on either, so taking it off one desk
 * alone would leave it in use. The other desk is cleared first, so this desk's save, which always
 * tells its listeners, is the moment the invite is gone everywhere.
 */
export function dropTalkPass(judge: boolean): void {
  const other = storageKey(!judge);
  const without = (state: SavedState): SavedState => {
    const next = { ...state };
    delete next.talkPass;
    return next;
  };
  const open = stores.get(other);
  if (open) open.set(without);
  else {
    try {
      const raw = storage()?.getItem(other);
      const saved = raw ? (JSON.parse(raw) as unknown) : null;
      if (saved && typeof saved === "object" && "talkPass" in saved) {
        delete (saved as { talkPass?: unknown }).talkPass;
        storage()?.setItem(other, JSON.stringify(saved));
      }
    } catch {
      /* the other desk keeps it; this one still lets go */
    }
  }
  savedStore(judge).set(without);
}

/** Remembers a non-bundled Chog's metadata (the last few) so it opens without the network. */
export function rememberMeta(artId: number, meta: ChogMeta) {
  try {
    const local = storage();
    if (!local) return;
    const all = JSON.parse(local.getItem(META_KEY) || "{}") as Record<string, ChogMeta & { at?: number }>;
    // Strictly increasing, so "most recent" holds even for several saves in one millisecond.
    const newest = Math.max(0, ...Object.values(all).map((item) => item.at ?? 0));
    all[String(artId)] = { name: meta.name, image: meta.image, attributes: meta.attributes, at: Math.max(Date.now(), newest + 1) };
    const kept = Object.entries(all)
      .sort((a, b) => (b[1].at ?? 0) - (a[1].at ?? 0))
      .slice(0, 8);
    local.setItem(META_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    /* the network still works next time */
  }
}

export function recallMeta(artId: number): ChogMeta | null {
  try {
    const all = JSON.parse(storage()?.getItem(META_KEY) || "{}") as Record<string, ChogMeta>;
    const meta = all[String(artId)];
    return meta && Array.isArray(meta.attributes) ? { name: meta.name, image: meta.image, attributes: meta.attributes } : null;
  } catch {
    return null;
  }
}

/** A one-time flag on this phone, e.g. "native permissions were asked once". */
export function readFlag(name: string): boolean {
  try {
    return storage()?.getItem(`${KEY}:flag:${name}`) === "1";
  } catch {
    return false;
  }
}

export function writeFlag(name: string) {
  try {
    storage()?.setItem(`${KEY}:flag:${name}`, "1");
  } catch {
    /* asked again next launch */
  }
}
