import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** An AudioContext that only records what was played. */
function fakeAudio() {
  const started: number[] = [];
  const stopped: number[] = [];
  class FakeContext {
    state = "running";
    currentTime = 0;
    destination = {};
    resume = vi.fn(async () => undefined);
    createOscillator() {
      const osc = { type: "", frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(() => started.push(osc.frequency.value)), stop: vi.fn(() => stopped.push(osc.frequency.value)) };
      return osc;
    }
    createGain() {
      return { gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() };
    }
  }
  return { FakeContext, started, stopped };
}

describe("the ringback", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("rings brr-brr every three seconds while a call goes out, and goes quiet the moment it's stopped", async () => {
    const { FakeContext, started, stopped } = fakeAudio();
    vi.stubGlobal("AudioContext", FakeContext);
    vi.stubGlobal("window", { setInterval, clearInterval });
    const { startRingback } = await import("@/lib/sound");
    const stop = startRingback();
    // Two bursts, each two tones together: 400 and 450 Hz, the sound of a line ringing.
    expect(started).toEqual([400, 450, 400, 450]);
    vi.advanceTimersByTime(3000);
    expect(started).toHaveLength(8);
    stop();
    expect(stopped.length).toBeGreaterThan(0);
    vi.advanceTimersByTime(9000);
    expect(started).toHaveLength(8);
  });

  it("leaves the alarm's ringtone alone when it stops", async () => {
    const { FakeContext, started } = fakeAudio();
    vi.stubGlobal("AudioContext", FakeContext);
    vi.stubGlobal("window", { setInterval, clearInterval });
    const { startRingback, startRingtone } = await import("@/lib/sound");
    startRingtone();
    const rings = started.length;
    startRingback()();
    vi.advanceTimersByTime(2200);
    expect(started.length).toBeGreaterThan(rings + 4);
  });
});

/** An AudioContext that records each oscillator as it starts (its wave and pitch) and the ring's master gain. */
function recordingAudio() {
  const played: { type: string; freq: number }[] = [];
  const peaks: number[] = [];
  const ramps: { kind: string; value: number; at: number }[][] = [];
  class FakeContext {
    state = "running";
    currentTime = 0;
    destination = {};
    resume = vi.fn(async () => undefined);
    createOscillator() {
      const osc = {
        type: "",
        frequency: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
        start: vi.fn(() => played.push({ type: osc.type, freq: osc.frequency.value })),
        stop: vi.fn(),
      };
      return osc;
    }
    createGain() {
      const log: { kind: string; value: number; at: number }[] = [];
      ramps.push(log);
      const note = (kind: string) => (value: number, at: number) => {
        log.push({ kind, value, at });
        if (kind === "linear" && value > 0) peaks.push(value);
      };
      return {
        gain: { setValueAtTime: note("set"), linearRampToValueAtTime: note("linear"), exponentialRampToValueAtTime: note("exp") },
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
    }
    createBiquadFilter() {
      return { type: "", frequency: { value: 0 }, connect: vi.fn() };
    }
  }
  return { FakeContext, played, peaks, ramps };
}

describe("the ringtone", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("rings Chog Classic by default, as it always has", async () => {
    const { FakeContext, played } = recordingAudio();
    vi.stubGlobal("AudioContext", FakeContext);
    vi.stubGlobal("window", { setInterval, clearInterval, setTimeout, clearTimeout });
    const { startRingtone } = await import("@/lib/sound");
    const stop = startRingtone(true);
    expect(played).toEqual([
      { type: "sine", freq: 392 },
      { type: "sine", freq: 494 },
      { type: "sine", freq: 587 },
    ]);
    vi.advanceTimersByTime(1600);
    expect(played).toHaveLength(6);
    stop();
    vi.advanceTimersByTime(5000);
    expect(played).toHaveLength(6);
  });

  it("rings the tone picked in Settings, louder when it's set loud", async () => {
    const { FakeContext, played, peaks } = recordingAudio();
    vi.stubGlobal("AudioContext", FakeContext);
    vi.stubGlobal("window", { setInterval, clearInterval, setTimeout, clearTimeout });
    const { startRingtone, stopRingtone } = await import("@/lib/sound");
    const { DEFAULT_ALARM_STYLE, ringtone } = await import("@/lib/ringtones");
    startRingtone(true, { ...DEFAULT_ALARM_STYLE, tone: "arcade", volume: "normal", rise: false });
    expect(played.map((osc) => osc.freq)).toEqual(ringtone("arcade").notes.map((note) => note.freq));
    expect(played.every((osc) => osc.type === "square")).toBe(true);
    const normal = Math.max(...peaks);
    stopRingtone();
    peaks.length = 0;
    startRingtone(true, { ...DEFAULT_ALARM_STYLE, tone: "arcade", volume: "loud", rise: false });
    expect(Math.max(...peaks)).toBeCloseTo(normal * 1.8);
    stopRingtone();
  });

  it("starts soft and builds over 25 s, unless that's switched off", async () => {
    const { FakeContext, ramps } = recordingAudio();
    vi.stubGlobal("AudioContext", FakeContext);
    vi.stubGlobal("window", { setInterval, clearInterval, setTimeout, clearTimeout });
    const { startRingtone, stopRingtone } = await import("@/lib/sound");
    const { DEFAULT_ALARM_STYLE } = await import("@/lib/ringtones");
    startRingtone(true, DEFAULT_ALARM_STYLE);
    // The first gain made is the ring's own: from a quarter up to full over 25 s.
    expect(ramps[0]).toEqual([
      { kind: "set", value: 0.25, at: 0 },
      { kind: "linear", value: 1, at: 25 },
    ]);
    stopRingtone();
    ramps.length = 0;
    startRingtone(true, { ...DEFAULT_ALARM_STYLE, rise: false });
    expect(ramps[0]).toEqual([]);
    stopRingtone();
  });

  it("previews a tone briefly, says when it stopped, and never cuts a real ring that took over", async () => {
    const { FakeContext, played } = recordingAudio();
    vi.stubGlobal("AudioContext", FakeContext);
    vi.stubGlobal("window", { setInterval, clearInterval, setTimeout, clearTimeout });
    const { previewRingtone, startRingtone } = await import("@/lib/sound");
    const { DEFAULT_ALARM_STYLE } = await import("@/lib/ringtones");
    const ended = vi.fn();
    previewRingtone({ ...DEFAULT_ALARM_STYLE, tone: "old-phone" }, ended);
    expect(played.length).toBeGreaterThan(0);
    vi.advanceTimersByTime(6000);
    expect(ended).toHaveBeenCalledTimes(1);
    const heard = played.length;
    vi.advanceTimersByTime(6000);
    expect(played).toHaveLength(heard);

    // A wake-up rings while a preview plays: the preview ends, and its stop leaves the ring alone.
    const again = vi.fn();
    const stopPreview = previewRingtone({ ...DEFAULT_ALARM_STYLE, tone: "hype" }, again);
    startRingtone(true);
    expect(again).toHaveBeenCalledTimes(1);
    stopPreview();
    const ringing = played.length;
    vi.advanceTimersByTime(1600);
    expect(played.length).toBeGreaterThan(ringing);
  });
});
