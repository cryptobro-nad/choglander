import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IP_TTS_DAILY_LIMIT, TTS_DAILY_LIMIT } from "@/lib/limits";
import type { LineContext } from "@/lib/types";
import { voiceFor } from "@/lib/voices";
import { cachedClip, clipHash, createSpeech, peekClip, resetSpeechState, spendClip } from "@/server/speech";
import { handleVoice, parseRange, resetVoiceFlights, voicePreflight } from "@/server/voice";
import { signVoiceToken, verifyVoiceToken, VOICE_TOKEN_TTL_MS, voiceSecret } from "@/server/voiceToken";

const VOICE = voiceFor("told-you-so").id;
const DEVICE = "device-12345678";
const IP = "203.0.113.9";
const NOW = Date.parse("2026-10-18T09:00:00Z");

let dir: string;
let fetchMock: ReturnType<typeof vi.fn>;

function liveEnv(extra: Record<string, string> = {}): Record<string, string> {
  return { NODE_ENV: "production", CHOG_USE_LIVE: "1", ELEVENLABS_API_KEY: "xi-test-key", CHOG_DATA_DIR: dir, ...extra };
}

function ticket(text: string, env: Record<string, string>, fields: { device?: string; model?: string; now?: number } = {}) {
  const token = signVoiceToken(
    { text, voiceId: VOICE, model: fields.model ?? "eleven_v3", device: fields.device ?? DEVICE },
    env,
    fields.now ?? Date.now(),
  );
  if (!token) throw new Error("no secret");
  return token;
}

function get(token: string, headers: Record<string, string> = {}, method = "GET") {
  return new Request(`http://localhost/api/voice?t=${token}`, { method, headers: { origin: "https://localhost", "x-real-ip": IP, ...headers } });
}

const bytes = (text: string) => new TextEncoder().encode(text);

/** ElevenLabs' stream: each chunk in turn, then closes. */
function upstream(chunks: string[]) {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(bytes(chunks[i++]));
      else controller.close();
    },
  });
}

/** A stream that sends its first chunk, then waits for `release()` before the rest. */
function gated(first: string, rest: string) {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let step = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (step++ === 0) {
        controller.enqueue(bytes(first));
        return;
      }
      await gate;
      controller.enqueue(bytes(rest));
      controller.close();
    },
  });
  return { stream, release: () => release() };
}

function audioResponse(body: ReadableStream<Uint8Array>) {
  return new Response(body, { status: 200, headers: { "content-type": "audio/mpeg" } });
}

function hangUntilAbort(_url: unknown, init?: RequestInit) {
  return new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  });
}

async function text(res: Response) {
  return new TextDecoder().decode(await res.arrayBuffer());
}

const elevenCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).includes("api.elevenlabs.io"));

beforeEach(() => {
  resetSpeechState();
  resetVoiceFlights();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "chog-voice-"));
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("voice tickets", () => {
  it("round-trips a signed ticket", () => {
    const env = liveEnv();
    const token = ticket("[sarcastic] Standup at half past nine.", env, { now: NOW });
    const check = verifyVoiceToken(token, env, NOW + 1000);
    expect(check).toEqual({
      ok: true,
      payload: { text: "[sarcastic] Standup at half past nine.", voiceId: VOICE, model: "eleven_v3", device: DEVICE, exp: NOW + VOICE_TOKEN_TTL_MS },
    });
  });

  it("refuses a forged signature or a rewritten payload", () => {
    const env = liveEnv();
    const token = ticket("Standup at half past nine.", env, { now: NOW });
    const [body, sig] = token.split(".");
    const flipped = `${body}.${sig.slice(0, -2)}${sig.endsWith("AA") ? "BB" : "AA"}`;
    expect(verifyVoiceToken(flipped, env, NOW)).toEqual({ ok: false, reason: "signature" });
    // Same signature, different words: the classic "make it say anything" forgery.
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    const rewritten = Buffer.from(JSON.stringify({ ...payload, text: "Anything I like, on your credits." })).toString("base64url");
    expect(verifyVoiceToken(`${rewritten}.${sig}`, env, NOW)).toEqual({ ok: false, reason: "signature" });
    // A ticket signed with another secret is no good here.
    const other = ticket("Standup at half past nine.", liveEnv({ CHOG_VOICE_SECRET: "someone-elses-secret-0123456789abcdef" }), { now: NOW });
    expect(verifyVoiceToken(other, env, NOW)).toEqual({ ok: false, reason: "signature" });
  });

  it("refuses an expired ticket, and one dated too far ahead", () => {
    const env = liveEnv();
    const token = ticket("Standup at half past nine.", env, { now: NOW });
    expect(verifyVoiceToken(token, env, NOW + VOICE_TOKEN_TTL_MS - 1).ok).toBe(true);
    expect(verifyVoiceToken(token, env, NOW + VOICE_TOKEN_TTL_MS)).toEqual({ ok: false, reason: "expired" });
    expect(verifyVoiceToken(token, env, NOW - 2 * 60_000)).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses junk, and has nothing to verify with when no secret is set", () => {
    const env = liveEnv();
    for (const junk of [null, "", "abc", "a.b.c", "!!.??", `${"a".repeat(5000)}.b`]) {
      expect(verifyVoiceToken(junk, env, NOW)).toEqual({ ok: false, reason: "malformed" });
    }
    expect(signVoiceToken({ text: "Hi there.", voiceId: VOICE, model: "eleven_v3", device: DEVICE }, { NODE_ENV: "production" })).toBeNull();
    expect(verifyVoiceToken("a.b", { NODE_ENV: "production" })).toEqual({ ok: false, reason: "unconfigured" });
  });

  it("prefers CHOG_VOICE_SECRET and never exposes the API key", () => {
    const own = voiceSecret({ CHOG_VOICE_SECRET: "a-long-random-voice-secret-0123456789", ELEVENLABS_API_KEY: "xi-test-key" });
    expect(own?.toString("utf8")).toBe("a-long-random-voice-secret-0123456789");
    const derived = voiceSecret({ ELEVENLABS_API_KEY: "xi-test-key" });
    expect(derived?.length).toBe(32);
    expect(derived?.toString("utf8")).not.toContain("xi-test-key");
    const token = ticket("Standup at half past nine.", liveEnv());
    expect(Buffer.from(token.split(".")[0], "base64url").toString("utf8")).not.toContain("xi-test-key");
  });
});

