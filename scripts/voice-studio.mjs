// The studio voice: records every voiced joke line once, in its Chog's ElevenLabs voice, as
// public/voice/<archetype>/<key>.mp3, and lists what is recorded in src/data/voice-clips.json (the
// app plays a line's clip when the list has it). Recording is idempotent: a clip already on disk is
// never paid for twice, and a changed line gets a new key.
//
//   node scripts/voice-studio.mjs plan                     lines, characters and cost, no API calls
//   node scripts/voice-studio.mjs add                      add the cast's library voices to the account
//   node scripts/voice-studio.mjs render [archetype ...] [--limit N]
//   node scripts/voice-studio.mjs prune                    delete clips no joke file says any more
//
// Without an API key here, the clips can be recorded through the ElevenLabs connection (MCP) instead,
// one call per clip, then brought in:
//   node scripts/voice-studio.mjs jobs <dir> [archetype ...]   <dir>/<archetype>.jobs.json, one empty folder per clip
//   node scripts/voice-studio.mjs collect <dir> [archetype ...]  move each <dir>/<archetype>/<key>/*.mp3 into public/voice
//
// Reads ELEVENLABS_API_KEY from .env.local. The key is never printed. ELEVENLABS_VOICE_<NAME> (as in
// .env.example) swaps one Chog's voice.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { clipKey, recordable, spokenText } from "../src/lib/clips.ts";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const JOKES = path.join(ROOT, "src/data/jokes");
const OUT = path.join(ROOT, "public/voice");
const LIST = path.join(ROOT, "src/data/voice-clips.json");
const API = "https://api.elevenlabs.io/v1";
const MODEL = "eleven_v3";
const FORMAT = "mp3_44100_64";

/**
 * The cast: one voice per Chog, designed for Chog Calls with ElevenLabs Voice Design (Hype keeps the
 * designed voice the owner picked by ear), and how each one reads. `search` finds a Voice Library
 * actor for `add`; designed voices are already in the account. `tag` is the v3
 * delivery direction put in front of every line (never shown in a caption). src/lib/voices.ts uses
 * the same ids for the live voice; a test keeps them in step.
 */
export const CAST = {
  "told-you-so": { id: "Ezv7oEExKYR4iAlFMxvu", name: "Chog Calls · Told-You-So (designed)", search: "", env: "ELEVENLABS_VOICE_TOLD_YOU_SO", tag: "[sarcastic]", speed: 1 },
  hype: { id: "JruntGucHH6FHyuMuzQT", name: "Chog Alive · Professor 5 (designed, picked by ear)", search: "", env: "ELEVENLABS_VOICE_HYPE", tag: "[excited]", speed: 1.05 },
  professor: { id: "VwaY9zBh150YTqGgTi3x", name: "Chog Calls · Professor (designed)", search: "", env: "ELEVENLABS_VOICE_PROFESSOR", tag: "[curious]", speed: 1 },
  gremlin: { id: "ADQ6uSl7OYQvRQ456HCI", name: "Chog Calls · Gremlin (designed)", search: "", env: "ELEVENLABS_VOICE_GREMLIN", tag: "[mischievously]", speed: 1.05 },
  "soap-star": { id: "UsoclPKiy2PMyerPlpcD", name: "Chog Calls · Soap-Star (designed)", search: "", env: "ELEVENLABS_VOICE_SOAP", tag: "", speed: 0.95 },
  "night-shift": { id: "DLUpsHuogbRTUoAc98Yj", name: "Chog Calls · Night-Shift (designed)", search: "", env: "ELEVENLABS_VOICE_NIGHT", tag: "", speed: 0.95 },
  golden: { id: "F3QAMxsbr3b8kW4eszE9", name: "Chog Calls · Golden (designed)", search: "", env: "ELEVENLABS_VOICE_GOLDEN", tag: "[excited]", speed: 1.05 },
  roommate: { id: "hBgQI63fAZFuLN8Kcsvl", name: "Chog Calls · Roommate (designed)", search: "", env: "ELEVENLABS_VOICE_ROOMMATE", tag: "", speed: 1 },
  legend: { id: "kj110hpeFgnI2NzYoqEm", name: "Chog Calls · Legend (designed)", search: "", env: "ELEVENLABS_VOICE_LEGEND", tag: "", speed: 0.95 },
};

