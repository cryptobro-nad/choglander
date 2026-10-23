import { clientIp } from "@/lib/limits";
import { corsHeaders, preflight } from "@/server/cors";
import { cachedClip, clipHash, liveEnabled, saveClip, spendClip, timeoutMs, TTS_TIMEOUT_MS, voiceSettings } from "@/server/speech";
import { verifyVoiceToken, type VoicePayload } from "@/server/voiceToken";

// GET /api/voice?t=<ticket>: one ElevenLabs clip, streamed as it is generated.
//
// Order: the ticket (signature, then expiry); a finished clip from this instance's cache, free and
// instant; a clip already streaming on this instance, joined and replayed from its first byte, free;
// otherwise one clip from the budgets (client, IP, deploy), then ElevenLabs' streaming endpoint
// piped straight through as audio/mpeg and kept in the cache once it has fully arrived.

type Env = Record<string, string | undefined>;

/** A stream that goes quiet this long after its first byte is dropped. */
const STREAM_STALL_MS = 5000;
/** The longest any one clip may take to arrive (a 320-character line is well under 30 s of audio). */
const STREAM_MAX_MS = 25_000;
const OUTPUT_FORMAT = "mp3_44100_128";

type Flight = {
  chunks: Uint8Array[];
  state: "pending" | "streaming" | "done" | "failed";
  /** True at the first byte, false when the clip failed before any arrived. */
  ready: Promise<boolean>;
  /** Settles when the upstream is finished one way or the other (and the cache is written). */
  finished: Promise<void>;
  waiters: Set<() => void>;
};

const flights = new Map<string, Flight>();

/** Forgets clips still on their way. For tests. */
export function resetVoiceFlights() {
  flights.clear();
}

/**
 * Reads ElevenLabs' streaming endpoint, handing each chunk to `onChunk`. True when the whole clip
 * arrived. The first byte must come within CHOG_TTS_TIMEOUT_MS (the app gives up on audio at 4 s),
 * then no gap may pass STREAM_STALL_MS and the whole clip must be in by STREAM_MAX_MS.
 */
