import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LineContext } from "@/lib/types";
import { stripAudioTags, VOICES } from "@/lib/voices";
import { composeLine } from "@/lib/writer";

vi.mock("@/lib/native", () => ({
  isNative: vi.fn(() => false),
  nativeSpeak: vi.fn(async () => true),
  stopNativeSpeaking: vi.fn(async () => {}),
}));

const ctx: LineContext = {
  name: "Sam",
  artId: 242,
  archetype: "gremlin",
  traits: [],
  intent: "greeting",
  phase: "morning",
  weekday: "Monday",
  clock: "7:40 am",
  spokenClock: "twenty to eight",
  weather: null,
  nextEvent: { title: "Dentist", when: "half past nine", minutesUntil: 110 },
  pastEvent: null,
  memory: [],
  streak: 2,
  nonce: 5,
  recentIds: [],
};

type Voice = { name: string; lang: string; default: boolean; voiceURI: string; localService: boolean };
const voice = (name: string, lang = "en-US", extra: Partial<Voice> = {}): Voice => ({
  name,
  lang,
  default: false,
  voiceURI: name,
  localService: true,
  ...extra,
});

class FakeUtterance {
  text: string;
  lang = "";
  voice: Voice | null = null;
  pitch = 1;
  rate = 1;
  volume = 1;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

function fakeSynth(voices: Voice[] = []) {
  const spoken: FakeUtterance[] = [];
  const synth = {
    speaking: false,
    pending: false,
    getVoices: vi.fn(() => voices),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    cancel: vi.fn(),
    resume: vi.fn(),
    speak: vi.fn((u: FakeUtterance) => {
      spoken.push(u);
      setTimeout(() => u.onend?.(), 10);
    }),
  };
  return { synth, spoken };
}

function hangUntilAbort(_url: unknown, init?: RequestInit) {
  return new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  });
}

async function load() {
  vi.resetModules();
  const native = await import("@/lib/native");
  const talk = await import("@/lib/talk");
  return { native: vi.mocked(native), talk };
}

/** Just enough of HTMLAudioElement: play() starts, then "ended" fires 10 ms later. */
class FakeAudio {
  paused = true;
  ended = false;
  muted = false;
  src = "";
  preload = "";
  currentTime = 0;
  played: string[] = [];
  private handlers: Record<string, (() => void)[]> = {};
  addEventListener(type: string, fn: () => void) {
    (this.handlers[type] ??= []).push(fn);
  }
  removeEventListener(type: string, fn: () => void) {
    this.handlers[type] = (this.handlers[type] ?? []).filter((item) => item !== fn);
  }
  play() {
    this.paused = false;
    this.played.push(this.src);
    setTimeout(() => {
      this.paused = true;
      this.ended = true;
      [...(this.handlers.ended ?? [])].forEach((fn) => fn());
    }, 10);
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
    [...(this.handlers.pause ?? [])].forEach((fn) => fn());
  }
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // Back to the factory implementations (isNative() false) between tests.
  vi.resetAllMocks();
  vi.useFakeTimers();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("fetching a line", () => {
  it("falls back to the local writer when the server is too slow", async () => {
    const { talk } = await load();
    fetchMock.mockImplementation(hangUntilAbort);
    let settled = false;
    const pending = talk.speakLine(ctx, "device-12345678", null, true).then((spoken) => {
      settled = true;
      return spoken;
    });
    await vi.advanceTimersByTimeAsync(talk.SPEAK_TIMEOUT_MS - 1000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1100);
    const spoken = await pending;
    expect(spoken.engine).toBe("local");
    expect(spoken.caption).toBe(composeLine(ctx).caption);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/speak");
    // Muted: the server is told not to voice the line.
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).voice).toBe(false);
  });

  it("calls the built-in API origin, so the APK can reach the deployed server", async () => {
    vi.stubEnv("NEXT_PUBLIC_CHOG_API_ORIGIN", "https://chog.example/");
    const { talk } = await load();
    fetchMock.mockResolvedValue(
      Response.json({ caption: "Server line.", id: "j1", engine: "elevenlabs", audioUrl: "data:audio/mpeg;base64,AAAA" }),
    );
    const line = await talk.fetchLine(ctx, "device-12345678");
    expect(fetchMock.mock.calls[0][0]).toBe("https://chog.example/api/speak");
    expect(line).toEqual({ caption: "Server line.", id: "j1", engine: "elevenlabs", audioUrl: "data:audio/mpeg;base64,AAAA" });
  });

