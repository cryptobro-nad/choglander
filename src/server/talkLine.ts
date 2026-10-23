import { AGENTS } from "@/lib/agents";
import { dayStamp, MAX_BOOK_KEYS } from "@/lib/limits";
import type { PassKind } from "@/lib/talkPass";
import type { Archetype } from "@/lib/types";
import { verifyTalkPass } from "@/server/talkPass";

// /api/talk: the door to a live call. Until the owner sets both ELEVENLABS_API_KEY and
// TALK_PASS_SECRET it answers "public", and the app dials the agent by its id as it always has.
// Once both are set it checks the caller's invite pass, then asks ElevenLabs, with the key, for a
// credential good for one conversation: a WebRTC token, or a signed websocket URL. With the agents
// made private that credential is the only way in, and the key never leaves this server.

type Env = Record<string, string | undefined>;

export type TalkRoute = "webrtc" | "websocket";
export type TalkRequest = { archetype: Archetype; connection: TalkRoute; pass: string | null };
/** What the app is told about a pass this server accepted: enough to count its calls, nothing to forge with. */
export type PassView = { id: string; kind: PassKind; calls: number | null; exp: number };
export type TalkRefusal = "no-pass" | "expired" | "used-up";

/** The way in: the agent's id as before ("public"), or a credential for one call ("private"). */
export type TalkLine = { mode: "public"; pass?: PassView } | ({ mode: "private"; pass: PassView } & ({ token: string } | { signedUrl: string }));

export type TalkAnswer =
  | { status: 200; body: TalkLine }
  | { status: 403; body: { reason: TalkRefusal } }
  | { status: 400 | 429 | 502; body: { error: string; status?: number } };

const CONVERSATION = "https://api.elevenlabs.io/v1/convai/conversation";
/** ElevenLabs answers these in well under a second; past this the call has rung long enough. */
const CREDENTIAL_TIMEOUT_MS = 8000;
/** Credentials one IP may take in a day: a couple of dozen calls, each maybe trying both routes. */
export const TALK_IP_DAILY = 60;
/**
 * Credentials a pass of N calls may take on one server instance. A call can take a WebRTC token and
 * then a websocket URL, and a failed one is often tried again. The phone counts the calls themselves;
 * this is the backstop for one that forgot (cleared storage, a script).
 */
export const TRIES_PER_CALL = 3;

/** Whether invites are switched on: both the key and the pass secret are set. */
export function talkPrivate(env: Env = process.env): boolean {
  return Boolean(env.ELEVENLABS_API_KEY?.trim() && env.TALK_PASS_SECRET?.trim());
}

/** The request body, or null when it isn't one the app sends. */
export function readTalkRequest(body: unknown): TalkRequest | null {
  if (!body || typeof body !== "object") return null;
  const { archetype, connection, pass } = body as Record<string, unknown>;
  if (typeof archetype !== "string" || !Object.hasOwn(AGENTS, archetype)) return null;
  if (connection !== "webrtc" && connection !== "websocket") return null;
  return { archetype: archetype as Archetype, connection, pass: typeof pass === "string" ? pass : null };
}

// Counted in memory, per instance: light limits, not a ledger.
const byIp = new Map<string, { day: string; count: number }>();
const byPass = new Map<string, number>();

/** Forgets every count. For tests. */
export function resetTalkCounts(): void {
  byIp.clear();
  byPass.clear();
}

/** Takes one credential from the IP's day, or says no when the day is spent (or the book is full). */
function takeIp(ip: string, now: Date): boolean {
  const day = dayStamp(now);
  const row = byIp.get(ip);
  if (row?.day === day) {
    if (row.count >= TALK_IP_DAILY) return false;
    byIp.set(ip, { day, count: row.count + 1 });
    return true;
  }
  if (byIp.size >= MAX_BOOK_KEYS) {
    for (const [key, old] of byIp) if (old.day !== day) byIp.delete(key);
    if (byIp.size >= MAX_BOOK_KEYS) return false;
  }
  byIp.set(ip, { day, count: 1 });
  return true;
}

type Credential = { token: string } | { signedUrl: string } | { error: string; status?: number };

/** One conversation's credential from ElevenLabs. Never cached: each is good for one call. */
async function credential(route: TalkRoute, agentId: string, key: string, fetcher: typeof fetch): Promise<Credential> {
  const url = `${CONVERSATION}/${route === "webrtc" ? "token" : "get-signed-url"}?agent_id=${encodeURIComponent(agentId)}`;
  let res: Response;
  try {
    res = await fetcher(url, { headers: { "xi-api-key": key }, cache: "no-store", signal: AbortSignal.timeout(CREDENTIAL_TIMEOUT_MS) });
  } catch {
    return { error: "upstream" };
  }
  if (!res.ok) return { error: "upstream", status: res.status };
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return { error: "upstream", status: res.status };
  }
  const said = (data ?? {}) as { token?: unknown; signed_url?: unknown };
  if (route === "webrtc") return typeof said.token === "string" && said.token ? { token: said.token } : { error: "upstream", status: res.status };
  // Only a websocket on ElevenLabs' own hosts: the app connects to whatever URL this returns.
  const signed = typeof said.signed_url === "string" && /^wss:\/\/([a-z0-9-]+\.)*elevenlabs\.io\//i.test(said.signed_url) ? said.signed_url : "";
  return signed ? { signedUrl: signed } : { error: "upstream", status: res.status };
}

/**
 * Answers one /api/talk request: public while invites are off, else a refusal (no pass, expired,
 * used up, or too many from this IP) or a credential for the archetype's agent on that route.
 */
export async function answerTalk(
  request: TalkRequest,
  { env = process.env, ip = "local", now = new Date(), fetcher = fetch }: { env?: Env; ip?: string; now?: Date; fetcher?: typeof fetch } = {},
): Promise<TalkAnswer> {
  const key = env.ELEVENLABS_API_KEY?.trim();
  if (!key || !talkPrivate(env)) {
    // Still public, but with the pass secret set this server can vouch for a pass already: the team's
    // lifts the daily cap before invites are switched on. A bad pass changes nothing while Talk is open.
    const check = env.TALK_PASS_SECRET?.trim() ? verifyTalkPass(request.pass, env, now.getTime()) : null;
    if (!check?.ok) return { status: 200, body: { mode: "public" } };
    const { pass } = check;
    return { status: 200, body: { mode: "public", pass: { id: pass.id, kind: pass.kind, calls: pass.calls, exp: pass.exp } } };
  }
  const check = verifyTalkPass(request.pass, env, now.getTime());
  if (!check.ok) return { status: 403, body: { reason: check.reason === "expired" ? "expired" : "no-pass" } };
  const { pass } = check;
  const used = byPass.get(pass.id) ?? 0;
  if (pass.calls !== null && used >= pass.calls * TRIES_PER_CALL) return { status: 403, body: { reason: "used-up" } };
  // The team's pass has no limit at all: not the phone's daily cap, and not this per-IP one either.
  if (pass.kind !== "team" && !takeIp(ip, now)) return { status: 429, body: { error: "busy" } };
  byPass.set(pass.id, used + 1);
  const got = await credential(request.connection, AGENTS[request.archetype], key, fetcher);
  if ("error" in got) return { status: 502, body: got };
  const view: PassView = { id: pass.id, kind: pass.kind, calls: pass.calls, exp: pass.exp };
  return { status: 200, body: { mode: "private", ...got, pass: view } };
}
