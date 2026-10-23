import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import {
  analyserFor,
  ART_BYTES_WAIT_MS,
  ART_RETRY_MS,
  artFailed,
  artHidden,
  artIdFromSrc,
  artLoaded,
  artLoadStart,
  artNextTry,
  artRetrying,
  attachAudioWake,
  decodedArt,
  hatLineFor,
  pokeZone,
  retrySrc,
  type ArtLoad,
} from "@/components/chog/ChogEngine";
import { rigFor } from "@/lib/faceRig";
import type { Side } from "@/lib/types";

describe("portrait retry", () => {
  it("waits 1.5 s, 4 s, then 8 s", () => {
    expect([...ART_RETRY_MS]).toEqual([1500, 4000, 8000]);
  });

  it("busts the cache on later tries, so the <img> really fetches again", () => {
    expect(retrySrc("/api/art/1234", 0)).toBe("/api/art/1234");
    expect(retrySrc("/api/art/1234", 1)).toBe("/api/art/1234?r=1");
    expect(retrySrc("https://chog.example/api/art/7?v=2", 2)).toBe("https://chog.example/api/art/7?v=2&r=2");
    expect(retrySrc("/chog/642.webp#x", 3)).toBe("/chog/642.webp?r=3#x");
    expect(retrySrc("data:image/png;base64,AAAA", 2)).toBe("data:image/png;base64,AAAA");
  });

  it("reads the token number out of every art URL shape", () => {
    expect(artIdFromSrc("/api/art/1234")).toBe(1234);
    expect(artIdFromSrc("/api/art/1234?r=2")).toBe(1234);
    expect(artIdFromSrc("/chog/642.webp")).toBe(642);
    expect(artIdFromSrc("https://ipfs.io/ipfs/bafy/1000.webp")).toBe(1000);
    expect(artIdFromSrc("/chog/face.webp")).toBeNull();
  });

  it("tries three more times after a failure, then gives up", () => {
    let load: ArtLoad = artLoadStart("/api/art/1234");
    expect(artRetrying(load)).toBe(false);
    const urls: string[] = [];
    for (let i = 0; i < ART_RETRY_MS.length; i++) {
      const url = retrySrc(load.src, load.tries);
      urls.push(url);
      load = artFailed(load, url);
      expect(load.state).toBe("waiting");
      expect(artRetrying(load)).toBe(true);
      // The warp's own copy fails too: still one wait, not two.
      expect(artFailed(load, url)).toBe(load);
      load = artNextTry(load);
      expect(load.state).toBe("loading");
      expect(artRetrying(load)).toBe(true);
    }
    const last = retrySrc(load.src, load.tries);
    expect([...urls, last]).toEqual(["/api/art/1234", "/api/art/1234?r=1", "/api/art/1234?r=2", "/api/art/1234?r=3"]);
    load = artFailed(load, last);
    expect(load.state).toBe("gave-up");
    expect(artRetrying(load)).toBe(false);
    expect(artNextTry(load)).toBe(load);
  });

  it("recovers on a retry and clears the waiting label", () => {
    let load = artFailed(artLoadStart("/api/art/1234"), "/api/art/1234");
    load = artNextTry(load);
    // A late failure from the first try is ignored.
    expect(artFailed(load, "/api/art/1234")).toBe(load);
    load = artLoaded(load, "/api/art/1234?r=1");
    expect(load.state).toBe("shown");
    expect(artRetrying(load)).toBe(false);
  });

  it("hides the broken <img> from the first failure until a try arrives", () => {
    let load = artLoadStart("/chog/375.webp");
    expect(artHidden(load)).toBe(false);
    load = artFailed(load, "/chog/375.webp");
    expect(artHidden(load)).toBe(true);
    load = artNextTry(load);
    expect(artHidden(load)).toBe(true);
    expect(artHidden(artLoaded(load, "/chog/375.webp?r=1"))).toBe(false);
    for (let i = 1; i <= ART_RETRY_MS.length; i++) load = artNextTry(artFailed(load, retrySrc(load.src, load.tries)));
    load = artFailed(load, retrySrc(load.src, load.tries));
    expect(load.state).toBe("gave-up");
    expect(artHidden(load)).toBe(true);
  });

  it("keeps a shown portrait when only the warp's copy fails", () => {
    const shown = artLoaded(artLoadStart("/chog/642.webp"), "/chog/642.webp");
    expect(artFailed(shown, "/chog/642.webp")).toBe(shown);
  });
});