  it("skips the network in the APK when no API origin was built in", async () => {
    const { native, talk } = await load();
    native.isNative.mockReturnValue(true);
    const spoken = await talk.speakLine(ctx, "device-12345678", null, true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(spoken.engine).toBe("local");
  });

  it("ignores an audio URL it would not play", async () => {
    const { talk } = await load();
    fetchMock.mockResolvedValue(Response.json({ caption: "Line.", id: "j", engine: "elevenlabs", audioUrl: "https://evil.example/a.mp3" }));
    expect((await talk.fetchLine(ctx, "device-12345678"))?.audioUrl).toBeNull();
  });
});

describe("choosing the device voice", () => {
  it("prefers a natural en-US voice and never a novelty one, whatever the order", async () => {
    const { talk } = await load();
    const list = [
      voice("Albert", "en-US"),
      voice("Samantha", "en-US", { default: true }),
      voice("Google US English", "en-US", { localService: false }),
      voice("Microsoft Aria Online (Natural) - English (United States)", "en-US", { localService: false }),
      voice("Daniel", "en-GB"),
      voice("Thomas", "fr-FR"),
    ];
    const best = "Microsoft Aria Online (Natural) - English (United States)";
    expect(talk.pickVoice(list)?.name).toBe(best);
    expect(talk.pickVoice([...list].reverse())?.name).toBe(best);
    expect(talk.pickVoice(list.filter((v) => !v.name.startsWith("Microsoft")))?.name).toBe("Google US English");
    expect(talk.pickVoice([voice("Albert"), voice("Daniel", "en-GB")])?.name).toBe("Daniel");
    expect(talk.pickVoice([voice("Thomas", "fr-FR")])).toBeNull();
    expect(talk.scoreVoice(voice("Bad News"))).toBeLessThan(0);
  });

  it("speaks with the chosen voice, en-US, and the archetype's pitch and rate", async () => {
    const { talk } = await load();
    const { synth, spoken } = fakeSynth([voice("Samantha"), voice("Google US English")]);
    vi.stubGlobal("window", { speechSynthesis: synth });
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
    fetchMock.mockRejectedValue(new Error("offline"));
    const line = await talk.speakLine(ctx, "device-12345678", null, false);
    await vi.advanceTimersByTimeAsync(10_000);
    await line.playback;
    expect(spoken).toHaveLength(1);
    expect(spoken[0].text).toBe(stripAudioTags(line.caption));
    expect(spoken[0].lang).toBe("en-US");
    expect(spoken[0].voice?.name).toBe("Google US English");
    expect(spoken[0].pitch).toBe(VOICES.gremlin.pitch);
    expect(spoken[0].rate).toBe(VOICES.gremlin.rate);
  });
});

describe("the APK voice", () => {
  it("uses Android text-to-speech when the WebView has no speechSynthesis", async () => {
    const { native, talk } = await load();
    native.isNative.mockReturnValue(true);
    vi.stubGlobal("window", {});
    const line = await talk.speakLine(ctx, "device-12345678", null, false);
    await vi.advanceTimersByTimeAsync(10_000);
    await line.playback;
    expect(native.nativeSpeak).toHaveBeenCalledWith(stripAudioTags(line.caption), {
      pitch: VOICES.gremlin.pitch,
      rate: VOICES.gremlin.rate,
      alarm: false,
    });
  });

  it("says the wake-up line on the alarm stream, so it is heard with media muted", async () => {
    const { native, talk } = await load();
    native.isNative.mockReturnValue(true);
    vi.stubGlobal("window", {});
    const line = await talk.speakLine({ ...ctx, intent: "morning" }, "device-12345678", null, false);
    await vi.advanceTimersByTimeAsync(10_000);
    await line.playback;
    expect(native.nativeSpeak).toHaveBeenCalledWith(stripAudioTags(line.caption), {
      pitch: VOICES.gremlin.pitch,
      rate: VOICES.gremlin.rate,
      alarm: true,
    });
  });
});

