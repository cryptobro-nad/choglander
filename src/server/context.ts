import { CHOG_SUPPLY } from "@/lib/ids";
import { WEEKDAYS } from "@/lib/time";
import type {
  Archetype,
  DisplayTrait,
  LineContext,
  LineEvent,
  LineIntent,
  NamedEvent,
  PokeZone,
  SkyPhase,
  TokenMemory,
  WeatherKind,
  WeatherNow,
} from "@/lib/types";
import { ARCHETYPES } from "@/lib/voices";

// Everything the client sends is rebuilt here field by field, so nothing unknown, oversized or
// out of range reaches the writer, the AI writer or the voice. Each limit is the longest value the
// app itself produces, with some room.
export const LIMITS = {
  name: 24,
  eventTitle: 60,
  eventWhen: 24,
  habit: 80,
  weatherPhrase: 40,
  weatherPlace: 40,
  trait: 32,
  traits: 16,
  facts: 5,
  memory: 8,
  item: 80,
  clock: 16,
  spokenClock: 32,
  recentIds: 48,
  recentId: 48,
} as const;

// Records keyed by the union make the compiler fail if a member is added to the type and not here.
const INTENTS: Record<LineIntent, true> = {
  intro: true,
  greeting: true,
  morning: true,
  reminder: true,
  poke: true,
  voicemail: true,
  idle: true,
  absence: true,
  snooze: true,
};
const ZONES: Record<PokeZone, true> = { hat: true, face: true, collar: true };
const PHASES: Record<SkyPhase, true> = { dawn: true, morning: true, day: true, dusk: true, night: true };
const WEATHER: Record<WeatherKind, true> = {
  clear: true,
  cloud: true,
  rain: true,
  snow: true,
  fog: true,
  wind: true,
  hot: true,
  cold: true,
};
const RELATIONSHIPS: Record<TokenMemory["relationship"], true> = { stranger: true, lent: true, owner: true };

function oneOf<T extends string>(table: Record<T, true>, value: unknown): T | undefined {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(table, value) ? (value as T) : undefined;
}

// Control characters, zero-width and bidi marks, and the characters that mean something to the
// writer ({slot}) or the voice ([tag]) are removed from anything a person typed.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g;
const MARKUP = /[[\]{}<>]/g;

/** Trims, cleans and cuts a typed value to at most `max` characters (whole code points). */
export function clampText(value: unknown, max: number): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  const clean = String(value).replace(INVISIBLE, " ").replace(MARKUP, "").replace(/\s+/g, " ").trim();
  return Array.from(clean).slice(0, max).join("").trim();
}

function clampList(value: unknown, count: number, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (out.length >= count) break;
    const text = clampText(item, max);
    if (text) out.push(text);
  }
  return out;
}

function finite(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function cleanEvent(value: unknown): LineEvent | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const title = clampText(raw.title, LIMITS.eventTitle);
  if (!title) return null;
  const event: LineEvent = {
    title,
    when: clampText(raw.when, LIMITS.eventWhen),
    minutesUntil: Math.round(finite(raw.minutesUntil, -100_000, 100_000, 0)),
  };
  // When it ends, so the server's line never has an event that is over on "right now".
  if (raw.minutesLeft != null) event.minutesLeft = Math.round(finite(raw.minutesLeft, -100_000, 100_000, 0));
  return event;
}

function cleanWeather(value: unknown): WeatherNow | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const kind = oneOf(WEATHER, raw.kind);
  const phrase = clampText(raw.phrase, LIMITS.weatherPhrase);
  if (!kind || !phrase) return null;
  return {
    kind,
    tempC: Math.round(finite(raw.tempC, -80, 60, 0)),
    phrase,
    place: clampText(raw.place, LIMITS.weatherPlace),
  };
}

function cleanTraits(value: unknown): DisplayTrait[] {
  if (!Array.isArray(value)) return [];
  const out: DisplayTrait[] = [];
  for (const item of value) {
    if (out.length >= LIMITS.traits) break;
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const type = clampText(raw.type, LIMITS.trait);
    const label = clampText(raw.label, LIMITS.trait);
    if (!type || !label) continue;
    out.push({ type, value: clampText(raw.value, LIMITS.trait) || label, label });
  }
  return out;
}

const cleanId = (item: string) => item.replace(/[^a-zA-Z0-9_.:-]/g, "").slice(0, LIMITS.recentId);

function cleanRecentIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .slice(0, LIMITS.recentIds)
    .map(cleanId)
    .filter(Boolean);
}

/** An event a line named: cut like nextEvent, so the two compare the same way they did on the phone. */
function cleanNamed(value: unknown): NamedEvent | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const title = clampText(raw.title, LIMITS.eventTitle);
  return title ? { title, when: clampText(raw.when, LIMITS.eventWhen) } : null;
}

function cleanLastNamed(value: unknown): LineContext["lastNamed"] {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === "string" ? cleanId(raw.id) : "";
  return id ? { id, event: cleanNamed(raw.event) } : null;
}

/**
 * Rebuilds a line context from an untrusted request body. Returns null when the essentials are
 * missing or not one of the known values (art id, archetype, intent).
 */
export function sanitizeContext(value: unknown): LineContext | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const artId = raw.artId;
  if (typeof artId !== "number" || !Number.isInteger(artId) || artId < 1 || artId > CHOG_SUPPLY) return null;
  const archetype = typeof raw.archetype === "string" && (ARCHETYPES as string[]).includes(raw.archetype) ? (raw.archetype as Archetype) : null;
  const intent = oneOf(INTENTS, raw.intent);
  if (!archetype || !intent) return null;
  const weekday = (WEEKDAYS as readonly string[]).includes(raw.weekday as string) ? (raw.weekday as string) : "Today";
  const habit = clampText(raw.habit, LIMITS.habit);
  const ctx: LineContext = {
    name: clampText(raw.name, LIMITS.name),
    artId,
    archetype,
    traits: cleanTraits(raw.traits),
    intent,
    zone: oneOf(ZONES, raw.zone),
    phase: oneOf(PHASES, raw.phase) ?? "day",
    weekday,
    clock: clampText(raw.clock, LIMITS.clock),
    spokenClock: clampText(raw.spokenClock, LIMITS.spokenClock),
    weather: cleanWeather(raw.weather),
    nextEvent: cleanEvent(raw.nextEvent),
    pastEvent: cleanEvent(raw.pastEvent),
    nowEvent: cleanEvent(raw.nowEvent),
    memory: clampList(raw.memory, LIMITS.memory, LIMITS.item),
    facts: clampList(raw.facts, LIMITS.facts, LIMITS.item),
    relationship: oneOf(RELATIONSHIPS, raw.relationship),
    streak: Math.round(finite(raw.streak, 0, 3650, 0)),
    habit: habit || null,
    absenceHours: finite(raw.absenceHours, 0, 24 * 365, 0),
    nonce: Math.round(finite(raw.nonce, 0, 1_000_000_000, 0)),
    recentIds: cleanRecentIds(raw.recentIds),
    inCall: raw.inCall === true,
    lastNamed: cleanLastNamed(raw.lastNamed),
    callEvent: cleanNamed(raw.callEvent),
  };
  if (!ctx.zone) delete ctx.zone;
  if (!ctx.nowEvent) delete ctx.nowEvent;
  if (!ctx.relationship) delete ctx.relationship;
  if (!ctx.inCall) delete ctx.inCall;
  if (!ctx.lastNamed) delete ctx.lastNamed;
  if (!ctx.callEvent) delete ctx.callEvent;
  return ctx;
}