describe("poke zones", () => {
  const zone = (artId: number, side: Side, x: number, y: number) => pokeZone(x, y, hatLineFor(artId, side, rigFor(artId, side).rig.eyes));

  it("reads an eye poke on the Right-side demos as the face, not the hat", () => {
    // 642's near eye spans about y 0.31-0.41, its far eye 0.45-0.55.
    expect(zone(642, "Right", 0.42, 0.34)).toBe("face");
    expect(zone(642, "Right", 0.42, 0.4)).toBe("face");
    expect(zone(642, "Right", 0.81, 0.48)).toBe("face");
    // 821's upper lens starts at about 0.16.
    expect(zone(821, "Right", 0.43, 0.2)).toBe("face");
    expect(zone(821, "Right", 0.43, 0.3)).toBe("face");
    expect(zone(821, "Right", 0.85, 0.42)).toBe("face");
  });

  it("still reads their cap and crown as the hat", () => {
    expect(zone(642, "Right", 0.3, 0.22)).toBe("hat");
    expect(zone(642, "Right", 0.8, 0.33)).toBe("hat");
    expect(zone(821, "Right", 0.6, 0.12)).toBe("hat");
    expect(zone(821, "Right", 0.9, 0.25)).toBe("hat");
  });

  it("follows the measured eyes on Left-side art", () => {
    // 375's small far eye starts at 0.363: its top used to count as the beanie.
    expect(zone(375, "Left", 0.84, 0.38)).toBe("face");
    expect(zone(375, "Left", 0.5, 0.25)).toBe("hat");
    expect(zone(242, "Left", 0.44, 0.5)).toBe("face");
    expect(zone(242, "Left", 0.5, 0.15)).toBe("hat");
  });

  it("falls back to the Side for unmeasured tokens, and keeps the collar", () => {
    expect(zone(5000, "Right", 0.42, 0.3)).toBe("face");
    expect(zone(5000, "Right", 0.42, 0.15)).toBe("hat");
    expect(zone(5000, "Left", 0.44, 0.38)).toBe("hat");
    expect(zone(5000, "Left", 0.44, 0.5)).toBe("face");
    for (const id of [642, 821, 375, 242, 5000]) expect(zone(id, id === 642 || id === 821 ? "Right" : "Left", 0.5, 0.9)).toBe("collar");
  });
});

/** An AudioContext the browser can put to sleep: resume() only works while `allowed` (a gesture). */
class SleepyContext extends EventTarget {
  static last: SleepyContext | null = null;
  state: AudioContextState = "suspended";
  allowed = true;
  resumes = 0;
  sampleRate = 48000;
  destination = {};
  constructor() {
    super();
    SleepyContext.last = this;
  }
  resume() {
    this.resumes += 1;
    if (this.allowed) this.become("running");
    return Promise.resolve();
  }
  become(state: AudioContextState) {
    if (this.state === state) return;
    this.state = state;
    this.dispatchEvent(new Event("statechange"));
  }
  createMediaElementSource() {
    return { connect: () => undefined };
  }
  createAnalyser() {
    return { context: this, connect: () => undefined, fftSize: 0, smoothingTimeConstant: 0 };
  }
}

describe("lip-sync audio graph", () => {
  const win = Object.assign(new EventTarget(), { AudioContext: SleepyContext });
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  afterAll(() => {
    vi.unstubAllGlobals();
  });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("wakes again after the browser suspends it, so a studio clip never plays muted", async () => {
    const detach = attachAudioWake();
    // The first tap makes the graph and starts it.
    win.dispatchEvent(new Event("pointerdown"));
    await flush();
    const ctx = SleepyContext.last;
    expect(ctx?.state).toBe("running");
    const clip = new EventTarget() as unknown as HTMLMediaElement;
    expect(analyserFor(clip)).not.toBeNull();

    // iOS suspends it (a phone call, the app in the background) and refuses to resume until a tap.
    ctx!.allowed = false;
    ctx!.become("interrupted" as AudioContextState);
    expect(analyserFor(clip)).toBeNull();
    const asked = ctx!.resumes;
    clip.dispatchEvent(new Event("play"));
    expect(ctx!.resumes).toBeGreaterThan(asked);
    expect(ctx!.state).not.toBe("running");

    // The next tap anywhere wakes it: the listeners came back when it fell asleep.
    ctx!.allowed = true;
    win.dispatchEvent(new Event("touchend"));
    await flush();
    expect(ctx!.state).toBe("running");
    expect(analyserFor(clip)).not.toBeNull();

    // Suspended in the background, it is asked to resume when the page comes back, and when a clip starts.
    ctx!.become("suspended");
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(ctx!.state).toBe("running");
    ctx!.become("suspended");
    clip.dispatchEvent(new Event("play"));
    expect(ctx!.state).toBe("running");
    detach();
  });
});

// Last in the file: the lip-sync block above stubs its globals while the file is collected.
describe("art decoded off the main thread", () => {
  const art = { width: 512, height: 512 } as HTMLImageElement;
  const bitmap = { close: () => undefined } as ImageBitmap;

  /** fetch that never answers until its request is stopped, as a stalled gateway does. */
  function stall() {
    const spy = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("stopped", "AbortError")))),
    );
    vi.stubGlobal("fetch", spy);
    return spy;
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("decodes the bytes into a bitmap when they come", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => bitmap));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Blob(["webp"]))));
    expect(await decodedArt("/chog/375.webp", art)).toBe(bitmap);
  });

  it("starts from the loaded image when a gateway stalls, and stops the request", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => bitmap));
    const spy = stall();
    const result = decodedArt("https://ipfs.example/375.webp", art);
    await vi.advanceTimersByTimeAsync(ART_BYTES_WAIT_MS);
    expect(await result).toBe(art);
    expect(spy.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it("stops the request at once when the portrait goes away", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => bitmap));
    const spy = stall();
    const ended = new AbortController();
    const result = decodedArt("https://ipfs.example/375.webp", art, ended.signal);
    ended.abort();
    expect(await result).toBe(art);
    expect(spy.mock.calls[0][1]?.signal?.aborted).toBe(true);

    // Already gone: no request at all.
    expect(await decodedArt("https://ipfs.example/375.webp", art, ended.signal)).toBe(art);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("keeps the loaded image on a refusal, or where bitmaps can't be made", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => bitmap));
    vi.stubGlobal("fetch", vi.fn(async () => new Response("slow down", { status: 429 })));
    expect(await decodedArt("https://ipfs.example/375.webp", art)).toBe(art);
    vi.stubGlobal("createImageBitmap", undefined);
    expect(await decodedArt("/chog/375.webp", art)).toBe(art);
  });
});