/** The joke lists a Chog says out loud. Ring captions, calendar bubbles and callbacks (slots) are not recorded. */
export function voicedLines(bank) {
  const lists = [
    bank.intro,
    bank.wake,
    bank.snooze,
    bank.voicemail,
    bank.absence,
    bank.owner,
    bank.stranger,
    bank.now,
    ...Object.values(bank.time ?? {}),
    ...Object.values(bank.days ?? {}),
    ...Object.values(bank.weather ?? {}),
    ...Object.values(bank.events ?? {}).flatMap((block) => [block.ahead, block.soon]),
    ...Object.values(bank.pokes ?? {}).flatMap((zone) => Object.values(zone)),
  ];
  const lines = lists.flat().filter((text) => typeof text === "string" && recordable(text));
  return [...new Set(lines)];
}

function loadBanks(only) {
  return Object.keys(CAST)
    .filter((archetype) => !only.length || only.includes(archetype))
    .map((archetype) => ({ archetype, bank: JSON.parse(fs.readFileSync(path.join(JOKES, `${archetype}.json`), "utf8")) }));
}

function voiceOf(archetype) {
  const override = process.env[CAST[archetype].env]?.trim();
  return override && /^[A-Za-z0-9]{10,40}$/.test(override) ? override : CAST[archetype].id;
}

function keyOrExit() {
  const envFile = path.join(ROOT, ".env.local");
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
  const key = process.env.ELEVENLABS_API_KEY?.trim();
  if (!key) {
    console.error("ELEVENLABS_API_KEY is not set in .env.local");
    process.exit(1);
  }
  return key;
}

async function api(key, route, init = {}) {
  const res = await fetch(`${API}${route}`, { ...init, headers: { "xi-api-key": key, "content-type": "application/json", ...(init.headers ?? {}) } });
  return res;
}

async function usage(key) {
  const res = await api(key, "/user/subscription");
  if (!res.ok) return null;
  const data = await res.json();
  return { used: data.character_count, limit: data.character_limit };
}

/** Rebuilds the list from the clips on disk that a joke file still says. */
function writeList() {
  const list = {};
  for (const { archetype, bank } of loadBanks([])) {
    const dir = path.join(OUT, archetype);
    const keys = voicedLines(bank)
      .map((text) => clipKey(archetype, text))
      .filter((key) => fs.existsSync(path.join(dir, `${key}.mp3`)));
    list[archetype] = [...new Set(keys)].sort();
  }
  fs.writeFileSync(LIST, `${JSON.stringify(list, null, 2)}\n`);
  return list;
}

function plan() {
  let lines = 0;
  let chars = 0;
  for (const { archetype, bank } of loadBanks([])) {
    const voiced = voicedLines(bank);
    const missing = voiced.filter((text) => !fs.existsSync(path.join(OUT, archetype, `${clipKey(archetype, text)}.mp3`)));
    const cost = missing.reduce((sum, text) => sum + `${CAST[archetype].tag} ${spokenText(text)}`.trim().length, 0);
    console.log(`${archetype.padEnd(12)} ${String(voiced.length).padStart(4)} voiced lines, ${String(missing.length).padStart(4)} to record, ${cost} characters`);
    lines += missing.length;
    chars += cost;
  }
  console.log(`total: ${lines} clips to record, about ${chars} characters (${MODEL}, 1 credit per character)`);
}