async function pumpEleven(payload: VoicePayload, env: Env, onChunk: (chunk: Uint8Array) => void): Promise<boolean> {
  const key = env.ELEVENLABS_API_KEY;
  if (!key) return false;
  const controller = new AbortController();
  let idle = setTimeout(() => controller.abort(), timeoutMs(env, "CHOG_TTS_TIMEOUT_MS", TTS_TIMEOUT_MS));
  const cap = setTimeout(() => controller.abort(), STREAM_MAX_MS);
  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(payload.voiceId)}/stream?output_format=${OUTPUT_FORMAT}`,
      {
        method: "POST",
        headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({ text: payload.text, model_id: payload.model, voice_settings: voiceSettings(payload.model) }),
        signal: controller.signal,
      },
    );
    if (!res.ok || !res.body) {
      await res.body?.cancel().catch(() => undefined);
      return false;
    }
    const reader = res.body.getReader();
    let got = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return got;
      if (!value?.byteLength) continue;
      got = true;
      clearTimeout(idle);
      idle = setTimeout(() => controller.abort(), STREAM_STALL_MS);
      onChunk(value);
    }
  } catch {
    return false;
  } finally {
    clearTimeout(idle);
    clearTimeout(cap);
  }
}

function startFlight(id: string, payload: VoicePayload, env: Env): Flight {
  let markReady: (ok: boolean) => void = () => undefined;
  const flight: Flight = {
    chunks: [],
    state: "pending",
    ready: new Promise<boolean>((resolve) => {
      markReady = resolve;
    }),
    finished: Promise.resolve(),
    waiters: new Set(),
  };
  const wake = () => {
    const waiting = [...flight.waiters];
    flight.waiters.clear();
    for (const resolve of waiting) resolve();
  };
  flights.set(id, flight);
  flight.finished = pumpEleven(payload, env, (chunk) => {
    flight.chunks.push(chunk);
    if (flight.state === "pending") {
      flight.state = "streaming";
      markReady(true);
    }
    wake();
  }).then((whole) => {
    // Cache first, then forget the flight: a request in between always finds one or the other.
    if (whole && flight.chunks.length) {
      saveClip(id, Buffer.concat(flight.chunks), env);
      flight.state = "done";
    } else {
      flight.state = "failed";
    }
    flights.delete(id);
    markReady(flight.state === "done");
    wake();
  });
  return flight;
}

/**
 * One listener's copy of a clip in flight: every chunk so far, then each new one as it lands. A clip
 * that breaks mid-way errors the stream (a network error to the browser, never a short "complete" clip).
 */
function listen(flight: Flight): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        if (index < flight.chunks.length) {
          controller.enqueue(flight.chunks[index++]);
          return;
        }
        if (flight.state === "done") {
          controller.close();
          return;
        }
        if (flight.state === "failed") {
          controller.error(new Error("voice stream failed"));
          return;
        }
        await new Promise<void>((resolve) => flight.waiters.add(resolve));
      }
    },
  });
}

/** A single "bytes=a-b" range of `size`, null for none (or anything fancier), "bad" when out of bounds. */
export function parseRange(header: string | null, size: number): { start: number; end: number } | "bad" | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec((header || "").trim());
  if (!match || (!match[1] && !match[2])) return null;
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (suffix <= 0) return "bad";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  }
  if (start >= size || end < start) return "bad";
  return { start, end };
}

const AUDIO_HEADERS = { "Content-Type": "audio/mpeg", "X-Content-Type-Options": "nosniff" };

/** A finished clip, with byte ranges so the browser can seek it. */
function clipResponse(buf: Buffer, request: Request, cors: Record<string, string>, head: boolean): Response {
  const headers: Record<string, string> = {
    ...cors,
    ...AUDIO_HEADERS,
    "Accept-Ranges": "bytes",
    // The ticket in the URL dies in ten minutes; this copy lives in the browser alone.
    "Cache-Control": "private, max-age=600",
  };
  const range = parseRange(request.headers.get("range"), buf.length);
  if (range === "bad") return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${buf.length}` } });
  if (range) {
    const part = buf.subarray(range.start, range.end + 1);
    return new Response(head ? null : new Uint8Array(part), {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${range.start}-${range.end}/${buf.length}`, "Content-Length": String(part.length) },
    });
  }
  return new Response(head ? null : new Uint8Array(buf), { status: 200, headers: { ...headers, "Content-Length": String(buf.length) } });
}

export type VoiceOptions = {
  /** Keeps the instance alive until a clip has fully arrived, even if the listener hung up (Next's `after`). */
  keepAlive?: (work: Promise<unknown>) => void;
  now?: number;
};

/** GET (or HEAD, which never spends) for one ticket. Every answer carries the app's CORS headers. */
export async function handleVoice(request: Request, env: Env = process.env, opts: VoiceOptions = {}): Promise<Response> {
  const cors = corsHeaders(request.headers.get("origin"), env, "GET");
  const fail = (status: number, message: string) =>
    new Response(message, { status, headers: { ...cors, "Content-Type": "text/plain", "Cache-Control": "no-store" } });
  const head = request.method === "HEAD";
  const check = verifyVoiceToken(new URL(request.url).searchParams.get("t"), env, opts.now);
  if (!check.ok) return check.reason === "expired" ? fail(410, "Expired") : fail(403, "Forbidden");
  if (!liveEnabled(env) || !env.ELEVENLABS_API_KEY) return fail(503, "Voice is off");
  const { payload } = check;
  const id = clipHash(payload.voiceId, payload.model, payload.text);

  const cached = cachedClip(id, env);
  if (cached) return clipResponse(cached, request, cors, head);

  const streamHeaders = { ...cors, ...AUDIO_HEADERS, "Accept-Ranges": "none", "Cache-Control": "no-store" };
  if (head) return new Response(null, { status: 200, headers: streamHeaders });

  let flight = flights.get(id);
  if (!flight) {
    const slot = spendClip({ ip: clientIp(request.headers), device: payload.device }, env);
    if (!slot.ok) return fail(429, "Out of clips for today");
    flight = startFlight(id, payload, env);
    try {
      opts.keepAlive?.(flight.finished);
    } catch {
      /* no request scope (tests): the clip still finishes while this instance runs */
    }
  }
  // Waits at most CHOG_TTS_TIMEOUT_MS for the first byte, so a dead upstream is an error the app can
  // act on (its device voice) instead of a silent open stream.
  if (!(await flight.ready)) return fail(502, "Voice unavailable");
  return new Response(listen(flight), { status: 200, headers: streamHeaders });
}

export function voicePreflight(request: Request, env: Env = process.env): Response {
  return preflight(request, env, "GET");
}