describe("GET /api/voice", () => {
  it("pipes ElevenLabs' stream straight through as audio/mpeg, with the app's CORS headers", async () => {
    const env = liveEnv();
    fetchMock.mockResolvedValue(audioResponse(upstream(["ID3", "-frame-1", "-frame-2"])));
    const res = await handleVoice(get(ticket("[sarcastic] Standup at half past nine.", env)), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(res.headers.get("access-control-allow-origin")).toBe("https://localhost");
    expect(res.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS");
    expect(res.headers.get("access-control-expose-headers")).toContain("Content-Range");
    expect(res.headers.get("vary")).toBe("Origin");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await text(res)).toBe("ID3-frame-1-frame-2");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}/stream?output_format=mp3_44100_128`);
    expect(init.headers["xi-api-key"]).toBe("xi-test-key");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const sent = JSON.parse(init.body as string);
    expect(sent).toEqual({
      text: "[sarcastic] Standup at half past nine.",
      model_id: "eleven_v3",
      voice_settings: { stability: 0, style: 0.7, use_speaker_boost: true },
    });
  });

  it("answers with the first chunk before ElevenLabs has finished the clip", async () => {
    const env = liveEnv();
    const { stream, release } = gated("first-words", "-rest-of-line");
    fetchMock.mockResolvedValue(audioResponse(stream));
    const token = ticket("Standup at half past nine.", env);
    const res = await handleVoice(get(token), env);
    const reader = res.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe("first-words");
    // Nothing is cached until the whole clip is in.
    expect(cachedClip(clipHash(VOICE, "eleven_v3", "Standup at half past nine."), env)).toBeNull();
    release();
    let rest = "";
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      rest += new TextDecoder().decode(next.value);
    }
    expect(rest).toBe("-rest-of-line");
    expect(cachedClip(clipHash(VOICE, "eleven_v3", "Standup at half past nine."), env)?.toString()).toBe("first-words-rest-of-line");
  });

  it("serves a cached clip instantly, with ranges, without calling ElevenLabs or counting a clip", async () => {
    const env = liveEnv({ CHOG_DAILY_CLIPS: "1" });
    fetchMock.mockImplementation(async () => audioResponse(upstream(["ID3", "-whole-clip"])));
    const token = ticket("Standup at half past nine.", env);
    expect(await text(await handleVoice(get(token), env))).toBe("ID3-whole-clip");
    // The disk copy is there too, for the next instance start.
    const id = clipHash(VOICE, "eleven_v3", "Standup at half past nine.");
    expect(fs.existsSync(path.join(dir, "audio", `${id}.mp3`))).toBe(true);

    const again = await handleVoice(get(token), env);
    expect(again.status).toBe(200);
    expect(again.headers.get("content-length")).toBe(String("ID3-whole-clip".length));
    expect(again.headers.get("accept-ranges")).toBe("bytes");
    expect(again.headers.get("access-control-allow-origin")).toBe("https://localhost");
    expect(await text(again)).toBe("ID3-whole-clip");

    const part = await handleVoice(get(token, { range: "bytes=3-6" }), env);
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 3-6/${"ID3-whole-clip".length}`);
    expect(await text(part)).toBe("-who");
    expect((await handleVoice(get(token, { range: "bytes=999-" }), env)).status).toBe(416);
    // Three plays, one ElevenLabs call, and the one-clip budget was only spent once.
    expect(elevenCalls()).toHaveLength(1);
    expect((await handleVoice(get(ticket("A different line entirely.", env)), env)).status).toBe(429);
  });

  it("keeps the paid clip when the cache folder cannot be written", async () => {
    const blocker = path.join(dir, "not-a-dir");
    fs.writeFileSync(blocker, "a file where the cache folder should be");
    const env = liveEnv({ CHOG_DATA_DIR: blocker });
    fetchMock.mockImplementation(async () => audioResponse(upstream(["ID3", "-clip"])));
    const token = ticket("Standup at half past nine.", env);
    expect(await text(await handleVoice(get(token), env))).toBe("ID3-clip");
    expect(await text(await handleVoice(get(token), env))).toBe("ID3-clip");
    expect(elevenCalls()).toHaveLength(1);
  });

  it("shares one ElevenLabs call between two requests for the same clip", async () => {
    const env = liveEnv({ CHOG_DAILY_CLIPS: "1" });
    const { stream, release } = gated("ID3", "-shared");
    fetchMock.mockResolvedValue(audioResponse(stream));
    const token = ticket("Standup at half past nine.", env);
    const [a, b] = await Promise.all([handleVoice(get(token), env), handleVoice(get(token, { range: "bytes=0-1" }), env)]);
    release();
    expect(await text(a)).toBe("ID3-shared");
    expect(await text(b)).toBe("ID3-shared");
    expect(elevenCalls()).toHaveLength(1);
  });

  it("counts a new clip against the device, the IP and the deploy", async () => {
    const env = liveEnv();
    fetchMock.mockImplementation(async () => audioResponse(upstream(["ID3"])));
    for (let i = 0; i < TTS_DAILY_LIMIT; i++) expect(spendClip({ ip: IP, device: DEVICE }, env).ok).toBe(true);
    // The device is spent: its ticket is refused before any call is made.
    const refused = await handleVoice(get(ticket("Standup at half past nine.", env)), env);
    expect(refused.status).toBe(429);
    expect(refused.headers.get("access-control-allow-origin")).toBe("https://localhost");
    expect(elevenCalls()).toHaveLength(0);
    // Another device on the same IP still has room...
    const other = ticket("Standup at half past nine.", env, { device: "device-87654321" });
    expect((await handleVoice(get(other), env)).status).toBe(200);
    // ...until the IP itself is spent.
    for (let i = 0; i < IP_TTS_DAILY_LIMIT; i++) spendClip({ ip: IP, device: `device-x${String(i).padStart(7, "0")}` }, env);
    const fresh = ticket("A brand new line for the IP test.", env, { device: "device-fresh001" });
    expect((await handleVoice(get(fresh), env)).status).toBe(429);
    expect(elevenCalls()).toHaveLength(1);
  });

  it("returns 502 at once when ElevenLabs refuses, so the app can use its device voice", async () => {
    const env = liveEnv();
    fetchMock.mockResolvedValue(new Response("quota", { status: 401 }));
    const res = await handleVoice(get(ticket("Standup at half past nine.", env)), env);
    expect(res.status).toBe(502);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://localhost");
  });

  it("gives up on a first byte that takes longer than CHOG_TTS_TIMEOUT_MS", async () => {
    const env = liveEnv({ CHOG_TTS_TIMEOUT_MS: "40" });
    fetchMock.mockImplementation(hangUntilAbort);
    const started = Date.now();
    const res = await handleVoice(get(ticket("Standup at half past nine.", env)), env);
    expect(res.status).toBe(502);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("breaks the response, and caches nothing, when the clip fails half way", async () => {
    const env = liveEnv();
    let step = 0;
    const broken = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (step++ === 0) controller.enqueue(bytes("ID3-half"));
        else controller.error(new Error("connection reset"));
      },
    });
    fetchMock.mockResolvedValue(audioResponse(broken));
    const res = await handleVoice(get(ticket("Standup at half past nine.", env)), env);
    expect(res.status).toBe(200);
    await expect(res.arrayBuffer()).rejects.toThrow();
    expect(cachedClip(clipHash(VOICE, "eleven_v3", "Standup at half past nine."), env)).toBeNull();
  });

  it("drops a stream that goes quiet after its first chunk", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const env = liveEnv();
    fetchMock.mockImplementation(async (_url: unknown, init?: RequestInit) => {
      let step = 0;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
        },
        pull(controller) {
          if (step++ === 0) controller.enqueue(bytes("ID3"));
          return new Promise<void>(() => undefined);
        },
      });
      return audioResponse(stream);
    });
    const res = await handleVoice(get(ticket("Standup at half past nine.", env)), env);
    const reading = res.arrayBuffer().then(
      () => "closed",
      () => "errored",
    );
    await vi.advanceTimersByTimeAsync(6000);
    expect(await reading).toBe("errored");
  });

  it("refuses a bad or expired ticket before anything is spent", async () => {
    const env = liveEnv();
    const bad = await handleVoice(get("not-a-ticket"), env);
    expect(bad.status).toBe(403);
    expect(bad.headers.get("access-control-allow-origin")).toBe("https://localhost");
    const old = ticket("Standup at half past nine.", env, { now: Date.now() - VOICE_TOKEN_TTL_MS - 1 });
    expect((await handleVoice(get(old), env)).status).toBe(410);
    expect((await handleVoice(new Request("http://localhost/api/voice"), env)).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(peekClip({ ip: IP, device: DEVICE }, env).remaining).toBe(TTS_DAILY_LIMIT - 1);
  });

  it("is off when live voice is off", async () => {
    const env = { ...liveEnv(), NODE_ENV: "test" };
    expect((await handleVoice(get(ticket("Standup at half past nine.", env)), env)).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never spends a clip on a HEAD", async () => {
    const env = liveEnv();
    const res = await handleVoice(get(ticket("Standup at half past nine.", env), {}, "HEAD"), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(peekClip({ ip: IP, device: DEVICE }, env).remaining).toBe(TTS_DAILY_LIMIT - 1);
  });

  it("answers the app's preflight and no one else's", () => {
    const ok = voicePreflight(new Request("http://localhost/api/voice", { method: "OPTIONS", headers: { origin: "capacitor://localhost" } }), {});
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe("capacitor://localhost");
    expect(ok.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS");
    const no = voicePreflight(new Request("http://localhost/api/voice", { method: "OPTIONS", headers: { origin: "https://evil.example" } }), {});
    expect(no.status).toBe(403);
    expect(no.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("sends no allow-origin to a page that is not the app", async () => {
    const env = liveEnv();
    fetchMock.mockResolvedValue(audioResponse(upstream(["ID3"])));
    const res = await handleVoice(get(ticket("Standup at half past nine.", env), { origin: "https://evil.example" }), env);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("byte ranges", () => {
  it("reads one range and refuses anything out of bounds", () => {
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange("bytes=0-", 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=10-19", 100)).toEqual({ start: 10, end: 19 });
    expect(parseRange("bytes=90-500", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=0-1,5-6", 100)).toBeNull();
    expect(parseRange("bytes=100-", 100)).toBe("bad");
    expect(parseRange("bytes=20-10", 100)).toBe("bad");
  });
});

describe("/api/speak to /api/voice", () => {
  const ctx: LineContext = {
    name: "Alex",
    artId: 375,
    archetype: "told-you-so",
    traits: [],
    intent: "morning",
    phase: "morning",
    weekday: "Saturday",
    clock: "7:12 am",
    spokenClock: "quarter past seven",
    weather: null,
    nextEvent: { title: "Standup", when: "half past nine", minutesUntil: 40 },
    pastEvent: null,
    memory: [],
    streak: 1,
    nonce: 1,
    recentIds: [],
  };

  it("plays exactly the line /api/speak wrote, tags and all", async () => {
    const env = liveEnv();
    const line = await createSpeech(ctx, { ip: IP, device: DEVICE }, env);
    expect(line.engine).toBe("elevenlabs");
    expect(elevenCalls()).toHaveLength(0);
    fetchMock.mockResolvedValue(audioResponse(upstream(["ID3"])));
    const res = await handleVoice(new Request(`http://localhost${line.audioUrl}`, { headers: { "x-real-ip": IP } }), env);
    expect(res.status).toBe(200);
    expect(await text(res)).toBe("ID3");
    expect(JSON.parse(elevenCalls()[0][1].body as string).text).toBe(line.text);
    // The next identical line is a cache hit: still offered, and free.
    const again = await createSpeech(ctx, { ip: IP, device: DEVICE }, env);
    expect(again.remaining).toBeNull();
    expect(again.audioUrl).toMatch(/^\/api\/voice\?t=/);
  });
});
