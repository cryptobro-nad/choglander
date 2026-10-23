// Daily budgets for the paid paths (the AI writer and ElevenLabs).
// A request is counted against three buckets at once and goes through only if all three have room:
//   - the client: the platform-set IP plus the device header,
//   - the IP alone, so a script that invents a new device id per request still hits a wall,
//   - the whole deploy, so nothing can spend more than CHOG_DAILY_CLIPS clips in a day.

/** Per client (IP + device). A judge tapping all afternoon stays well inside this. */
export const LLM_DAILY_LIMIT = 120;
export const TTS_DAILY_LIMIT = 60;
/** Per IP. A venue or office shares one IP, so this is a few clients' worth. */
export const IP_LLM_DAILY_LIMIT = 360;
export const IP_TTS_DAILY_LIMIT = 150;
/** Whole deploy, overridable with CHOG_DAILY_CLIPS and CHOG_DAILY_LINES. */
export const DAILY_CLIPS_DEFAULT = 400;
export const DAILY_LINES_DEFAULT = 1500;
/** Past this many distinct buckets in a day, new clients are refused (the global bucket still works). */
export const MAX_BOOK_KEYS = 20000;

export type UsageKind = "llm" | "tts";
export type UsageBook = Record<string, { day: string; llm: number; tts: number }>;
export type Bucket = { key: string; limit: number };
export type ClientId = { ip: string; device: string };
export type BudgetSlot = { ok: boolean; remaining: number; book: UsageBook; blockedBy: string | null };

export function dayStamp(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function sanitizeDevice(id: string | null | undefined): string {
  const clean = (id || "").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 80);
  return clean.length >= 8 ? clean : "anon-device";
}

function cleanIp(value: string | null | undefined): string {
  const ip = (value || "").trim().replace(/[^0-9a-fA-F:.]/g, "").slice(0, 45);
  return ip.length >= 2 ? ip.toLowerCase() : "";
}

/**
 * The client IP as the platform reports it: x-real-ip (Vercel sets it), else the first
 * x-forwarded-for hop. On a host without a proxy in front, both are client-controlled.
 */
export function clientIp(headers: Pick<Headers, "get">): string {
  const real = cleanIp(headers.get("x-real-ip"));
  if (real) return real;
  const forwarded = cleanIp((headers.get("x-forwarded-for") || "").split(",")[0]);
  return forwarded || "local";
}

export function clientId(headers: Pick<Headers, "get">): ClientId {
  return { ip: clientIp(headers), device: sanitizeDevice(headers.get("x-chog-device")) };
}

/** Reads a positive whole-number budget from the environment, or the default. */
export function envBudget(env: Record<string, string | undefined>, name: string, fallback: number): number {
  const raw = env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.min(1_000_000, Math.floor(value));
}

export function bucketsFor(kind: UsageKind, client: ClientId, env: Record<string, string | undefined> = {}): Bucket[] {
  const global =
    kind === "tts"
      ? envBudget(env, "CHOG_DAILY_CLIPS", DAILY_CLIPS_DEFAULT)
      : envBudget(env, "CHOG_DAILY_LINES", DAILY_LINES_DEFAULT);
  return [
    { key: `dev:${client.ip}|${client.device}`, limit: kind === "tts" ? TTS_DAILY_LIMIT : LLM_DAILY_LIMIT },
    { key: `ip:${client.ip}`, limit: kind === "tts" ? IP_TTS_DAILY_LIMIT : IP_LLM_DAILY_LIMIT },
    { key: "global", limit: global },
  ];
}

/** Drops every bucket from an earlier day, so the book never grows past one day of clients. */
export function pruneBook(book: UsageBook, now = new Date()): UsageBook {
  const day = dayStamp(now);
  const next: UsageBook = {};
  for (const [key, row] of Object.entries(book)) {
    if (row && row.day === day) next[key] = row;
  }
  return next;
}

/** Takes one unit from every bucket, or from none of them when any one is full. */
export function takeBudget(book: UsageBook, buckets: Bucket[], kind: UsageKind, now = new Date()): BudgetSlot {
  const day = dayStamp(now);
  const today = pruneBook(book, now);
  const full = Object.keys(today).length >= MAX_BOOK_KEYS;
  let remaining = Number.POSITIVE_INFINITY;
  for (const bucket of buckets) {
    const row = today[bucket.key];
    if (!row && full && bucket.key !== "global") return { ok: false, remaining: 0, book: today, blockedBy: bucket.key };
    const used = row ? row[kind] : 0;
    if (used >= bucket.limit) return { ok: false, remaining: 0, book: today, blockedBy: bucket.key };
    remaining = Math.min(remaining, bucket.limit - used - 1);
  }
  const next: UsageBook = { ...today };
  for (const bucket of buckets) {
    const row = next[bucket.key] ?? { day, llm: 0, tts: 0 };
    next[bucket.key] = { ...row, [kind]: row[kind] + 1 };
  }
  return { ok: true, remaining: Number.isFinite(remaining) ? remaining : 0, book: next, blockedBy: null };
}

/** One bucket per device, at the per-client cap. Kept for callers that only know a device id. */
export function takeUsage(
  book: UsageBook,
  device: string,
  kind: UsageKind,
  now = new Date(),
): { ok: boolean; remaining: number; book: UsageBook } {
  const limit = kind === "llm" ? LLM_DAILY_LIMIT : TTS_DAILY_LIMIT;
  const slot = takeBudget(book, [{ key: device, limit }], kind, now);
  return { ok: slot.ok, remaining: slot.remaining, book: slot.book };
}