async function add() {
  const key = keyOrExit();
  const listed = await api(key, "/voices");
  if (!listed.ok) {
    console.error(`could not list the account's voices (${listed.status})`);
    process.exit(1);
  }
  const have = new Set(((await listed.json()).voices ?? []).map((voice) => voice.voice_id));
  for (const [archetype, cast] of Object.entries(CAST)) {
    const id = voiceOf(archetype);
    if (have.has(id)) {
      console.log(`${archetype}: ${cast.name} is in the account already`);
      continue;
    }
    const found = await api(key, `/shared-voices?page_size=50&search=${encodeURIComponent(cast.search)}`);
    if (!found.ok) {
      console.log(`${archetype}: library search failed (${found.status})`);
      continue;
    }
    const match = (await found.json()).voices?.find((voice) => voice.voice_id === id);
    if (!match) {
      console.log(`${archetype}: ${cast.name} (${id}) not found in the library search "${cast.search}"`);
      continue;
    }
    const res = await api(key, `/voices/add/${match.public_owner_id}/${id}`, { method: "POST", body: JSON.stringify({ new_name: `Chog Calls · ${cast.name}` }) });
    console.log(`${archetype}: ${res.ok ? "added" : `could not add (${res.status} ${(await res.text()).slice(0, 160)})`} ${cast.name}`);
  }
}

async function record(key, archetype, text) {
  const cast = CAST[archetype];
  const file = path.join(OUT, archetype, `${clipKey(archetype, text)}.mp3`);
  if (fs.existsSync(file)) return { file, chars: 0, skipped: true };
  const said = `${cast.tag} ${spokenText(text)}`.trim();
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await api(key, `/text-to-speech/${voiceOf(archetype)}?output_format=${FORMAT}`, {
      method: "POST",
      headers: { accept: "audio/mpeg" },
      body: JSON.stringify({ text: said, model_id: MODEL, voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: cast.speed } }),
    });
    if (res.ok) {
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length < 2000) throw new Error(`${archetype}: a clip of ${bytes.length} bytes for "${text}"`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, bytes);
      return { file, chars: said.length, skipped: false };
    }
    const body = (await res.text()).slice(0, 200);
    if (res.status === 429 || res.status >= 500) {
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
      continue;
    }
    throw new Error(`${archetype}: ${res.status} ${body}`);
  }
  throw new Error(`${archetype}: gave up after retries on "${text}"`);
}

