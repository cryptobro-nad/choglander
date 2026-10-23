import { isNative, nativeSpeak, stopNativeSpeaking } from "@/lib/native";
import type { Archetype, LineContext } from "@/lib/types";
import { VOICES, stripAudioTags } from "@/lib/voices";
import { clipForCaption, composeLine } from "@/lib/writer";

// Client playback: the server's ElevenLabs clip, else the device voice (Web Speech in a browser,
// Android TextToSpeech in the APK). Fallback never downloads an extra voice model. If the server
// is slow or absent, the same hand-written bank runs here, so a line is never lost.
//
// The server answers with the caption at once and a signed /api/voice URL for the clip. The audio
// element streams that URL as ElevenLabs generates it, so the first word is heard well before the
// clip is finished. A clip that errors or sends nothing for AUDIO_START_MS goes to the device voice.

/** `names`: whether the line said the next event by name (unknown for a line the server wrote). */
export type Spoken = { caption: string; id: string; engine: string; playback: Promise<void>; names?: boolean };

/** How long the line (the caption, not the audio) may take to arrive. The bank is instant. */
export const SPEAK_TIMEOUT_MS = 4000;
/** How long a clip may take to start playing before the line goes to the device voice. */
export const AUDIO_START_MS = 4000;
/** How long a clip that has started may sit with no progress before the call moves on. */
export const AUDIO_STALL_MS = 4000;
const AUDIO_MAX_MS = 30_000;
const VOICES_WAIT_MS = 1500;

type ServerLine = { caption: string; id: string; engine: string; audioUrl: string | null };

// Bumped by stopSpeech, so a line still on its way when the call ends never starts talking.
let generation = 0;

function apiOrigin(): string {
  return (process.env.NEXT_PUBLIC_CHOG_API_ORIGIN ?? "").replace(/\/+$/, "");
}

function playableUrl(url: unknown, origin: string): string | null {
  if (typeof url !== "string" || !url) return null;
  if (url.startsWith("data:audio/") || url.startsWith("blob:")) return url;
  // Only our own voice route, and only on the API origin the app was built for.
  if (/^\/api\/voice\?t=[A-Za-z0-9_.-]+$/.test(url)) return `${origin}${url}`;
  return null;
}

let liveCheck: Promise<boolean> | null = null;

/**
 * Whether the server can say a line it writes in the Chog's own ElevenLabs voice (it has the key).
 * Asked once per page; false offline, on timeout, or in an APK built without a server.
 */
export function liveVoiceAvailable(): Promise<boolean> {
  liveCheck ??= (async () => {
    const origin = apiOrigin();
    if (!origin && isNative()) return false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const res = await fetch(`${origin}/api/live`, { signal: controller.signal });
      if (!res.ok) return false;
      const data = (await res.json()) as { voice?: unknown } | null;
      return data?.voice === true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  })();
  return liveCheck;
}

/**
 * Asks the server for a line. Null on timeout, error, or in the APK when no API origin was built in
 * (the static bundle has no /api). The timer is a plain AbortController so older WebViews work too.
 */
