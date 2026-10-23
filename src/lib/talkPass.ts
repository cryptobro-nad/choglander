// Live Talk invites. The owner makes a pass with scripts/talk-pass.mjs and sends it as a link
// (?pass=...); the app keeps it and shows it to /api/talk, which checks the signature
// (src/server/talkPass.ts) before it asks ElevenLabs for a short-lived line.
//
//   token = base64url(JSON payload) "." base64url(HMAC-SHA256(TALK_PASS_SECRET, first part))
//
// The payload is signed, not encrypted: anyone holding a pass can read who it is for and when it
// ends, but only the server can tell a real one from a forgery. This file has no imports, so the
// pass script can load it as it is.

export type PassKind = "team" | "judge" | "guest";

export type TalkPass = {
  /** A short random id: what a guest's calls are counted against, on the phone and on the server. */
  id: string;
  /** Who it was made for, so the owner can tell links apart. */
  name: string;
  kind: PassKind;
  /** When it stops working, in unix seconds. */
  exp: number;
  /** The live calls it carries, or null for no cap of its own. */
  calls: number | null;
};

export const PASS_KINDS: readonly PassKind[] = ["team", "judge", "guest"];

/** The team's passes last the year out. */
export const TEAM_UNTIL = Date.parse("2026-12-31T23:59:59Z") / 1000;
/** A judge's pass runs a little past judging, and keeps the phone's daily cap. */
export const JUDGE_UNTIL = Date.parse("2026-11-02T00:00:00Z") / 1000;
/** A guest gets two days and a handful of calls. */
export const GUEST_HOURS = 48;
export const GUEST_CALLS = 5;

const MAX_NAME = 40;
const MAX_CALLS = 1000;
const ID = /^[A-Za-z0-9_-]{4,24}$/;
/** A payload part, a dot, and a 43-character HMAC-SHA256 signature. */
const TOKEN = /^[A-Za-z0-9_-]{16,1024}\.[A-Za-z0-9_-]{43}$/;

/** Whether a string has the shape of a pass. Says nothing about whether it is real. */
export function looksLikePass(token: unknown): token is string {
  return typeof token === "string" && TOKEN.test(token);
}

/** A name as a pass carries it: one line, no control characters, at most 40 characters. */
export function cleanPassName(raw: string): string {
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME)
    .trim();
}

/** How long a kind of pass lasts and how many calls it carries, from `now` (unix seconds). */
export function passDefaults(kind: PassKind, now: number): { exp: number; calls: number | null } {
  if (kind === "team") return { exp: TEAM_UNTIL, calls: null };
  if (kind === "judge") return { exp: JUDGE_UNTIL, calls: null };
  return { exp: Math.floor(now) + GUEST_HOURS * 3600, calls: GUEST_CALLS };
}

/** A payload read back from a token, or null when any field is missing or out of shape. */
export function asTalkPass(value: unknown): TalkPass | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { id, name, kind, exp, calls } = value as Record<string, unknown>;
  if (typeof id !== "string" || !ID.test(id)) return null;
  if (typeof name !== "string" || name.length > MAX_NAME) return null;
  if (typeof kind !== "string" || !PASS_KINDS.includes(kind as PassKind)) return null;
  if (typeof exp !== "number" || !Number.isFinite(exp) || exp <= 0) return null;
  if (calls !== null && (typeof calls !== "number" || !Number.isInteger(calls) || calls < 0 || calls > MAX_CALLS)) return null;
  return { id, name, kind: kind as PassKind, exp, calls };
}

/** A pass anywhere in a message: a run of pass characters with the signature's dot in it. */
const TOKEN_IN_TEXT = /[A-Za-z0-9_-]{16,1024}\.[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/;

/**
 * The pass in whatever someone pasted: an invite link (its ?pass=), a message with the link in it,
 * or the pass by itself, even broken over lines. Null when there is none. Only the shape is checked
 * here; whether it is real is for /api/talk to say.
 */
export function passFromPaste(text: string): string | null {
  const raw = text.trim();
  if (!raw) return null;
  const param = /[?&#]pass=([^&#\s]+)/.exec(raw)?.[1];
  if (param !== undefined) {
    let value = param;
    try {
      value = decodeURIComponent(param);
    } catch {
      // A stray % in a link: the pass itself never has one, so it fails the shape check below.
    }
    return looksLikePass(value.trim()) ? value.trim() : null;
  }
  const joined = raw.replace(/\s+/g, "");
  if (looksLikePass(joined)) return joined;
  const found = TOKEN_IN_TEXT.exec(raw)?.[0];
  return found && looksLikePass(found) ? found : null;
}

/**
 * What a pass says about itself (its kind, when it ends), read without checking the signature: for
 * showing the holder, never for trusting. Null when the payload can't be read.
 */
export function readPass(token: string): TalkPass | null {
  if (!looksLikePass(token)) return null;
  try {
    const body = token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(body + "=".repeat((4 - (body.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return asTalkPass(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}
