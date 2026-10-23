import { isSeedEvent, mostRecent, upcoming } from "@/lib/calendar";
import { memoryNotes } from "@/lib/memory";
import { isNative } from "@/lib/native";
import { PASS_KINDS, type PassKind } from "@/lib/talkPass";
import { addDays, dayKey, spokenWhen, startOfDay, WEEKDAYS } from "@/lib/time";
import type { Archetype, CalEvent, DisplayTrait, Occurrence, TokenMemory, WeatherNow } from "@/lib/types";
import { clampText, LIMITS } from "@/server/context";

// What the Chog knows when you call it back live: your name, your day and what it said last, sent to
// its ElevenLabs agent as dynamic variables when the call starts. The agent's prompt has a slot for
// each one, and its first message is the opener. Every value is cleaned like a request to the
// writer, so nothing typed can close a slot ({{ }}) or add a voice tag.

export type LiveCallInput = {
  name: string;
  archetype: Archetype;
  artId: number;
  traits: DisplayTrait[];
  relationship: TokenMemory["relationship"];
  memory: TokenMemory;
  events: CalEvent[];
  weather: WeatherNow | null;
  lastLine: string | null;
  now: Date;
};

/** Each variable the agents' prompts use. A call that leaves one out is refused by ElevenLabs. */
export type LiveCallVariables = {
  opener: string;
  user_name: string;
  chog_number: string;
  chog_looks: string;
  relationship: string;
  local_time: string;
  today: string;
  weather: string;
  memory: string;
  last_line: string;
};

const UNKNOWN = "unknown";

/** The greeting each Chog answers with, with the caller's name when it has one. */
const OPENERS: Record<Archetype, (name: string) => string> = {
  // No "notes from Tuesday": on a first call there was no Tuesday together yet.
  "told-you-so": (name) => `You called back${name ? `, ${name}` : ""}. I knew you would. I wrote it down before you dialled.`,
  hype: (name) => (name ? `AND ${name} IS ON THE LINE! What a call-back! Talk to me, champ!` : "AND THEY'RE ON THE LINE! What a call-back! Talk to me, champ!"),
  professor: (name) => `Ah${name ? `, ${name}` : ""}. A follow-up call. Excellent. Is this a question, or a field study?`,
  gremlin: (name) => `Hello${name ? `, ${name}` : ""}! Unrelated question. How attached are you to your charger?`,
  "soap-star": (name) => `${name ? `${name}. ` : ""}You called. After everything. Darling, I knew this day would come.`,
  "night-shift": (name) => `Mm. Hi${name ? `, ${name}` : ""}. I was asleep. It's fine. What.`,
  golden: (name) => `${name ? `${name}! ` : ""}You called me! Best day ever! What are we doing? Can I come?`,
  roommate: (name) => `Oh${name ? `, ${name}` : ""}, you're calling. Great. While I've got you, the bins. Go on though.`,
  legend: (name) => `Ah. ${name ? `${name}.` : "A caller."} The ancients spoke of you. Briefly. Speak.`,
};

const RELATIONSHIP: Record<TokenMemory["relationship"], string> = {
  owner: "They own you. You are their Chog, and you know it.",
  lent: "They borrowed you for the day. You are on loan, and you mention it now and then.",
  stranger: "They don't own you. Be friendly, but treat them as a visitor.",
};

function partOfDay(date: Date): string {
  const hour = date.getHours();
  if (hour < 5) return "at night";
  if (hour < 12) return "in the morning";
  if (hour < 17) return "in the afternoon";
  if (hour < 22) return "in the evening";
  return "at night";
}

/** How much of the calendar a call is told: the rest of today (a full day, not an essay) and tomorrow's first few. */
const TODAY_MOST = 8;
const TOMORROW_FIRST = 3;

/**
 * The calendar, the way a friend would read it out: everything still to come today in order, with its
 * time (what is on now, until when), tomorrow's first few, and the last thing that ended today. A
 * block from the app's sample week is marked "(sample)", so the Chog never takes it for their plans,
 * or calls them late for one.
 */
