import crypto from "node:crypto";
import { asTalkPass, type TalkPass } from "@/lib/talkPass";

// Checks a Live Talk invite (the format is in src/lib/talkPass.ts). Only scripts/talk-pass.mjs makes
// passes; this server only ever verifies them, with TALK_PASS_SECRET, which never leaves it.

type Env = Record<string, string | undefined>;

export type PassCheck =
  | { ok: true; pass: TalkPass }
  | { ok: false; reason: "unconfigured" | "no-pass" | "expired" };

const PART = /^[A-Za-z0-9_-]+$/;

/** The signing key, or null when TALK_PASS_SECRET is not set. */
export function talkPassSecret(env: Env = process.env): Buffer | null {
  const own = env.TALK_PASS_SECRET?.trim();
  return own ? Buffer.from(own, "utf8") : null;
}

/** Pass ids the owner has called back (TALK_PASS_REVOKED, comma separated), for a link that went too far. */
export function revokedPasses(env: Env = process.env): Set<string> {
  return new Set(
    (env.TALK_PASS_REVOKED ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

function sign(part: string, secret: Buffer): string {
  return crypto.createHmac("sha256", secret).update(part).digest("base64url");
}

/** A signed pass. The pass script signs the same way; this one is for tests. */
export function signTalkPass(pass: TalkPass, secret: string): string {
  const body = Buffer.from(JSON.stringify(pass), "utf8").toString("base64url");
  return `${body}.${sign(body, Buffer.from(secret, "utf8"))}`;
}

/**
 * Checks the signature first (in constant time), then the shape, then the expiry and the revoked
 * list. A missing, malformed or forged pass is "no-pass": the caller learns nothing about why.
 */
export function verifyTalkPass(token: unknown, env: Env = process.env, now = Date.now()): PassCheck {
  const secret = talkPassSecret(env);
  if (!secret) return { ok: false, reason: "unconfigured" };
  if (typeof token !== "string" || token.length > 2048) return { ok: false, reason: "no-pass" };
  const [body, sig, extra] = token.split(".");
  if (extra !== undefined || !body || !sig || !PART.test(body) || !PART.test(sig)) return { ok: false, reason: "no-pass" };
  const expected = Buffer.from(sign(body, secret), "utf8");
  const given = Buffer.from(sig, "utf8");
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return { ok: false, reason: "no-pass" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "no-pass" };
  }
  const pass = asTalkPass(parsed);
  if (!pass) return { ok: false, reason: "no-pass" };
  // A revoked pass reads as ended: from the holder's side, that is what it is.
  if (pass.exp * 1000 <= now || revokedPasses(env).has(pass.id)) return { ok: false, reason: "expired" };
  return { ok: true, pass };
}
