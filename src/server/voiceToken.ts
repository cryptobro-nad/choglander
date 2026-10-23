import crypto from "node:crypto";
import { sanitizeDevice } from "@/lib/limits";

// /api/speak hands the client a short-lived, signed ticket for one clip; /api/voice redeems it.
// The ticket is stateless, so it works whichever instance answers, and the signature means the
// voice route only ever speaks text this server wrote: it is not an open text-to-speech proxy.
//
//   token = base64url(JSON payload) "." base64url(HMAC-SHA256(secret, first part))
//
// The payload is signed, not encrypted: the line itself is readable in the URL (it is the caption
// the client already shows). The secret never leaves the server.

type Env = Record<string, string | undefined>;

export type VoicePayload = {
  /** Exactly what ElevenLabs is asked to say, tags included when the model takes them. */
  text: string;
  voiceId: string;
  model: string;
  /** The device the line was written for, so /api/voice can count it against that device's budget. */
  device: string;
  /** Expiry, in milliseconds since the epoch. */
  exp: number;
};

export type VoiceCheck =
  | { ok: true; payload: VoicePayload }
  | { ok: false; reason: "malformed" | "signature" | "expired" | "unconfigured" };

/** How long a ticket stays good. A line is played within seconds; ten minutes covers a replay. */
export const VOICE_TOKEN_TTL_MS = 10 * 60 * 1000;
/** The most text a ticket may carry (TTS_MAX_CHARS in speech.ts is 320). */
const MAX_TEXT = 400;
const VOICE_ID = /^[A-Za-z0-9]{12,40}$/;
const MODEL_ID = /^[a-z0-9_]{3,48}$/;
const PART = /^[A-Za-z0-9_-]+$/;

/**
 * The signing key: CHOG_VOICE_SECRET when set, else a key derived one-way from ELEVENLABS_API_KEY
 * (an HMAC of a fixed label, so the API key itself cannot be recovered from it). Null when neither
 * is set, which also means there is no live voice to sign for.
 */
export function voiceSecret(env: Env = process.env): Buffer | null {
  const own = env.CHOG_VOICE_SECRET?.trim();
  if (own) return Buffer.from(own, "utf8");
  const key = env.ELEVENLABS_API_KEY?.trim();
  if (!key) return null;
  return crypto.createHmac("sha256", key).update("chog-calls/voice-token/v1").digest();
}

function sign(part: string, secret: Buffer): string {
  return crypto.createHmac("sha256", secret).update(part).digest("base64url");
}

/** A signed ticket for one clip, or null when no secret is configured. */
export function signVoiceToken(
  fields: Omit<VoicePayload, "exp">,
  env: Env = process.env,
  now = Date.now(),
): string | null {
  const secret = voiceSecret(env);
  if (!secret) return null;
  const payload: VoicePayload = { ...fields, exp: now + VOICE_TOKEN_TTL_MS };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

function asPayload(value: unknown): VoicePayload | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const { text, voiceId, model, device, exp } = raw;
  if (typeof text !== "string" || !text.trim() || text.length > MAX_TEXT) return null;
  if (typeof voiceId !== "string" || !VOICE_ID.test(voiceId)) return null;
  if (typeof model !== "string" || !MODEL_ID.test(model)) return null;
  if (typeof exp !== "number" || !Number.isFinite(exp)) return null;
  return { text, voiceId, model, device: sanitizeDevice(typeof device === "string" ? device : ""), exp };
}

/** Checks the signature first (in constant time), then the shape, then the expiry. */
export function verifyVoiceToken(token: string | null | undefined, env: Env = process.env, now = Date.now()): VoiceCheck {
  const secret = voiceSecret(env);
  if (!secret) return { ok: false, reason: "unconfigured" };
  if (typeof token !== "string" || token.length > 4096) return { ok: false, reason: "malformed" };
  const [body, sig, extra] = token.split(".");
  if (extra !== undefined || !body || !sig || !PART.test(body) || !PART.test(sig)) return { ok: false, reason: "malformed" };
  const expected = Buffer.from(sign(body, secret), "utf8");
  const given = Buffer.from(sig, "utf8");
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return { ok: false, reason: "signature" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const payload = asPayload(parsed);
  if (!payload) return { ok: false, reason: "malformed" };
  // A ticket from the future (beyond the TTL plus a minute of clock skew) is not one this server wrote.
  if (payload.exp <= now || payload.exp > now + VOICE_TOKEN_TTL_MS + 60_000) return { ok: false, reason: "expired" };
  return { ok: true, payload };
}