export function describeDay(events: CalEvent[], now: Date): string {
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  const named = (item: Occurrence) => {
    const title = clampText(item.event.title, LIMITS.eventTitle);
    return title && isSeedEvent(item.event) ? `${title} (sample)` : title;
  };
  const at = (date: Date) => `at ${spokenWhen(date)} ${partOfDay(date)}`;
  const ahead = upcoming(events, now, 2);
  const shown = [
    ...ahead.filter((item) => item.start < tomorrow).slice(0, TODAY_MOST),
    ...ahead.filter((item) => item.start >= tomorrow && item.start < addDays(tomorrow, 1)).slice(0, TOMORROW_FIRST),
  ];
  const rest: string[] = [];
  const next: string[] = [];
  for (const item of shown) {
    const title = named(item);
    if (!title) continue;
    if (item.start >= tomorrow) next.push(`${title} ${at(item.start)}`);
    else if (item.start <= now) rest.push(`${title}, on now until ${spokenWhen(item.end)}`);
    else {
      const minutes = Math.round((item.start.getTime() - now.getTime()) / 60000);
      rest.push(minutes < 90 ? `${title} ${at(item.start)}, in ${minutes} minutes` : `${title} ${at(item.start)}`);
    }
  }
  const past = mostRecent(events, now);
  const earlier = past && past.start >= today ? named(past) : "";
  if (!rest.length && !next.length && !earlier) return "nothing on the calendar";
  const parts = [
    rest.length ? `still to come today: ${rest.join("; ")}` : "nothing more today",
    ...(next.length ? [`tomorrow: ${next.join("; ")}`] : []),
    ...(earlier ? [`earlier today: ${earlier}`] : []),
  ];
  const sample = [...shown, ...(earlier && past ? [past] : [])].some((item) => isSeedEvent(item.event));
  if (sample) parts.push("(sample) marks the app's sample week, not plans they made");
  return parts.join(". ");
}

/**
 * A note from memory as it happened, for a live call: a reminder or wake-up they turned down is that,
 * not proof they missed the thing ("You're calling a no-show"), and one they picked up isn't proof
 * they went.
 */
function plainNote(note: string): string {
  return note
    .replace(/^skipped the morning call$/, "declined a wake-up call")
    .replace(/^skipped (.+)$/, "declined the reminder call for $1")
    .replace(/^showed up for (.+)$/, "picked up the reminder call for $1");
}

/** Whether a note is about a sample-week block they never added (an older app kept those too). */
function aboutSample(note: string, events: CalEvent[]): boolean {
  const title = /^(?:skipped|showed up for) (.+)$/.exec(note)?.[1];
  if (!title || title === "the morning call") return false;
  const same = events.filter((event) => event.title.trim() === title);
  return same.length > 0 && same.every(isSeedEvent);
}

export function liveCallVariables(input: LiveCallInput): LiveCallVariables {
  const name = clampText(input.name, LIMITS.name);
  const looks = input.traits
    .slice(0, 8)
    .map((trait) => {
      const type = clampText(trait.type, LIMITS.trait);
      const label = clampText(trait.label, LIMITS.trait);
      return type && label ? `${type}: ${label}` : "";
    })
    .filter(Boolean);
  const weather = input.weather
    ? [clampText(input.weather.phrase, LIMITS.weatherPhrase), `${input.weather.tempC} degrees`, clampText(input.weather.place, LIMITS.weatherPlace)]
        .filter(Boolean)
        .join(", ")
    : "";
  const notes = memoryNotes(input.memory, input.now)
    .filter((note) => !aboutSample(note, input.events))
    .slice(0, 6)
    .map((note) => clampText(plainNote(note), LIMITS.item))
    .filter(Boolean);
  const lastLine = clampText(input.lastLine, 240);
  return {
    opener: OPENERS[input.archetype](name),
    user_name: name || UNKNOWN,
    chog_number: `#${input.artId}`,
    chog_looks: looks.join("; ") || UNKNOWN,
    relationship: RELATIONSHIP[input.relationship],
    // To the five minutes, so the Chog never says it's a quarter to when it's twenty to.
    local_time: `${WEEKDAYS[input.now.getDay()]}, ${spokenWhen(input.now)} ${partOfDay(input.now)}`,
    today: describeDay(input.events, input.now),
    weather: weather || UNKNOWN,
    memory: notes.join("; ") || "nothing yet",
    last_line: lastLine || "nothing yet",
  };
}

