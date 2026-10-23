// The rings a closed tab still gets: the page lists its next few, the server keeps them per browser
// (src/workflows/rings.ts) and sends each as a Web Push notification at its moment. Tapping one opens
// the page with ?ring=<id>, which rings it, or leaves its voicemail if it is too late (webRings.ts).
// The page works the times out in its own time zone, so the server only ever sees instants.
// Nothing here imports anything: the workflow sandbox bundles this file too.

/** How far ahead the page lists rings: it sends the list again whenever it changes, and daily. */
export const RING_HORIZON_MS = 48 * 60 * 60_000;
/** The daily wake-up looks further ahead, so a page left closed still wakes them all week. */
export const ALARM_DAYS_AHEAD = 7;
export const MAX_RINGS = 24;
/** A ring the server could only send this late (a cold start, a backlog) is dropped, not sent. */
export const RING_LATE_MS = 10 * 60_000;

/** One ring, named as the page's own loop names it (dueRing in ChogApp): alarm:, snooze:, test:, later:, reminder:. */
export type RingPush = { id: string; at: number; title: string; body: string };
/** Each desk keeps its own rings: the home page and the judge desk save separately. */
export type Desk = "home" | "judge";
/** PushSubscription.toJSON(), narrowed to what web-push needs. */
export type PushTarget = { endpoint: string; keys: { p256dh: string; auth: string } };
export type RingPlan = { desk: Desk; subscription: PushTarget; rings: RingPush[] };
/** What the service worker shows (public/sw.js reads these names). */
export type RingPayload = { title: string; body: string; tag: string; ring: string; at: number; path: string };

const KINDS = ["alarm", "snooze", "test", "later", "reminder"] as const;

export function deskPath(desk: Desk): string {
  return desk === "judge" ? "/judge" : "/";
}

/** One notification per ring: the page's own (a hidden tab) and the server's replace each other. */
export function ringTag(id: string): string {
  return `chog:${id}`;
}

export function ringPayload(ring: RingPush, desk: Desk): RingPayload {
  return { title: ring.title, body: ring.body, tag: ringTag(ring.id), ring: ring.id, at: ring.at, path: deskPath(desk) };
}

/** The ring a tapped notification asked for (?ring=<id>&at=<ms>, see public/sw.js), or null. */
export function readRingLink(search: string): { id: string; at: number } | null {
  const params = new URLSearchParams(search);
  const id = params.get("ring") ?? "";
  const at = Number(params.get("at"));
  if (!ringIdOk(id) || !Number.isFinite(at) || at <= 0) return null;
  return { id, at };
}

function ringIdOk(id: unknown): id is string {
  return typeof id === "string" && id.length <= 200 && KINDS.some((kind) => id.startsWith(`${kind}:`));
}

/**
 * The next ring to send: the earliest one not sent yet. One already more than RING_LATE_MS late is
 * skipped; the page rings it, or leaves its voicemail, the next time it opens.
 */
export function nextRing(rings: readonly RingPush[], sent: readonly string[], now: number): RingPush | null {
  let next: RingPush | null = null;
  for (const ring of rings) {
    if (sent.includes(ring.id) || ring.at < now - RING_LATE_MS) continue;
    if (!next || ring.at < next.at) next = ring;
  }
  return next;
}

const base64url = /^[A-Za-z0-9_-]+={0,2}$/;

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/\s+/g, " ").trim().slice(0, max);
  return clean || null;
}

/**
 * The browsers' own push services: Chrome and Edge's FCM, Firefox's autopush, Windows' WNS and
 * Apple's. The server only ever posts to one of these, so a made-up "subscription" can't aim it
 * anywhere else.
 */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/, /^([a-z0-9-]+\.)*notify\.windows\.com$/, /^([a-z0-9-]+\.)*push\.apple\.com$/];

/** Whether an endpoint is a real push service's: https, its default port, no credentials, a known host. */
export function pushServiceUrl(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username || url.password) return false;
  return PUSH_HOSTS.some((host) => host.test(url.hostname.toLowerCase()));
}

/**
 * A plan as POSTed to /api/push, checked and trimmed, or null. Only rings from a day ago to the
 * week ahead are kept, and at most MAX_RINGS of them: nobody can park a year of pushes here.
 */
export function readRingPlan(body: unknown, now: number): RingPlan | null {
  if (!body || typeof body !== "object") return null;
  const { desk, subscription, rings } = body as Record<string, unknown>;
  if (desk !== "home" && desk !== "judge") return null;
  if (!subscription || typeof subscription !== "object") return null;
  const { endpoint, keys } = subscription as Record<string, unknown>;
  if (typeof endpoint !== "string" || endpoint.length > 1000 || !pushServiceUrl(endpoint)) return null;
  if (!keys || typeof keys !== "object") return null;
  const { p256dh, auth } = keys as Record<string, unknown>;
  if (typeof p256dh !== "string" || p256dh.length < 40 || p256dh.length > 200 || !base64url.test(p256dh)) return null;
  if (typeof auth !== "string" || auth.length < 8 || auth.length > 60 || !base64url.test(auth)) return null;
  if (!Array.isArray(rings) || rings.length > MAX_RINGS) return null;
  const kept: RingPush[] = [];
  for (const item of rings) {
    if (!item || typeof item !== "object") return null;
    const { id, at, title, body: line } = item as Record<string, unknown>;
    const heading = text(title, 120);
    if (!ringIdOk(id) || typeof at !== "number" || !Number.isFinite(at) || !heading) return null;
    if (at < now - 24 * 60 * 60_000 || at > now + (ALARM_DAYS_AHEAD + 1) * 24 * 60 * 60_000) continue;
    if (kept.some((ring) => ring.id === id)) continue;
    kept.push({ id, at, title: heading, body: text(line, 120) ?? "" });
  }
  return { desk, subscription: { endpoint, keys: { p256dh, auth } }, rings: kept.sort((a, b) => a.at - b.at) };
}