describe("playback order", () => {
  it("plays the server's ElevenLabs clip and does not touch the device voice", async () => {
    const { talk } = await load();
    const { synth } = fakeSynth([voice("Samantha")]);
    vi.stubGlobal("window", { speechSynthesis: synth });
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
    const audio = new FakeAudio();
    fetchMock.mockResolvedValue(
      Response.json({ caption: "Clip line.", id: "j", engine: "elevenlabs", audioUrl: "data:audio/mpeg;base64,AAAA" }),
    );
    const line = await talk.speakLine(ctx, "device-12345678", audio as unknown as HTMLAudioElement, false);
    await vi.advanceTimersByTimeAsync(10_000);
    await line.playback;
    expect(audio.played).toEqual(["data:audio/mpeg;base64,AAAA"]);
    expect(synth.speak).not.toHaveBeenCalled();
  });

  it("uses device voice for a legacy model fallback without any additional network request", async () => {
    const { talk } = await load();
    const { synth } = fakeSynth([voice("Samantha")]);
    vi.stubGlobal("window", { speechSynthesis: synth });
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
    vi.stubGlobal("Audio", FakeAudio);
    fetchMock.mockResolvedValue(Response.json({ caption: "Kokoro line.", id: "j", engine: "kokoro", audioUrl: null }));
    const line = await talk.speakLine(ctx, "device-12345678", null, false);
    await vi.advanceTimersByTimeAsync(10_000);
    await line.playback;
    expect(synth.speak).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reads a shared line using the device voice when there is no recorded clip", async () => {
    const { talk } = await load();
    const { synth } = fakeSynth([voice("Samantha")]);
    vi.stubGlobal("window", { speechSynthesis: synth });
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
    vi.stubGlobal("Audio", FakeAudio);
    const playback = talk.sayShared(undefined, "A shared line.", "gremlin", null);
    await vi.advanceTimersByTimeAsync(10_000);
    await playback;
    expect(synth.speak).toHaveBeenCalledTimes(1);
    expect(synth.speak.mock.calls[0][0].text).toBe("A shared line.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("priming and stopping", () => {
  it("primes speech and the audio element synchronously inside the tap", async () => {
    const { talk } = await load();
    const { synth, spoken } = fakeSynth([voice("Samantha")]);
    vi.stubGlobal("window", { speechSynthesis: synth });
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
    const mutedAtPlay: boolean[] = [];
    const audio = {
      paused: true,
      muted: false,
      src: "",
      play: vi.fn(function (this: { muted: boolean }) {
        mutedAtPlay.push(this.muted);
        return Promise.resolve();
      }),
      pause: vi.fn(),
    };
    talk.primeSpeech(audio as unknown as HTMLAudioElement);
    // All of it happened before any await: that is what keeps the browser's user-gesture credit.
    expect(synth.speak).toHaveBeenCalledTimes(1);
    expect(spoken[0].volume).toBe(0);
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(mutedAtPlay).toEqual([true]);
    expect(audio.src.startsWith("data:audio/wav;base64,")).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(audio.pause).toHaveBeenCalled();
    expect(audio.muted).toBe(false);
  });

  it("does not interrupt audio that is already playing", async () => {
    const { talk } = await load();
    vi.stubGlobal("window", {});
    const audio = { paused: false, muted: false, src: "data:audio/mpeg;base64,REAL", play: vi.fn(), pause: vi.fn() };
    talk.primeSpeech(audio as unknown as HTMLAudioElement);
    expect(audio.play).not.toHaveBeenCalled();
    expect(audio.src).toBe("data:audio/mpeg;base64,REAL");
  });

  it("stops Android speech too, and a line still on its way never starts", async () => {
    const { native, talk } = await load();
    const { synth } = fakeSynth([voice("Samantha")]);
    vi.stubGlobal("window", { speechSynthesis: synth });
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
    fetchMock.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(Response.json({ caption: "Late line.", id: "j", engine: "mock" })), 500)),
    );
    const pending = talk.speakLine(ctx, "device-12345678", null, false);
    talk.stopSpeech(null);
    expect(native.stopNativeSpeaking).toHaveBeenCalled();
    expect(synth.cancel).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(600);
    const line = await pending;
    await vi.advanceTimersByTimeAsync(10_000);
    await line.playback;
    expect(line.caption).toBe("Late line.");
    expect(synth.speak).not.toHaveBeenCalled();
  });
});