// The call itself: how long it runs, how many a device gets, and what to say when it can't go through.
// The agents' minutes are finite, so the app keeps its own soft limits on top of the agents' 75 s
// cut-off. Once invites are on (/api/talk), a pass decides who calls at all.

/** The agents end a call after 75 s; the app hangs up itself at 78 s if the server hasn't. */
export const LIVE_CALL_SECONDS = 75;
export const LIVE_CALL_HARD_STOP_SECONDS = 78;
/** When the clock turns amber, and when the Chog is told to start saying goodbye. */
export const LIVE_CALL_WARN_SECONDS = 60;
export const LIVE_CALL_WRAP_UP_SECONDS = 63;
/**
 * How long a call rings, across both routes, before it gives up. WebRTC isn't cut short inside that:
 * it can take 20 s just to fail on Android (the SDK waits 3 s for the audio mode, then LiveKit allows
 * 15 s), and the websocket is tried only once it has.
 */
export const LIVE_CALL_DIAL_MS = 30_000;
/** A call the line turns away this soon after it opens (out of minutes, refused) never really connected. */
export const LIVE_CALL_GRACE_SECONDS = 5;
/**
 * Live calls a device gets a day: counted when a call connects, kept on the device. This only keeps an
 * honest device to a fair share. What protects the minutes is the invite pass /api/talk checks once
 * the agents are private; while they are public, anyone with an agent's id can call it.
 */
export const LIVE_CALLS_PER_DAY = 5;

/** "0:07", "1:15": the call clock. */
export function callClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export type CallLog = { day: string; count: number };

const CALL_LOG_KEY = "chog-calls-v1:live-calls";

// Where the count lives when the device won't keep it (private mode, blocked storage): this page only.
let unsaved: CallLog | null = null;

function deviceStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readCallLog(storage: Pick<Storage, "getItem"> | null = deviceStorage()): CallLog | null {
  try {
    if (!storage) return unsaved;
    const raw = storage.getItem(CALL_LOG_KEY);
    if (!raw) return unsaved;
    const log = JSON.parse(raw) as Partial<CallLog> | null;
    return log && typeof log.day === "string" && typeof log.count === "number" && Number.isFinite(log.count) ? { day: log.day, count: log.count } : unsaved;
  } catch {
    return unsaved;
  }
}

export function writeCallLog(log: CallLog, storage: Pick<Storage, "setItem"> | null = deviceStorage()): void {
  unsaved = log;
  try {
    storage?.setItem(CALL_LOG_KEY, JSON.stringify(log));
  } catch {
    // Full or blocked: the count above still holds for this page.
  }
}

/** One more connected call today (a new day starts the count again). */
export function logCall(log: CallLog | null, now: Date): CallLog {
  const day = dayKey(now);
  return { day, count: log?.day === day ? log.count + 1 : 1 };
}

/** Gives back today's call for one the line turned away as soon as it opened. */
export function refundCall(log: CallLog | null, now: Date): CallLog | null {
  return log?.day === dayKey(now) && log.count > 0 ? { day: log.day, count: log.count - 1 } : log;
}

export function callsLeft(log: CallLog | null, now: Date): number {
  return log?.day === dayKey(now) ? Math.max(0, LIVE_CALLS_PER_DAY - log.count) : LIVE_CALLS_PER_DAY;
}

// A guest's invite carries a few calls in all, not a day's worth. They are counted here by pass id,
// next to the day's count, when a call connects.

