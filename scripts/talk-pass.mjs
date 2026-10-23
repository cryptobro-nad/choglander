// Makes a Live Talk invite: a signed pass, printed as a ready link. Opening the link once keeps the
// pass on that phone; /api/talk checks it before every live call.
//
//   node scripts/talk-pass.mjs --kind guest --name "Alex"      48 hours, 5 calls
//   node scripts/talk-pass.mjs --kind judge --name "Judge 3"   until 2 Nov 2026, the phone's daily cap, opens /judge
//   node scripts/talk-pass.mjs --kind team --name "Sam"        until the end of 2026, no cap
//   ...  --calls 10 | --calls none     another number of calls, or no cap of its own
//   ...  --until 2026-10-30            another end (a date means its end, UTC)
//   ...  --origin http://localhost:43123                       a link to another deployment
//
// `npm run pass -- --kind guest --name "Alex"` is the same, without Node's note about loading a .ts
// file. Reads TALK_PASS_SECRET from the environment, else .env.local. It must be the deployment's
// own secret, or every pass it makes is refused there. The secret is never printed.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, parseEnv } from "node:util";
import { cleanPassName, PASS_KINDS, passDefaults } from "../src/lib/talkPass.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SITE = "https://choglander.vercel.app";
/** A shorter secret could be guessed; the script won't sign with one. */
export const MIN_SECRET = 32;

/** Whole days written as a date run to the end of that day, UTC. */
function untilSeconds(raw) {
  const value = raw.trim();
  const at = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59Z` : value);
  if (!Number.isFinite(at)) throw new Error(`--until is not a date: "${raw}"`);
  return Math.floor(at / 1000);
}

function callsFrom(raw) {
  const value = raw.trim().toLowerCase();
  if (value === "none" || value === "unlimited") return null;
  const calls = Number(value);
  if (!Number.isInteger(calls) || calls < 1 || calls > 1000) throw new Error(`--calls must be 1 to 1000, or none: "${raw}"`);
  return calls;
}

/** The pass payload: the kind's defaults, then any --calls or --until given. */
export function makePass({ kind, name, calls, until, now = Date.now(), id = crypto.randomBytes(6).toString("base64url") }) {
  if (!PASS_KINDS.includes(kind)) throw new Error(`--kind must be one of ${PASS_KINDS.join(", ")}`);
  const clean = cleanPassName(name ?? "");
  if (!clean) throw new Error('--name is needed, so you can tell your links apart (e.g. --name "Alex")');
  const nowSeconds = Math.floor(now / 1000);
  const base = passDefaults(kind, nowSeconds);
  const pass = {
    id,
    name: clean,
    kind,
    exp: until === undefined ? base.exp : untilSeconds(until),
    calls: calls === undefined ? base.calls : callsFrom(calls),
  };
  if (pass.exp <= nowSeconds) throw new Error("That pass would already have ended");
  return pass;
}

/** Signs exactly as src/server/talkPass.ts checks: HMAC-SHA256 of the base64url payload. */
export function signPass(pass, secret) {
  const body = Buffer.from(JSON.stringify(pass), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", Buffer.from(secret, "utf8")).update(body).digest("base64url");
  return `${body}.${sig}`;
}

/** The link to send: judges land on their desk, everyone else on the app. */
export function passLink(token, kind, origin = SITE) {
  let base;
  try {
    base = new URL(origin);
  } catch {
    throw new Error(`--origin is not a URL: "${origin}"`);
  }
  if (base.protocol !== "https:" && base.protocol !== "http:") throw new Error(`--origin must be http(s): "${origin}"`);
  return `${base.origin}/${kind === "judge" ? "judge" : ""}?pass=${token}`;
}

/** TALK_PASS_SECRET from the environment, else from .env.local. */
export function readSecret(env = process.env, envFile = path.join(ROOT, ".env.local")) {
  const own = env.TALK_PASS_SECRET?.trim();
  if (own) return own;
  if (!fs.existsSync(envFile)) return "";
  return parseEnv(fs.readFileSync(envFile, "utf8")).TALK_PASS_SECRET?.trim() ?? "";
}

function describe(pass) {
  const until = new Date(pass.exp * 1000).toUTCString().replace(/:\d\d GMT$/, " UTC");
  const calls = pass.calls === null ? (pass.kind === "judge" ? "the phone's daily cap" : "no cap") : `${pass.calls} live call${pass.calls === 1 ? "" : "s"}`;
  return `${pass.kind[0].toUpperCase()}${pass.kind.slice(1)} pass for ${pass.name} (id ${pass.id}): ${calls}, until ${until}.`;
}

function main(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      kind: { type: "string" },
      name: { type: "string" },
      calls: { type: "string" },
      until: { type: "string" },
      origin: { type: "string" },
    },
    strict: true,
  });
  const secret = readSecret();
  if (!secret) {
    throw new Error(
      "TALK_PASS_SECRET is not set (in the environment or .env.local). Use the deployment's own secret.\n" +
        `A new one: node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`,
    );
  }
  if (secret.length < MIN_SECRET) throw new Error(`TALK_PASS_SECRET is too short to sign with: use ${MIN_SECRET} or more random characters.`);
  const pass = makePass(values);
  // The summary goes to stderr, so the link alone can be piped or copied.
  console.error(describe(pass));
  console.log(passLink(signPass(pass, secret), pass.kind, values.origin ?? SITE));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