/** An element whose stream the test drives: like a real one, play() only settles once audio arrives. */
class StreamAudio {
  paused = true;
  ended = false;
  muted = false;
  src = "";
  preload = "";
  crossOrigin: string | null = null;
  currentTime = 0;
  played: string[] = [];
  unloaded = 0;
  private handlers: Record<string, (() => void)[]> = {};
  private pending: { resolve: () => void; reject: (error: unknown) => void } | null = null;
  addEventListener(type: string, fn: () => void) {
    (this.handlers[type] ??= []).push(fn);
  }
  removeEventListener(type: string, fn: () => void) {
    this.handlers[type] = (this.handlers[type] ?? []).filter((item) => item !== fn);
  }
  private emit(type: string) {
    [...(this.handlers[type] ?? [])].forEach((fn) => fn());
  }
  play() {
    this.paused = false;
    this.played.push(this.src);
    return new Promise<void>((resolve, reject) => {
      this.pending = { resolve, reject };
    });
  }
  /** The first audio arrives and playback starts. */
  start() {
    this.pending?.resolve();
    this.pending = null;
    this.emit("playing");
  }
  tick(seconds: number) {
    this.currentTime += seconds;
    this.emit("timeupdate");
  }
  /** What a 4xx or 5xx from /api/voice looks like to the page. */
  fail() {
    this.emit("error");
    this.pending?.reject(new DOMException("no source", "NotSupportedError"));
    this.pending = null;
  }
  finish() {
    this.paused = true;
    this.ended = true;
    this.emit("ended");
  }
  pause() {
    if (this.paused) return;
    this.paused = true;
    this.pending?.reject(new DOMException("paused", "AbortError"));
    this.pending = null;
    this.emit("pause");
  }
  removeAttribute(name: string) {
    if (name === "src") {
      this.src = "";
      this.unloaded += 1;
    }
  }
  load() {}
}

const VOICE_LINE = { caption: "Streamed line, no waiting.", id: "j", engine: "elevenlabs", audioUrl: "/api/voice?t=abc.def" };

describe("shared call playback", () => {
  it("falls back to device voice if the recorded clip never starts", async () => {
    const { talk } = await load();
    const { synth } = fakeSynth([voice("Samantha")]);
    vi.stubGlobal("window", { speechSynthesis: synth });
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
    const audio = new StreamAudio();
    const playback = talk.sayShared("/voices/shared.mp3", "A shared line.", "gremlin", audio as unknown as HTMLAudioElement);
    await vi.advanceTimersByTimeAsync(10_000);
    await playback;
    expect(audio.unloaded).toBe(1);
    expect(synth.speak).toHaveBeenCalledTimes(1);
  });

  it("ends a stalled shared recording without repeating the line", async () => {
    const { talk } = await load();
    const { synth } = fakeSynth([voice("Samantha")]);
    vi.stubGlobal("window", { speechSynthesis: synth });
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
    const audio = new StreamAudio();
    const playback = talk.sayShared("/voices/shared.mp3", "A shared line.", "gremlin", audio as unknown as HTMLAudioElement);
    audio.start();
    await vi.advanceTimersByTimeAsync(10_000);
    await playback;
    expect(audio.paused).toBe(true);
    expect(synth.speak).not.toHaveBeenCalled();
  });

  it("cancels a pending shared recording without starting the fallback later", async () => {
    const { talk } = await load();
    const { synth } = fakeSynth([voice("Samantha")]);
    vi.stubGlobal("window", { speechSynthesis: synth });
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
    const audio = new StreamAudio();
    const playback = talk.sayShared("/voices/shared.mp3", "A shared line.", "gremlin", audio as unknown as HTMLAudioElement);
    talk.stopSpeech(audio as unknown as HTMLAudioElement);
    await vi.advanceTimersByTimeAsync(10_000);
    await playback;
    expect(audio.paused).toBe(true);
    expect(synth.speak).not.toHaveBeenCalled();
  });
});

async function streamedLine(audio: StreamAudio | null) {
  const { talk } = await load();
  const { synth } = fakeSynth([voice("Samantha")]);
  vi.stubGlobal("window", { speechSynthesis: synth });
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  fetchMock.mockResolvedValue(Response.json(VOICE_LINE));
  const line = await talk.speakLine(ctx, "device-12345678", audio as unknown as HTMLAudioElement, false);
  let done = false;
  void line.playback.then(() => {
    done = true;
  });
  return { talk, synth, line, isDone: () => done };
}