/** Calls connected on each invite this device has used, by pass id. */
export type InviteLog = Record<string, number>;

const INVITE_LOG_KEY = "chog-calls-v1:invite-calls";
/** The invites a device keeps counts for, newest last. A handful in practice. */
const INVITE_LOG_MOST = 20;

let unsavedInvites: InviteLog = {};

export function readInviteLog(storage: Pick<Storage, "getItem"> | null = deviceStorage()): InviteLog {
  try {
    const raw = storage?.getItem(INVITE_LOG_KEY);
    if (!raw) return unsavedInvites;
    const log = JSON.parse(raw) as unknown;
    if (!log || typeof log !== "object" || Array.isArray(log)) return unsavedInvites;
    return Object.fromEntries(Object.entries(log).filter(([, count]) => typeof count === "number" && Number.isFinite(count) && count >= 0));
  } catch {
    return unsavedInvites;
  }
}

export function writeInviteLog(log: InviteLog, storage: Pick<Storage, "setItem"> | null = deviceStorage()): void {
  unsavedInvites = log;
  try {
    storage?.setItem(INVITE_LOG_KEY, JSON.stringify(log));
  } catch {
    // Full or blocked: the count above still holds for this page.
  }
}

/** One more connected call on this invite. It moves to the end, so the oldest count is the one dropped. */
export function logInviteCall(log: InviteLog, id: string): InviteLog {
  const entries = Object.entries(log).filter(([key]) => key !== id);
  return Object.fromEntries([...entries, [id, (log[id] ?? 0) + 1]].slice(-INVITE_LOG_MOST));
}

/** Gives back the invite's call for one the line turned away as soon as it opened. */
export function refundInviteCall(log: InviteLog, id: string): InviteLog {
  return (log[id] ?? 0) > 0 ? { ...log, [id]: log[id] - 1 } : log;
}

/** A pass as /api/talk vouched for it: its kind, and the calls it carries (null: no cap of its own). */
export type HeldPass = { id: string; kind: PassKind; calls: number | null };
/** How many live calls are left, and what counts them: the day, the invite, or nothing at all. */
export type Allowance = { left: number; on: "today" | "invite" | "unlimited" };

/**
 * The calls left for a caller. Without a pass (or while Talk is public) it is the day's count. The
 * team's passes skip the daily cap; judges and guests keep it, and a guest's invite has its own
 * count on top, whichever runs out first.
 */
export function allowance(pass: HeldPass | null, log: CallLog | null, invites: InviteLog, now: Date): Allowance {
  const today = pass?.kind === "team" ? Number.POSITIVE_INFINITY : callsLeft(log, now);
  const invite = pass && pass.calls !== null ? Math.max(0, pass.calls - (invites[pass.id] ?? 0)) : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(today) && !Number.isFinite(invite)) return { left: Number.POSITIVE_INFINITY, on: "unlimited" };
  return invite <= today ? { left: invite, on: "invite" } : { left: today, on: "today" };
}

/**
 * Counts a call that just connected: one of today's, and one of the invite's when it carries a count
 * of its own. A typed chat counts the same, as one call. Says what is left afterwards.
 */
export function countCall(pass: HeldPass | null, now: Date): Allowance {
  const log = logCall(readCallLog(), now);
  writeCallLog(log);
  let invites = readInviteLog();
  if (pass && pass.calls !== null) {
    invites = logInviteCall(invites, pass.id);
    writeInviteLog(invites);
  }
  return allowance(pass, log, invites, now);
}

/** Gives back a call (or chat) the line turned away as soon as it opened, on the day and on the invite. */
export function uncountCall(pass: HeldPass | null, now: Date): Allowance {
  const log = refundCall(readCallLog(), now);
  if (log) writeCallLog(log);
  let invites = readInviteLog();
  if (pass && pass.calls !== null) {
    invites = refundInviteCall(invites, pass.id);
    writeInviteLog(invites);
  }
  return allowance(pass, log, invites, now);
}