async function render(args) {
  const key = keyOrExit();
  const limitAt = args.indexOf("--limit");
  const limit = limitAt === -1 ? Infinity : Number(args[limitAt + 1]);
  const only = args.filter((arg, i) => !arg.startsWith("--") && args[i - 1] !== "--limit");
  const before = await usage(key);
  const jobs = loadBanks(only).flatMap(({ archetype, bank }) => voicedLines(bank).slice(0, limit).map((text) => ({ archetype, text })));
  let done = 0;
  let chars = 0;
  const failures = [];
  const worker = async () => {
    for (;;) {
      const job = jobs.shift();
      if (!job) return;
      try {
        const result = await record(key, job.archetype, job.text);
        chars += result.chars;
        done += result.skipped ? 0 : 1;
        if (!result.skipped && done % 25 === 0) console.log(`${done} recorded, ${chars} characters`);
      } catch (error) {
        failures.push(String(error.message ?? error));
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  const list = writeList();
  const after = await usage(key);
  console.log(`recorded ${done} clips, ${chars} characters sent`);
  if (before && after) console.log(`account: ${after.used - before.used} characters used by this run, ${after.limit - after.used} left this month`);
  console.log(Object.entries(list).map(([archetype, keys]) => `${archetype}: ${keys.length}`).join(", "));
  if (failures.length) {
    console.log(`${failures.length} failed:`);
    for (const failure of failures.slice(0, 20)) console.log(`  - ${failure}`);
    process.exitCode = 1;
  }
}

function prune() {
  let removed = 0;
  for (const { archetype, bank } of loadBanks([])) {
    const keep = new Set(voicedLines(bank).map((text) => `${clipKey(archetype, text)}.mp3`));
    const dir = path.join(OUT, archetype);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (file.endsWith(".mp3") && !keep.has(file)) {
        fs.rmSync(path.join(dir, file));
        removed += 1;
      }
    }
  }
  writeList();
  console.log(`removed ${removed} clips no joke file says any more`);
}

/** What the connection is asked to say for one clip: the delivery tag, then the line without {Name}. */
export function sayFor(archetype, text) {
  return `${CAST[archetype].tag} ${spokenText(text)}`.trim();
}

/** Writes the clips still to record, one job file per Chog, and an empty folder per clip (the connection names its own files). */
function jobs([dir, ...only]) {
  if (!dir) throw new Error("jobs needs a folder");
  let total = 0;
  for (const { archetype, bank } of loadBanks(only)) {
    const list = voicedLines(bank)
      .map((text) => ({ key: clipKey(archetype, text), text: sayFor(archetype, text) }))
      .filter((job) => !fs.existsSync(path.join(OUT, archetype, `${job.key}.mp3`)))
      .map((job) => ({ ...job, dir: path.join(dir, archetype, job.key).replaceAll("\\", "/") }));
    for (const job of list) fs.mkdirSync(job.dir, { recursive: true });
    const cast = CAST[archetype];
    fs.writeFileSync(
      path.join(dir, `${archetype}.jobs.json`),
      `${JSON.stringify({ archetype, voice_id: voiceOf(archetype), model_id: MODEL, output_format: FORMAT, stability: 0.5, similarity_boost: 0.75, speed: cast.speed, jobs: list }, null, 2)}\n`,
    );
    console.log(`${archetype}: ${list.length} clips to record`);
    total += list.length;
  }
  console.log(`total: ${total}`);
}

/** Brings recorded clips in: the newest mp3 in each clip's folder becomes public/voice/<archetype>/<key>.mp3. */
function collect([dir, ...only]) {
  if (!dir) throw new Error("collect needs a folder");
  const report = [];
  for (const { archetype, bank } of loadBanks(only)) {
    const keys = new Set(voicedLines(bank).map((text) => clipKey(archetype, text)));
    const base = path.join(dir, archetype);
    if (!fs.existsSync(base)) continue;
    let moved = 0;
    const empty = [];
    for (const key of fs.readdirSync(base)) {
      const folder = path.join(base, key);
      if (!keys.has(key) || !fs.statSync(folder).isDirectory()) continue;
      const takes = fs
        .readdirSync(folder)
        .filter((file) => file.endsWith(".mp3"))
        .map((file) => path.join(folder, file))
        .filter((file) => fs.statSync(file).size > 2000)
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
      if (!takes.length) {
        empty.push(key);
        continue;
      }
      fs.mkdirSync(path.join(OUT, archetype), { recursive: true });
      fs.copyFileSync(takes[0], path.join(OUT, archetype, `${key}.mp3`));
      fs.rmSync(folder, { recursive: true, force: true });
      moved += 1;
    }
    report.push(`${archetype}: ${moved} brought in${empty.length ? `, ${empty.length} still empty` : ""}`);
  }
  const list = writeList();
  console.log(report.join("\n"));
  console.log(Object.entries(list).map(([archetype, keys]) => `${archetype}: ${keys.length}`).join(", "));
}

async function main([command, ...args]) {
  if (command === "plan") return plan();
  if (command === "add") return add();
  if (command === "render") return render(args);
  if (command === "prune") return prune();
  if (command === "jobs") return jobs(args);
  if (command === "collect") return collect(args);
  console.log("usage: node scripts/voice-studio.mjs plan | add | render [archetype ...] [--limit N] | prune | jobs <dir> | collect <dir>");
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main(process.argv.slice(2));