describe("streamed voice", () => {
  it("accepts only its own /api/voice URL, on the built-in API origin", async () => {
    vi.stubEnv("NEXT_PUBLIC_CHOG_API_ORIGIN", "https://chog.example");
    const { talk } = await load();
    const urlFor = async (audioUrl: string) => {
      fetchMock.mockResolvedValueOnce(Response.json({ ...VOICE_LINE, audioUrl }));
      return (await talk.fetchLine(ctx, "device-12345678"))?.audioUrl;
    };
    expect(await urlFor("/api/voice?t=abc.def")).toBe("https://chog.example/api/voice?t=abc.def");
    expect(await urlFor("/api/voice?t=<script>")).toBeNull();
    expect(await urlFor("/api/audio/0123")).toBeNull();
    expect(await urlFor("https://evil.example/api/voice?t=abc.def")).toBeNull();
  });

  it("hands back the caption at once and starts the stream in CORS mode", async () => {
    const audio = new StreamAudio();
    const { synth, line, isDone } = await streamedLine(audio);
    // The caption is in hand before a single byte of audio has arrived.
    expect(line.caption).toBe("Streamed line, no waiting.");
    expect(line.engine).toBe("elevenlabs");
    expect(audio.played).toEqual(["/api/voice?t=abc.def"]);
    // CORS mode, so the lip-sync analyser can read a clip from the API origin.
    expect(audio.crossOrigin).toBe("anonymous");
    audio.start();
    for (let i = 0; i < 6; i++) {
      await vi.advanceTimersByTimeAsync(1000);
      audio.tick(1);
    }
    // Six seconds in and still talking: steady progress is never mistaken for a stall.
    expect(isDone()).toBe(false);
    audio.finish();
    await vi.advanceTimersByTimeAsync(3000);
    expect(isDone()).toBe(true);
    expect(synth.speak).not.toHaveBeenCalled();
  });

  it("gives the line to the device voice when no audio arrives within AUDIO_START_MS", async () => {
    const audio = new StreamAudio();
    const { talk, synth, line } = await streamedLine(audio);
    await vi.advanceTimersByTimeAsync(talk.AUDIO_START_MS - 100);
    expect(synth.speak).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(synth.speak).toHaveBeenCalledTimes(1);
    expect(synth.speak.mock.calls[0][0].text).toBe("Streamed line, no waiting.");
    // The stalled clip is unloaded, so it cannot start late over the device voice.
    expect(audio.paused).toBe(true);
    expect(audio.unloaded).toBe(1);
    await vi.advanceTimersByTimeAsync(10_000);
    await line.playback;
  });

  it("goes to the device voice at once when the clip errors", async () => {
    const audio = new StreamAudio();
    const { synth } = await streamedLine(audio);
    await vi.advanceTimersByTimeAsync(100);
    audio.fail();
    await vi.advanceTimersByTimeAsync(100);
    expect(synth.speak).toHaveBeenCalledTimes(1);
  });

  it("ends a clip that started and then stalled, without saying the line twice", async () => {
    const audio = new StreamAudio();
    const { talk, synth, isDone } = await streamedLine(audio);
    audio.start();
    audio.tick(0.5);
    await vi.advanceTimersByTimeAsync(talk.AUDIO_STALL_MS - 100);
    expect(audio.paused).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(audio.paused).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(isDone()).toBe(true);
    expect(synth.speak).not.toHaveBeenCalled();
  });

  it("lets a newer line take the element without the older one falling back", async () => {
    const audio = new StreamAudio();
    const { talk, synth, isDone } = await streamedLine(audio);
    audio.start();
    fetchMock.mockResolvedValue(Response.json({ ...VOICE_LINE, caption: "The next line.", audioUrl: "/api/voice?t=next.one" }));
    const next = await talk.speakLine(ctx, "device-12345678", audio as unknown as HTMLAudioElement, false);
    expect(audio.played).toEqual(["/api/voice?t=abc.def", "/api/voice?t=next.one"]);
    await vi.advanceTimersByTimeAsync(talk.AUDIO_START_MS + 1000);
    // The first line let go; only the second is still waiting on its stream.
    expect(isDone()).toBe(true);
    expect(synth.speak).toHaveBeenCalledTimes(1);
    expect(synth.speak.mock.calls[0][0].text).toBe("The next line.");
    await vi.advanceTimersByTimeAsync(10_000);
    await next.playback;
  });

  it("puts the shared element (the meet screen has none of its own) in CORS mode", async () => {
    const made: StreamAudio[] = [];
    vi.stubGlobal(
      "Audio",
      class extends StreamAudio {
        constructor() {
          super();
          made.push(this);
        }
      },
    );
    await streamedLine(null);
    expect(made).toHaveLength(1);
    expect(made[0].crossOrigin).toBe("anonymous");
    expect(made[0].played).toEqual(["/api/voice?t=abc.def"]);
  });

  it("waits about four seconds for the caption, not six", async () => {
    const { talk } = await load();
    expect(talk.SPEAK_TIMEOUT_MS).toBeLessThanOrEqual(4500);
  });
});