/** What ended a call (or a typed chat) that went live. */
export type EndedBy = "you" | "time" | "chog" | "line";

/** A turn with words in it. One cut off by an interruption comes through as "…", which says nothing. */
export const saysSomething = (text: string) => /[\p{L}\p{N}]/u.test(text);

export type InviteRefusal = "no-pass" | "expired" | "used-up";

/**
 * How a call gets onto the line: by the agent's id, as Talk always has ("public"; `reached` says
 * whether /api/talk answered), with a credential good for this one call ("private"), or not at all
 * ("invite").
 */
export type LineAnswer =
  | { mode: "public"; reached: boolean; pass?: HeldPass }
  | { mode: "private"; pass: HeldPass; token: string }
  | { mode: "private"; pass: HeldPass; signedUrl: string }
  | { mode: "invite"; reason: InviteRefusal };

/** Live talk turned this caller away: no invite, or one that has ended or been used up. */
export class InviteOnly extends Error {
  readonly reason: InviteRefusal;
  constructor(reason: InviteRefusal) {
    super(`Live talk is invite-only (${reason})`);
    this.name = "InviteOnly";
    this.reason = reason;
  }
}

/** How long the app waits for /api/talk, which itself gives ElevenLabs 8 s. */
export const LINE_ASK_MS = 10_000;

const REFUSALS: readonly InviteRefusal[] = ["no-pass", "expired", "used-up"];

function heldPassOf(value: unknown): HeldPass | null {
  if (!value || typeof value !== "object") return null;
  const { id, kind, calls } = value as Record<string, unknown>;
  if (typeof id !== "string" || !id || !PASS_KINDS.includes(kind as PassKind)) return null;
  if (calls !== null && (typeof calls !== "number" || !Number.isFinite(calls))) return null;
  return { id, kind: kind as PassKind, calls };
}

/**
 * Asks /api/talk how this call gets on: the APK calls the deployed server (NEXT_PUBLIC_CHOG_API_ORIGIN).
 * Only a server that answered can turn a call away. One that can't be reached, or answers with
 * something this app doesn't know, leaves the call to dial as it always has: while the agents are
 * public that still works, and once they are private the line itself refuses it. A refusal on the
 * server's side (too many calls, ElevenLabs saying no) throws, worded for troubleOf.
 */
export async function askForLine(
  archetype: Archetype,
  route: CallRoute,
  pass: string | null,
  {
    origin = (process.env.NEXT_PUBLIC_CHOG_API_ORIGIN ?? "").replace(/\/+$/, ""),
    native = isNative(),
    timeoutMs = LINE_ASK_MS,
  }: { origin?: string; native?: boolean; timeoutMs?: number } = {},
): Promise<LineAnswer> {
  // An APK built without a server has no /api to ask.
  if (!origin && native) return { mode: "public", reached: false };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let status: number;
  let data: Record<string, unknown> | null;
  try {
    const res = await fetch(`${origin}/api/talk`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ archetype, connection: route, ...(pass ? { pass } : {}) }),
      cache: "no-store",
      signal: controller.signal,
    });
    status = res.status;
    const body = (await res.json().catch(() => null)) as unknown;
    data = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return { mode: "public", reached: false };
  } finally {
    clearTimeout(timer);
  }
  if (status === 403 && REFUSALS.includes(data?.reason as InviteRefusal)) return { mode: "invite", reason: data?.reason as InviteRefusal };
  if (status === 429) throw new Error("The live line returned 429: too many calls from here today");
  if (status === 502) {
    const upstream = typeof data?.status === "number" ? data.status : null;
    throw new Error(upstream ? `ElevenLabs returned ${upstream}` : "ElevenLabs did not answer");
  }
  if (status !== 200 || !data) return { mode: "public", reached: false };
  if (data.mode === "public") {
    // A public line can still vouch for a pass (the team's lifts the daily cap).
    const vouched = heldPassOf(data.pass);
    return vouched ? { mode: "public", reached: true, pass: vouched } : { mode: "public", reached: true };
  }
  if (data.mode !== "private") return { mode: "public", reached: false };
  const held = heldPassOf(data.pass);
  if (held && route === "webrtc" && typeof data.token === "string" && data.token) return { mode: "private", pass: held, token: data.token };
  if (held && route === "websocket" && typeof data.signedUrl === "string" && data.signedUrl.startsWith("wss://")) {
    return { mode: "private", pass: held, signedUrl: data.signedUrl };
  }
  throw new Error("The live line sent no way in");
}