export async function fetchLine(
  ctx: LineContext,
  deviceId: string,
  timeoutMs = SPEAK_TIMEOUT_MS,
  voice = true,
): Promise<ServerLine | null> {
  const origin = apiOrigin();
  if (!origin && isNative()) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${origin}/api/speak`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-chog-device": deviceId },
      // voice: false tells the server not to spend a clip on a muted app.
      body: JSON.stringify({ context: ctx, voice }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<ServerLine> | null;
    if (!data || typeof data.caption !== "string" || !data.caption.trim()) return null;
    return {
      caption: data.caption,
      id: typeof data.id === "string" && data.id ? data.id : "local",
      engine: typeof data.engine === "string" && data.engine ? data.engine : "local",
      audioUrl: playableUrl(data.audioUrl, origin),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---- Device voice --------------------------------------------------------------------------------

type VoiceLike = Pick<SpeechSynthesisVoice, "name" | "lang" | "default" | "voiceURI">;

// macOS and iOS ship joke voices; old engines ship robots. Neither belongs in a premium app.
const NOVELTY = /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|hysterical|jester|organ|superstar|trinoids|whisper|wobble|zarvox)\b/i;
const ROBOTIC = /\b(junior|ralph|fred|kathy|princess|espeak|robot)\b/i;
const KNOWN_GOOD = /\b(samantha|ava|allison|aria|jenny|guy|zoe|evan|nathan|joelle|nicky|susan|michelle|emma|brian|andrew)\b/i;

/** How well a voice suits the Chog: English, American, natural or neural, never a novelty voice. Below 0 means never. */
export function scoreVoice(voice: VoiceLike): number {
  const lang = (voice.lang || "").replace("_", "-").toLowerCase();
  if (!lang.startsWith("en")) return -1;
  const name = voice.name || "";
  let score = lang === "en-us" ? 40 : lang.startsWith("en-") ? 20 : 10;
  if (/natural|neural/i.test(name)) score += 35;
  if (/premium|enhanced/i.test(name)) score += 30;
  if (/google us english/i.test(name)) score += 28;
  if (/online/i.test(name)) score += 6;
  if (KNOWN_GOOD.test(name)) score += 12;
  if (voice.default) score += 4;
  if (NOVELTY.test(name)) score -= 100;
  if (ROBOTIC.test(name)) score -= 30;
  return score;
}

/** The best voice in the list, the same one every time for the same list. */
export function pickVoice<T extends VoiceLike>(voices: readonly T[]): T | null {
  let best: T | null = null;
  let bestScore = -1;
  for (const voice of voices) {
    const score = scoreVoice(voice);
    if (score < 0) continue;
    const key = `${voice.name}\u0000${voice.voiceURI}`;
    const bestKey = best ? `${best.name}\u0000${best.voiceURI}` : "";
    if (score > bestScore || (score === bestScore && key < bestKey)) {
      best = voice;
      bestScore = score;
    }
  }
  return best;
}

let chosen: { voice: SpeechSynthesisVoice | null } | null = null;
let voicesWait: Promise<void> | null = null;
let watching = false;
// Chrome can garbage-collect an utterance mid-line and never fire onend; hold the current one.
let speaking: SpeechSynthesisUtterance | null = null;

function watchVoices(synth: SpeechSynthesis) {
  if (watching || typeof synth.addEventListener !== "function") return;
  watching = true;
  // Chrome adds its network voices a moment after load; choose again from the fuller list.
  synth.addEventListener("voiceschanged", () => {
    chosen = null;
  });
}

/** Resolves once the voice list is there, waiting for voiceschanged at most once. */
function voicesReady(synth: SpeechSynthesis): Promise<void> {
  watchVoices(synth);
  if (synth.getVoices().length) return Promise.resolve();
  if (!voicesWait) {
    voicesWait = new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        synth.removeEventListener?.("voiceschanged", finish);
        resolve();
      };
      synth.addEventListener?.("voiceschanged", finish);
      setTimeout(finish, VOICES_WAIT_MS);
    });
  }
  return voicesWait;
}

function deviceVoiceFor(synth: SpeechSynthesis): SpeechSynthesisVoice | null {
  if (chosen) return chosen.voice;
  const list = synth.getVoices();
  if (!list.length) return null;
  chosen = { voice: pickVoice(list) };
  return chosen.voice;
}

function speechBudgetMs(text: string, rate: number): number {
  return Math.min(15_000, (1800 + text.length * 60) / Math.max(0.5, rate));
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

/** `alarm`: the wake-up line, which the APK plays on the alarm stream like the ring before it. */
async function deviceVoice(caption: string, archetype: Archetype, gen: number, alarm = false): Promise<void> {
  if (typeof window === "undefined") return;
  const text = stripAudioTags(caption);
  if (!text) return;
  const { pitch, rate } = VOICES[archetype];
  const synth = window.speechSynthesis;
  if (!synth || typeof SpeechSynthesisUtterance === "undefined") {
    // The Android WebView has no Web Speech. The shell speaks instead, so the APK is never silent.
    if (isNative()) await withTimeout(nativeSpeak(text, { pitch, rate, alarm }), speechBudgetMs(text, rate) + 2000, false);
    return;
  }
  await voicesReady(synth);
  if (gen !== generation) return;
  await new Promise<void>((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    const voice = deviceVoiceFor(synth);
    if (voice) utterance.voice = voice;
    utterance.pitch = pitch;
    utterance.rate = rate;
    utterance.volume = 1;
    let settled = false;
    // A hard stop: some engines never fire onend (Chrome after a long idle, a muted tab).
    const timer = setTimeout(() => finish(), speechBudgetMs(text, rate));
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (speaking === utterance) speaking = null;
      resolve();
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    speaking = utterance;
    try {
      if (synth.speaking || synth.pending) synth.cancel();
      synth.resume?.();
      synth.speak(utterance);
    } catch {
      finish();
    }
  });
}

// ---- Audio element ------------------------------------------------------------------------------

let ownAudio: HTMLAudioElement | null = null;

/**
 * A shared element for callers that have none of their own (the meet screen). CORS mode, so the
 * portrait's lip-sync analyser (Web Audio) can read a clip from the API origin: a cross-origin clip
 * loaded without CORS would play silent through the analyser's graph.
 */
function sharedAudio(): HTMLAudioElement | null {
  if (typeof window === "undefined" || typeof Audio === "undefined") return null;
  if (!ownAudio) {
    ownAudio = new Audio();
    ownAudio.crossOrigin = "anonymous";
    ownAudio.preload = "auto";
  }
  return ownAudio;
}

let silent: string | null = null;

/** 50 ms of silence as a WAV data URL: the muted clip that unlocks an audio element in a tap. */
export function silentWav(): string {
  if (silent) return silent;
  const rate = 8000;
  const samples = 400;
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const tag = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  tag(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, "data");
  view.setUint32(40, samples * 2, true);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  silent = `data:audio/wav;base64,${btoa(binary)}`;
  return silent;
}

// The clip that has each element now. A newer clip on the same element ends the older one's wait.
const clipOwners = new WeakMap<HTMLAudioElement, () => void>();

/**
 * Plays one clip to the end. False when it never started: the browser refused it, it errored
 * (a 4xx or 5xx from /api/voice), or no audio played within AUDIO_START_MS. The caller then says the
 * line with the device voice. Once audio has played, an error or a stall past AUDIO_STALL_MS just
 * ends the clip; the caption is on screen and repeating the line would be worse.
 */
function playClip(audio: HTMLAudioElement, url: string, gen: number): Promise<boolean> {
  if (gen !== generation) return Promise.resolve(true);
  clipOwners.get(audio)?.();
  return new Promise<boolean>((resolve) => {
    let started = false;
    let settled = false;
    let lastTime = -1;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cap = setTimeout(() => stop(true), AUDIO_MAX_MS);
    const arm = (ms: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => stop(started), ms);
    };
    const handlers: [string, () => void][] = [];
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      clearTimeout(cap);
      for (const [type, fn] of handlers) audio.removeEventListener(type, fn);
      if (clipOwners.get(audio) === overtaken) clipOwners.delete(audio);
      if (url.startsWith("blob:")) URL.revokeObjectURL(url);
      resolve(ok);
    };
    // Lets go of the element. A clip that never started is unloaded, so it cannot start late over the device voice.
    const stop = (ok: boolean) => {
      if (settled) return;
      finish(ok);
      try {
        audio.pause();
        if (!ok) {
          audio.removeAttribute("src");
          audio.load();
        }
      } catch {
        /* element gone */
      }
    };
    const overtaken = () => finish(true);
    const begin = () => {
      if (settled || started) return;
      started = true;
      lastTime = audio.currentTime;
      arm(AUDIO_STALL_MS);
    };
    // Only real playback counts: the load itself fires a timeupdate as it resets the position to 0.
    const progress = () => {
      if (!started || audio.currentTime === lastTime) return;
      lastTime = audio.currentTime;
      arm(AUDIO_STALL_MS);
    };
    handlers.push(
      ["playing", begin],
      ["timeupdate", progress],
      ["ended", () => finish(true)],
      // stopSpeech, or anything else that paused the clip on purpose.
      ["pause", () => finish(true)],
      ["error", () => stop(started)],
    );
    clipOwners.set(audio, overtaken);
    audio.crossOrigin = "anonymous";
    audio.muted = false;
    audio.src = url;
    for (const [type, fn] of handlers) audio.addEventListener(type, fn);
    arm(AUDIO_START_MS);
    let playing: Promise<void> | undefined;
    try {
      playing = audio.play();
    } catch {
      stop(false);
      return;
    }
    if (playing && typeof playing.then === "function") {
      playing.then(begin, () => stop(started));
    } else {
      begin();
    }
  });
}

async function playVoice(
  caption: string,
  archetype: Archetype,
  engine: string,
  audioUrl: string | null,
  audio: HTMLAudioElement | null,
  gen: number,
  alarm: boolean,
): Promise<string> {
  if (audio && audioUrl && (await playClip(audio, audioUrl, gen))) return engine;
  if (gen !== generation) return engine;
  await deviceVoice(caption, archetype, gen, alarm);
  return "device";
}

/** How long a caption stays up at least, so a short clip doesn't flash the line away. */
const captionHold = (caption: string) => new Promise<void>((resolve) => setTimeout(resolve, Math.min(8000, 1400 + caption.length * 42)));

/** Plays a recorded studio clip; if it can't play, the device voice says the caption instead. */
async function playStudio(url: string, caption: string, archetype: Archetype, audio: HTMLAudioElement | null, gen: number, alarm: boolean): Promise<void> {
  if (audio && (await playClip(audio, url, gen))) return;
  if (gen !== generation) return;
  await deviceVoice(caption, archetype, gen, alarm);
}

/**
 * Says a line that was already picked (a snooze), from its recorded clip when it has one. Without a
 * clip it stays a caption: the snooze screen is quiet unless the Chog has a take of the line.
 */
export function sayRecorded(clip: string | undefined, caption: string, archetype: Archetype, audio: HTMLAudioElement | null, mute: boolean): Promise<void> {
  if (!clip || mute) return Promise.resolve();
  return playStudio(clip, caption, archetype, audio ?? sharedAudio(), generation, false);
}

/** Says one more recorded line of a call, holding its caption long enough to read even when muted. */
export function sayPart(clip: string, caption: string, archetype: Archetype, audio: HTMLAudioElement | null, mute: boolean): Promise<void> {
  return Promise.all([sayRecorded(clip, caption, archetype, audio, mute), captionHold(caption)]).then(() => undefined);
}

/**
 * Says a line nobody recorded in the device voice, as a call does when its clip can't play: a shared
 * card's line, on the page its link opens. The caption is held long enough to read on a silent device.
 */
export function sayAloud(caption: string, archetype: Archetype): Promise<void> {
  return Promise.all([deviceVoice(caption, archetype, generation), captionHold(caption)]).then(() => undefined);
}

/** Shared calls use the same start/stall deadlines and cancellation as the main player. */
export function sayShared(clip: string | undefined, caption: string, archetype: Archetype, audio: HTMLAudioElement | null): Promise<void> {
  const gen = generation;
  return Promise.all([
    clip ? playStudio(clip, caption, archetype, audio, gen, false) : deviceVoice(caption, archetype, gen),
    captionHold(caption),
  ]).then(() => undefined);
}

/**
 * Fetches (or writes locally) one line and starts saying it. `playback` settles when it is done.
 * `studio`: a recorded line in the Chog's studio voice when one fits the moment, with no server
 * round trip; otherwise (or with the live voice) the server writes the line, as before.
 */
export async function speakLine(
  ctx: LineContext,
  deviceId: string,
  audio: HTMLAudioElement | null,
  mute: boolean,
  studio = false,
): Promise<Spoken> {
  const gen = generation;
  if (studio) {
    const recorded = composeLine({ ...ctx, studio: true });
    if (recorded.clip) {
      const clip = recorded.clip;
      const playback =
        mute || gen !== generation
          ? Promise.resolve()
          : Promise.all([playStudio(clip, recorded.caption, ctx.archetype, audio ?? sharedAudio(), gen, ctx.intent === "morning"), captionHold(recorded.caption)]).then(
              () => undefined,
            );
      return { caption: recorded.caption, id: recorded.id, engine: "studio", playback, names: recorded.names };
    }
  }
  const server = await fetchLine(ctx, deviceId, SPEAK_TIMEOUT_MS, !mute);
  let caption: string;
  let id: string;
  let engine: string;
  let audioUrl: string | null = null;
  let names: boolean | undefined;
  if (server) {
    ({ caption, id, engine, audioUrl } = server);
    // The server wrote words one of the Chog's recordings already says: play that take, and the live
    // voice is only spent on what is personal (a name, an event, something they told it).
    const recorded = clipForCaption(ctx.archetype, caption);
    if (recorded) {
      audioUrl = recorded;
      engine = "studio";
    }
  } else {
    const local = composeLine(ctx);
    caption = local.caption;
    id = local.id;
    names = local.names;
    engine = "local";
  }
  const playback =
    mute || gen !== generation
      ? Promise.resolve()
      : Promise.all([
          playVoice(caption, ctx.archetype, engine, audioUrl, audio ?? sharedAudio(), gen, ctx.intent === "morning"),
          captionHold(caption),
        ]).then(() => undefined);
  return { caption, id, engine, playback, names };
}

/**
 * Call synchronously inside a user tap (Begin, This one, Call, Answer, Ring in 30 s), with the same
 * audio element later passed to speakLine. Speaks a silent utterance and plays a muted clip, which
 * is what iOS Safari and Chrome need before they let a line start later without a tap.
 */
export function primeSpeech(audio?: HTMLAudioElement | null): void {
  if (typeof window === "undefined") return;
  const synth = window.speechSynthesis;
  if (synth && typeof SpeechSynthesisUtterance !== "undefined") {
    try {
      if (!synth.speaking && !synth.pending) {
        const hush = new SpeechSynthesisUtterance(" ");
        hush.volume = 0;
        hush.lang = "en-US";
        synth.speak(hush);
      }
      void voicesReady(synth);
    } catch {
      /* speech unavailable */
    }
  }
  const el = audio ?? sharedAudio();
  if (!el || !el.paused) return;
  const clip = silentWav();
  try {
    el.muted = true;
    el.src = clip;
    const restore = () => {
      // Only undo our own clip: a real line may have taken the element over already.
      if (el.src === clip) el.pause();
      el.muted = false;
    };
    const started = el.play();
    if (started && typeof started.then === "function") started.then(restore, restore);
    else restore();
  } catch {
    el.muted = false;
  }
}

/** Stops whatever is speaking (audio, Web Speech, Android TTS) and any line still on its way. */
export function stopSpeech(audio: HTMLAudioElement | null) {
  generation += 1;
  if (typeof window !== "undefined") {
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* no speech engine */
    }
  }
  speaking = null;
  void stopNativeSpeaking();
  for (const el of new Set([audio, ownAudio])) {
    if (!el) continue;
    try {
      el.pause();
      el.currentTime = 0;
    } catch {
      /* element gone */
    }
  }
}