const FIRST_PERSON = /^(?:i|my)\b/i;
const NOT_A_FACT = /\b(?:you|your|yours|don't know|dunno|not sure|no idea|can't hear|cannot hear|hello|hi|hey|bye|goodbye|testing|calling)\b/i;

/**
 * Up to two things the caller said about themselves on a live call, newest first, to file with the
 * facts typed in Settings, so a later call can say them back ("You told me you've got an interview
 * tomorrow"). Only short, plain first-person statements: no questions, nothing about the Chog, no
 * "I don't know".
 */
export function callFacts(lines: { who: "chog" | "you"; text: string }[]): string[] {
  const facts: string[] = [];
  for (const line of [...lines].reverse()) {
    if (line.who !== "you") continue;
    const sentences = line.text.replace(/’/g, "'").match(/[^.!?]+[.!?]*/g) ?? [];
    for (const raw of sentences.reverse()) {
      const sentence = raw.trim();
      const plain = clampText(sentence.replace(/[\s.!]+$/, ""), LIMITS.item + 1);
      const words = plain.split(" ").length;
      if (sentence.endsWith("?") || plain.length > LIMITS.item || words < 4 || words > 14) continue;
      if (!FIRST_PERSON.test(plain) || NOT_A_FACT.test(plain)) continue;
      if (facts.some((fact) => fact.toLowerCase() === plain.toLowerCase())) continue;
      facts.push(plain);
      if (facts.length === 2) return facts;
    }
  }
  return facts;
}

/** What each Chog says when this device has used today's live calls. */
export const OUT_OF_CALLS: Record<Archetype, string> = {
  "told-you-so": "Again? I predicted this. I also predicted I'd stop picking up. Tomorrow.",
  hype: "WHAT A DAY ON THE PHONES! The crowd's gone home, champ. Rematch tomorrow!",
  professor: "Today's sample is complete. Further calls tomorrow, for rigour.",
  gremlin: "I chewed through the phone line. Unrelated. Call tomorrow.",
  "soap-star": "Darling, we've said everything there is to say. Today. Tomorrow, the sequel.",
  "night-shift": "No. I've talked enough for one day. Tomorrow. Maybe.",
  golden: "I loved every call! I'm all talked out today, but I'll be right here tomorrow!",
  roommate: "I've hit my talking limit for today. The bins haven't. Tomorrow.",
  legend: "The oracle speaks only so many times a day. Return at dawn.",
};

/** Why a call didn't go through, in the words the call screen uses. */
export type CallTrouble = "mic" | "no-mic" | "update" | "offline" | "busy" | "refused" | "timeout" | "dropped";

/** The call rang out, or a route timed out on the network, without a line getting through. */
export class LiveCallTimeout extends Error {
  constructor() {
    super("No connection within the call's connect time");
    this.name = "LiveCallTimeout";
  }
}

/** An Error, a websocket close, or the SDK's disconnect details: its name, message and close code. */
function errorText(error: unknown): string {
  if (!error || typeof error !== "object") return String(error ?? "");
  const said = error as { name?: unknown; message?: unknown; closeCode?: unknown; closeReason?: unknown };
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  return [text(said.name), text(said.message), text(said.closeReason), typeof said.closeCode === "number" ? `close code ${said.closeCode}` : ""].join(" ");
}

/** LiveKit's own connect timeouts: the signal, or the media path (UDP blocked) after 15 s. */
function timedOut(error: unknown): boolean {
  return /timed out|timeout|could not establish pc connection/i.test(errorText(error));
}

/**
 * Reads what went wrong from the SDK's errors, its disconnect details and the messages it reported.
 * Running out of minutes or hitting a limit is "busy", a refused session (an allowlist, a bad agent,
 * auth turned on) is "refused"; both are on our side, and say so instead of blaming the line.
 */
export function troubleOf(...errors: unknown[]): CallTrouble {
  const text = errors.map(errorText).join(" ");
  if (/LiveCallTimeout/.test(text)) return "timeout";
  if (/ChunkLoadError|loading chunk|failed to load chunk|dynamically imported module|importing a module script failed/i.test(text)) return "update";
  if (/NotAllowedError|PermissionDeniedError|permission denied|denied permission|not allowed by the user agent/i.test(text)) return "mic";
  if (/NotFoundError|NotReadableError|OverconstrainedError|DevicesNotFoundError|requested device not found|could not start audio source/i.test(text)) return "no-mic";
  if (/quota|credits?\b|limit|too many|insufficient|payment|returned (402|429)\b|close code 1013\b/i.test(text)) return "busy";
  if (/returned 4\d\d\b|unauthori[sz]ed|forbidden|authenticat|allowlist|not allowed|close code (1008|4\d\d\d)\b/i.test(text)) return "refused";
  return "dropped";
}

/** A failed microphone request: refused, or no microphone to open. */
export function micTroubleOf(error: unknown): "mic" | "no-mic" {
  return troubleOf(error) === "no-mic" ? "no-mic" : "mic";
}

/**
 * A call the line closed within its first few seconds for a reason on our side (out of minutes, a
 * limit, a refusal). The SDK reports these only once the call has opened, as an error message and
 * then a disconnect, so they come here rather than to dialLive.
 */
export function turnedAway(seconds: number, ...reports: unknown[]): "busy" | "refused" | null {
  if (seconds > LIVE_CALL_GRACE_SECONDS) return null;
  const kind = troubleOf(...reports);
  return kind === "busy" || kind === "refused" ? kind : null;
}

export type CallRoute = "webrtc" | "websocket";

/**
 * Connects a live call: over WebRTC first (its echo cancellation keeps a phone's loudspeaker out of
 * the mic), and only if that fails on the network, once more over a websocket, so two sessions never
 * run at once. The whole call rings for at most `capMs`. `current` tells a route's callbacks whether
 * they still speak for this call; a connection that turns up after it was given up on is hung up at
 * once. Running out of time, or a route timing out, is a LiveCallTimeout ("this network may be
 * blocking calls"); two routes that simply failed give the last error, a dropped line.
 */
export async function dialLive<S extends { endSession: () => Promise<void> }>(
  start: (route: CallRoute, current: () => boolean) => Promise<S>,
  { capMs = LIVE_CALL_DIAL_MS, cancelled = () => false, onFallback }: { capMs?: number; cancelled?: () => boolean; onFallback?: () => void } = {},
): Promise<S> {
  let rangOut = false;
  const stopped = () => rangOut || cancelled();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cap = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      rangOut = true;
      reject(new LiveCallTimeout());
    }, capMs);
  });
  cap.catch(() => undefined);
  const attempt = (route: CallRoute) =>
    Promise.race([
      Promise.resolve()
        .then(() => start(route, () => !stopped()))
        .then((session) => {
          if (!stopped()) return session;
          void session.endSession().catch(() => undefined);
          throw new Error("Call cancelled");
        }),
      cap,
    ]);
  try {
    return await attempt("webrtc");
  } catch (first) {
    if (stopped() || troubleOf(first) !== "dropped") throw first;
    onFallback?.();
    try {
      return await attempt("websocket");
    } catch (second) {
      if (stopped() || troubleOf(second) !== "dropped") throw second;
      throw timedOut(first) || timedOut(second) ? new LiveCallTimeout() : second;
    }
  } finally {
    clearTimeout(timer);
  }
}
