"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { faceTraits, faceTraitsFromKey, faceTraitsKey, rigFor, type Box, type Eye } from "@/lib/faceRig";
import { EYE_PAD, featureHole, fits, lidMasks, openMouth, paintableSkin, paintViseme, parseColor, rgbCss, sampleSkin, skinSwatch, traceLid, type Pixels } from "@/lib/facePaint";
import { WARP_GLSL, warpFor, warpUniforms, type FaceWarp } from "@/lib/faceWarp";
import type { Archetype, PokeZone, RawTrait, Side, SkyPhase } from "@/lib/types";

type Point = [number, number];

const W = 1000;
const H = 1000;
/** Give up on the WebGL reveal after this many frames and keep the static image. */
const REVEAL_FRAMES = 60;

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(src));
    image.src = src;
  });
}

/** How long start-up waits for the art's bytes before it decodes the loaded image itself. */
export const ART_BYTES_WAIT_MS = 1000;

/**
 * The art, decoded off the main thread where the browser can. An <img> drawn to a canvas is only
 * decoded when its pixels are read, inside getImageData, and createImageBitmap(<img>) decodes it
 * on the spot too: 60 ms on a desktop, near a second on a slow phone, in the middle of start-up.
 * A bitmap made from the file's bytes (already in the HTTP cache from loading `art`) is decoded on
 * a background thread instead. Falls back to the loaded image, which works, just on the main thread.
 */
export async function decodedArt(src: string, art: HTMLImageElement, signal?: AbortSignal): Promise<HTMLImageElement | ImageBitmap> {
  if (typeof createImageBitmap !== "function" || typeof fetch !== "function" || typeof AbortController !== "function") return art;
  // When the bytes are not in the cache after all, a gateway that stalls or answers 429 must not
  // hold the portrait still: past ART_BYTES_WAIT_MS, or once the engine is gone, the request stops.
  const request = new AbortController();
  const stop = () => request.abort();
  const timer = setTimeout(stop, ART_BYTES_WAIT_MS);
  signal?.addEventListener("abort", stop);
  try {
    if (signal?.aborted) return art;
    const res = await fetch(src, { signal: request.signal });
    if (!res.ok) return art;
    const bytes = await res.blob();
    clearTimeout(timer);
    return await createImageBitmap(bytes);
  } catch {
    return art;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
  }
}

/** Let the browser paint and take input before the next slice of start-up work. */
function yieldToMain(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (typeof scheduler?.yield === "function") return scheduler.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * How long to wait before each new try at a portrait that failed to load. A typed token's art
 * comes through IPFS gateways that can all stall at once; three tries cover a 15-second hiccup,
 * then the arch keeps its colour.
 */
export const ART_RETRY_MS = [1500, 4000, 8000] as const;

/** The URL for try `attempt`. A query on later tries makes the browser really fetch it again. */
export function retrySrc(src: string, attempt: number): string {
  if (attempt <= 0 || /^(data|blob):/.test(src)) return src;
  const hashAt = src.indexOf("#");
  const base = hashAt < 0 ? src : src.slice(0, hashAt);
  const hash = hashAt < 0 ? "" : src.slice(hashAt);
  return `${base}${base.includes("?") ? "&" : "?"}r=${attempt}${hash}`;
}

/** The token number in an art URL ("/api/art/1234", "/chog/642.webp", "…/1000.webp"). */
export function artIdFromSrc(src: string): number | null {
  const match = /(\d+)(?:\.[a-z]+)?(?:[?#].*)?$/i.exec(src);
  return match ? Number(match[1]) : null;
}

/** One portrait's loading: which try is out, and whether it is waiting for the next one. */
export type ArtLoad = { src: string; tries: number; state: "loading" | "waiting" | "shown" | "gave-up" };

export function artLoadStart(src: string): ArtLoad {
  return { src, tries: 0, state: "loading" };
}

/** `url` failed. Wait for the next try, or give up after the last. A stale or repeated failure changes nothing. */
export function artFailed(load: ArtLoad, url: string): ArtLoad {
  if (load.state !== "loading" || retrySrc(load.src, load.tries) !== url) return load;
  return load.tries < ART_RETRY_MS.length ? { ...load, state: "waiting" } : { ...load, state: "gave-up" };
}

/** The wait is over: send the next try. */
export function artNextTry(load: ArtLoad): ArtLoad {
  return load.state === "waiting" ? { ...load, tries: load.tries + 1, state: "loading" } : load;
}

/** `url` arrived. Later failures (the warp's own copy, say) no longer trigger tries. */
export function artLoaded(load: ArtLoad, url: string): ArtLoad {
  return load.state === "loading" && retrySrc(load.src, load.tries) === url ? { ...load, state: "shown" } : load;
}

/** A try has failed and nothing is on screen yet: time for the quiet "Calling Chog #N…". */
export function artRetrying(load: ArtLoad): boolean {
  return load.state === "waiting" || (load.state === "loading" && load.tries > 0);
}

/**
 * Load a portrait with retries: the URL to put on the <img> (and the texture), and the callbacks
 * its load and error events report to. Starts over whenever `src` changes.
 */
export function useArtRetry(src: string) {
  const [stored, setStored] = useState(() => artLoadStart(src));
  const load = stored.src === src ? stored : artLoadStart(src);
  const update = useCallback(
    (step: (load: ArtLoad) => ArtLoad) => setStored((prev) => step(prev.src === src ? prev : artLoadStart(src))),
    [src],
  );
  useEffect(() => {
    if (load.state !== "waiting") return;
    const timer = window.setTimeout(() => update(artNextTry), ART_RETRY_MS[load.tries] ?? ART_RETRY_MS[ART_RETRY_MS.length - 1]);
    return () => window.clearTimeout(timer);
  }, [load.state, load.tries, update]);
  const fail = useCallback((url: string) => update((prev) => artFailed(prev, url)), [update]);
  const loaded = useCallback((url: string) => update((prev) => artLoaded(prev, url)), [update]);
  return { url: retrySrc(src, load.tries), retrying: artRetrying(load), hidden: artHidden(load), fail, loaded };
}

/** Hide the <img> once a try has failed, until one arrives: Chrome draws a broken-image glyph on a sized <img>. */
export function artHidden(load: ArtLoad): boolean {
  return load.state !== "shown" && (load.tries > 0 || load.state !== "loading");
}

type HatLine = { at0: number; slope: number };

/**
 * Where the hat ends, along the art's width: a line just above the eyes. Chogs lean, so the line
 * slopes with the face: down to the left on Left-side art, steeply down to the right on Right.
 * Points are eye tops as fractions of the art, [x, y].
 */
const HAT_MARGIN = 0.03;
const SIDE_EYE_TOPS: Record<Side, [Point, Point]> = {
  // The measured groups (face-groups.json), averaged.
  Left: [[0.44, 0.46], [0.84, 0.39]],
  Right: [[0.42, 0.25], [0.82, 0.38]],
};
/** The two Right-side demo Chogs have no measured eye group: read off their art. */
const DEMO_EYE_TOPS: Record<number, [Point, Point]> = {
  642: [[0.42, 0.315], [0.81, 0.455]],
  821: [[0.43, 0.16], [0.85, 0.38]],
};

function lineThrough([[x1, y1], [x2, y2]]: [Point, Point]): HatLine {
  const slope = x2 === x1 ? 0 : (y2 - y1) / (x2 - x1);
  return { at0: y1 - slope * x1 - HAT_MARGIN, slope };
}

/** The hat line for a portrait: its demo reading, else its rig's measured eyes, else its Side's. */
export function hatLineFor(artId: number, side: Side, eyes: Eye[]): HatLine {
  const demo = DEMO_EYE_TOPS[artId];
  if (demo) return lineThrough(demo);
  const tops = [...eyes].sort((a, b) => a.x - b.x).map((eye): Point => [(eye.x + eye.w / 2) / W, eye.y / H]);
  if (tops.length >= 2) return lineThrough([tops[0], tops[tops.length - 1]]);
  if (tops.length === 1) return { at0: tops[0][1] - HAT_MARGIN, slope: 0 };
  return lineThrough(SIDE_EYE_TOPS[side]);
}

/** Which part of the Chog a tap at (x, y), as fractions of the portrait, lands on. */
export function pokeZone(x: number, y: number, hat: HatLine): PokeZone {
  const hatY = Math.min(0.6, Math.max(0.1, hat.at0 + hat.slope * x));
  return y < hatY ? "hat" : y < 0.8 ? "face" : "collar";
}

const VS = `attribute vec2 p; varying vec2 uv; void main(){ uv=p*0.5+0.5; uv.y=1.0-uv.y; gl_Position=vec4(p,0.0,1.0); }`;
// Budget GPUs (Mali-400 class) have no fragment highp; mediump still resolves about 1 px at 1000.
const FS = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 uv; uniform sampler2D tex; uniform float th,bob,br; uniform vec2 pivot,headBand; uniform vec3 bodyBand;
${WARP_GLSL}
void main(){
  vec2 p = uv * vec2(${W}.0, ${H}.0);
  float wh = 1.0 - smoothstep(headBand.x, headBand.y, p.y);
  float wb = smoothstep(bodyBand.x, bodyBand.y, p.y);
  vec2 q = p - vec2(0.0, bob * wh);
  float a = -th * wh;
  float c = cos(a); float s = sin(a);
  vec2 d = q - pivot;
  q = pivot + vec2(c*d.x - s*d.y, s*d.x + c*d.y);
  float anchor = bodyBand.z;
  q.y = anchor - (anchor - q.y) / (1.0 + br * wb);
  q.x = pivot.x + (q.x - pivot.x) / (1.0 + br * 0.6 * wb);
  // Blink and jaw, in art space after the head and body warp: they move the art's own pixels.
  // A uniform branch: at rest (most frames) the warp costs nothing.
  if (face.x + face.y > 0.0) q.y = faceRow(q);
  q = clamp(q, vec2(1.0), vec2(${W - 1}.0, ${H - 1}.0));
  gl_FragColor = texture2D(tex, q / vec2(${W}.0, ${H}.0));
}`;

/** Compile and link the warp, or null (leaving the static portrait) if the driver refuses. */
function buildProgram(gl: WebGLRenderingContext) {
  const compile = (type: number, src: string) => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      console.warn("Chog portrait shader:", gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  };
  const vs = compile(gl.VERTEX_SHADER, VS);
  const fs = compile(gl.FRAGMENT_SHADER, FS);
  const program = vs && fs ? gl.createProgram() : null;
  if (!program || !vs || !fs) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
    console.warn("Chog portrait program:", gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

type Spring = { v: number; x: number };
function spring(s: Spring, target: number, k: number, d: number, dt: number) {
  s.v += (-(s.x - target) * k - s.v * d) * dt;
  s.x += s.v * dt;
}

/** One blink, closing and opening, in seconds. */
const BLINK_S = 0.14;

type Fidget = "hop" | "wiggle" | "glance" | "smug" | "droop";

/**
 * How each archetype moves: how much its head bounces on the beat of its speech, and what it does on
 * its own every few seconds between lines. Golden hops, Night Shift's lids droop, Told-You-So looks smug.
 */
const TEMPER: Record<Archetype, { talk: number; fidgets: Fidget[] }> = {
  "told-you-so": { talk: 1, fidgets: ["smug", "glance"] },
  hype: { talk: 1.8, fidgets: ["hop", "wiggle"] },
  professor: { talk: 1, fidgets: ["glance", "smug"] },
  gremlin: { talk: 1.4, fidgets: ["wiggle", "glance", "hop"] },
  "soap-star": { talk: 1.3, fidgets: ["glance", "smug"] },
  "night-shift": { talk: 0.6, fidgets: ["droop"] },
  golden: { talk: 1.6, fidgets: ["hop", "wiggle"] },
  roommate: { talk: 1, fidgets: ["glance", "smug"] },
  legend: { talk: 0.7, fidgets: ["glance"] },
};
const CALM: { talk: number; fidgets: Fidget[] } = { talk: 1, fidgets: ["glance"] };

/** Below this height (art pixels) the painted mouth stays: no sliver of a viseme, no half patch. */
const MOUTH_SHOWN = 8;

const VIS = {
  closed: [40, 0, 0, 0],
  small: [28, 20, 0.35, 0],
  open: [46, 62, 0.15, 0],
  O: [25, 44, 1, 0],
  ee: [54, 30, 0.05, 1],
};

/**
 * Lip-sync audio graph. iOS Safari and WKWebView only start an AudioContext inside a user gesture,
 * and an element routed through a suspended context goes silent. So the context is created and
 * resumed only from gesture listeners, and an element is connected only once it is running;
 * until then the mouth uses the synthetic flap and the voice plays untouched.
 *
 * A connected element plays only through the graph, so the graph must never stay asleep: the
 * browser suspends it (iOS on a phone call, an alarm or Siri, or in the background), and a studio
 * clip would then play muted. Whenever it leaves "running" the gesture listeners go back on, and a
 * clip starting, the page coming back or a later frame of a playing clip each ask it to resume.
 */
let audioCtx: AudioContext | null = null;
const analysers = new WeakMap<HTMLMediaElement, AnalyserNode>();
/** Engines on screen: the gesture listeners stay on only while one is. */
let enginesMounted = 0;
let gesturesArmed = false;
let lastResumeAsk = 0;

/** Gestures that count as user activation: pointerdown for a mouse, pointerup and touchend for touch. */
const GESTURES = ["pointerdown", "pointerup", "touchend", "keydown"] as const;

/** Ask a sleeping graph to wake. Harmless when it is running, or when the browser says not yet. */
function resumeAudio() {
  const ctx = audioCtx;
  if (!ctx || ctx.state === "running" || ctx.state === "closed") return;
  void ctx.resume().catch(() => undefined);
}

function onAudioState() {
  if (!audioCtx || audioCtx.state === "closed") return;
  if (audioCtx.state === "running") disarmGestures();
  else if (enginesMounted > 0) armGestures();
}

function unlockAudio() {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    if (!audioCtx) {
      audioCtx = new Ctor();
      audioCtx.addEventListener("statechange", onAudioState);
    }
    resumeAudio();
  } catch {
    /* no audio graph: the synthetic flap carries the mouth */
  }
}

function onGesture() {
  unlockAudio();
  if (audioCtx?.state === "running") disarmGestures();
  else void audioCtx?.resume().then(() => (audioCtx?.state === "running" ? disarmGestures() : undefined), () => undefined);
}

function armGestures() {
  if (gesturesArmed) return;
  gesturesArmed = true;
  GESTURES.forEach((type) => window.addEventListener(type, onGesture, { capture: true, passive: true }));
}

function disarmGestures() {
  if (!gesturesArmed) return;
  gesturesArmed = false;
  GESTURES.forEach((type) => window.removeEventListener(type, onGesture, { capture: true }));
}

/**
 * One engine on screen: wake the graph on the next gesture while it is not running, and whenever
 * the page comes back. Returns the detach.
 */
export function attachAudioWake(): () => void {
  enginesMounted += 1;
  if (audioCtx?.state !== "running") armGestures();
  const onVisible = () => {
    if (document.visibilityState === "visible") resumeAudio();
  };
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    enginesMounted -= 1;
    if (enginesMounted === 0) disarmGestures();
    document.removeEventListener("visibilitychange", onVisible);
  };
}

/** The analyser a playing element's voice runs through, connecting it once the graph runs. Null until then. */
export function analyserFor(el: HTMLMediaElement): AnalyserNode | null {
  const existing = analysers.get(el);
  if (existing) {
    if (existing.context.state === "running") return existing;
    // Playing through a sleeping graph: silent until it wakes. Ask at most twice a second.
    const now = performance.now();
    if (now - lastResumeAsk > 500) {
      lastResumeAsk = now;
      resumeAudio();
    }
    return null;
  }
  if (!audioCtx || audioCtx.state !== "running") return null;
  try {
    const source = audioCtx.createMediaElementSource(el);
    const an = audioCtx.createAnalyser();
    an.fftSize = 2048;
    an.smoothingTimeConstant = 0.15;
    source.connect(an);
    an.connect(audioCtx.destination);
    analysers.set(el, an);
    // Every later clip on this element wakes the graph as it starts.
    el.addEventListener("play", resumeAudio);
    return an;
  } catch {
    return null;
  }
}

const SUN: Record<SkyPhase, { wash: string; rim: string; shadow: string }> = {
  dawn: {
    wash: "linear-gradient(198deg, rgba(255,196,150,0.5) 0%, rgba(255,196,150,0.08) 34%, transparent 58%)",
    rim: "inset 12px 16px 28px -14px rgba(255,176,130,0.55)",
    shadow: "0 26px 40px -18px rgba(120,60,40,0.38), 0 8px 16px -12px rgba(40,30,50,0.28)",
  },
  morning: {
    wash: "linear-gradient(188deg, rgba(255,232,196,0.48) 0%, rgba(255,220,180,0.08) 36%, transparent 58%)",
    rim: "inset 0 16px 30px -14px rgba(255,228,190,0.7)",
    shadow: "0 28px 44px -18px rgba(40,50,100,0.4), 0 10px 18px -12px rgba(40,40,70,0.25)",
  },
  day: {
    wash: "linear-gradient(180deg, rgba(255,248,230,0.42) 0%, rgba(255,244,220,0.06) 34%, transparent 56%)",
    rim: "inset 0 14px 26px -14px rgba(255,244,214,0.65)",
    shadow: "0 28px 44px -18px rgba(40,60,110,0.38), 0 10px 18px -12px rgba(40,50,80,0.22)",
  },
  dusk: {
    wash: "linear-gradient(208deg, rgba(255,150,120,0.42) 0%, rgba(255,140,160,0.08) 38%, transparent 60%)",
    rim: "inset -14px 12px 28px -14px rgba(255,150,120,0.5)",
    shadow: "0 26px 40px -16px rgba(80,30,60,0.42), 0 8px 16px -12px rgba(30,20,40,0.3)",
  },
  night: {
    wash: "linear-gradient(214deg, rgba(186,204,255,0.32) 0%, rgba(140,160,230,0.06) 36%, transparent 58%)",
    rim: "inset -16px 10px 26px -12px rgba(190,205,255,0.45)",
    shadow: "0 24px 40px -14px rgba(0,0,0,0.55), 0 8px 16px -10px rgba(0,0,0,0.4)",
  },
};

function canvasOf(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

/** A canvas whose alpha is 255 where `mask` is set: used to cut a lid down to what it may cover. */
function maskCanvas(mask: Uint8Array, w: number, h: number) {
  const c = canvasOf(w, h);
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) if (mask[i]) img.data[i * 4 + 3] = 255;
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Everything one eye needs to draw its lid each frame without allocating. */
type LidSprite = {
  eye: Eye;
  rect: Box;
  fillMask: HTMLCanvasElement;
  lineMask: HTMLCanvasElement;
  work: HTMLCanvasElement;
  line: HTMLCanvasElement;
  fill: string | CanvasPattern;
};

function makeLid(plate: Pixels, eye: Eye, swatch: HTMLCanvasElement | null, skin: string): LidSprite {
  const masks = lidMasks(plate, eye);
  const { rect } = masks;
  const work = canvasOf(rect.w, rect.h);
  const pattern = swatch ? work.getContext("2d")?.createPattern(swatch, "repeat") : null;
  return {
    eye,
    rect,
    fillMask: maskCanvas(masks.fill, rect.w, rect.h),
    lineMask: maskCanvas(masks.shape, rect.w, rect.h),
    work,
    line: canvasOf(rect.w, rect.h),
    fill: pattern ?? skin,
  };
}

/** Draw a lid: real skin (with the art's grain) down to a sagging line, cut to the eye's own pixels. */
function drawLid(ov: CanvasRenderingContext2D, lid: LidSprite, amount: number) {
  if (amount <= 0.01) return;
  const { rect, eye } = lid;
  const work = lid.work.getContext("2d");
  const line = lid.line.getContext("2d");
  if (!work || !line) return;
  work.setTransform(1, 0, 0, 1, 0, 0);
  work.globalCompositeOperation = "source-over";
  work.clearRect(0, 0, rect.w, rect.h);
  work.setTransform(1, 0, 0, 1, -rect.x, -rect.y);
  traceLid(work, eye, amount, "fill");
  work.fillStyle = lid.fill;
  work.fill();
  work.setTransform(1, 0, 0, 1, 0, 0);
  work.globalCompositeOperation = "destination-in";
  work.drawImage(lid.fillMask, 0, 0);

  line.setTransform(1, 0, 0, 1, 0, 0);
  line.globalCompositeOperation = "source-over";
  line.clearRect(0, 0, rect.w, rect.h);
  line.setTransform(1, 0, 0, 1, -rect.x, -rect.y);
  traceLid(line, eye, amount, "line");
  line.strokeStyle = "#121212";
  line.lineCap = "round";
  line.lineWidth = 8;
  line.stroke();
  line.setTransform(1, 0, 0, 1, 0, 0);
  line.globalCompositeOperation = "destination-in";
  line.drawImage(lid.lineMask, 0, 0);

  work.globalCompositeOperation = "source-over";
  work.drawImage(lid.line, 0, 0);
  ov.drawImage(lid.work, rect.x, rect.y);
}

export function ChogEngine({
  textureUrl,
  artId,
  side,
  traits,
  background,
  phase,
  talking,
  sleepy,
  audioRef: externalAudio,
  reactionId,
  onTap,
  onFace,
  debug = false,
  still = false,
  shut = false,
  frozen = null,
  pose = null,
  archetype,
  ringing = false,
}: {
  textureUrl: string;
  artId: number;
  side: Side;
  /** The token's attributes. Without them only the four demo Chogs get painted lids and mouths. */
  traits?: RawTrait[];
  background: string;
  phase: SkyPhase;
  talking: boolean;
  sleepy: boolean;
  audioRef: RefObject<HTMLAudioElement | null>;
  reactionId: number;
  onTap?: (zone: PokeZone) => void;
  /**
   * Told, once the art is read, whether this token got a painted mouth and lids. Where it did not,
   * the warp blinks and talks instead (faceWarp.ts), so every Chog does both.
   */
  onFace?: (face: { mouth: boolean; lids: boolean }) => void;
  /** Draw the eye, patch and mouth boxes (dashed grey when not painted), and the warp's in green. */
  debug?: boolean;
  /** Hold an open mouth with no bob, so a pixel check can read the plate. */
  still?: boolean;
  /** Close the lids fully. Used by the rig check. */
  shut?: boolean;
  /** Freeze the head warp at a known tilt so the overlay can be checked against the art. */
  frozen?: { th: number; bob: number } | null;
  /** Hold the eyes (0 open, 1 the full blink) and the mouth (0 shut, 1 open) still. Used by the rig check. */
  pose?: { blink?: number; jaw?: number } | null;
  /** Its character: how much it bounces when it talks, and what it does on its own (TEMPER). */
  archetype?: Archetype;
  /** A call from it is ringing: it buzzes in bursts, like a phone on a table. */
  ringing?: boolean;
}) {
  const floatRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const glRef = useRef<HTMLCanvasElement>(null);
  const ovRef = useRef<HTMLCanvasElement>(null);
  const talkingRef = useRef(talking);
  const sleepyRef = useRef(sleepy);
  const reactionRef = useRef(reactionId);
  const onTapRef = useRef(onTap);
  const onFaceRef = useRef(onFace);
  const audioRef = useRef(externalAudio);
  const poseRef = useRef(pose);
  const archetypeRef = useRef(archetype);
  const ringingRef = useRef(ringing);
  /** Bumped when a lost WebGL context comes back, to rebuild the portrait on it. */
  const [epoch, setEpoch] = useState(0);
  /** The run whose warp is on screen; any other run shows the static image. */
  const [live, setLive] = useState<string | null>(null);
  const [painted, setPainted] = useState<{ key: string; mouth: boolean; lids: boolean } | null>(null);

  const traitsKey = faceTraitsKey(faceTraits(traits));
  const frozenKey = frozen ? `${frozen.th},${frozen.bob}` : "";
  // A failed portrait is tried again (with a fresh URL, so the <img> really refetches).
  const { url: src, retrying, hidden: artBroken, fail: artFail, loaded: artShown } = useArtRetry(textureUrl);
  const hat = useMemo(() => hatLineFor(artId, side, rigFor(artId, side, faceTraitsFromKey(traitsKey)).rig.eyes), [artId, side, traitsKey]);
  const runKey = [src, artId, side, background, traitsKey, debug, still, shut, frozenKey, epoch].join("|");
  const portraitLive = live === runKey;
  const paint = painted?.key === runKey ? painted : null;

  // The animation loop reads the live props through refs, so changing them never restarts it.
  useEffect(() => {
    talkingRef.current = talking;
    sleepyRef.current = sleepy;
    reactionRef.current = reactionId;
    onTapRef.current = onTap;
    onFaceRef.current = onFace;
    audioRef.current = externalAudio;
    poseRef.current = pose;
    archetypeRef.current = archetype;
    ringingRef.current = ringing;
  });

  useEffect(() => attachAudioWake(), []);

  useEffect(() => {
    const canvas = glRef.current;
    const overlay = ovRef.current;
    const card = cardRef.current;
    const floatEl = floatRef.current;
    if (!canvas || !overlay || !card || !floatEl) return;
    canvas.width = W;
    canvas.height = H;
    overlay.width = W;
    overlay.height = H;
    // Same attributes on every run: a getContext with different ones returns null.
    const gl = canvas.getContext("webgl", { premultipliedAlpha: false, alpha: true });
    const ov = overlay.getContext("2d");
    if (!gl || !ov || gl.isContextLost()) return;

    let dead = false;
    let raf = 0;
    // Stops the art's second read (decodedArt) when this run ends.
    const ended = new AbortController();
    const onLost = (event: Event) => {
      event.preventDefault();
      dead = true;
      ended.abort();
      cancelAnimationFrame(raf);
      setLive(null);
    };
    const onRestored = () => setEpoch((n) => n + 1);
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
    // Reduced motion is read live: turning it on mid-call calms the Chog at once.
    const motionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let reduced = motionQuery?.matches ?? false;
    const onMotionPref = () => {
      reduced = motionQuery?.matches ?? false;
    };
    motionQuery?.addEventListener?.("change", onMotionPref);
    const unlisten = () => {
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      motionQuery?.removeEventListener?.("change", onMotionPref);
    };

    const program = buildProgram(gl);
    if (!program) return unlisten;
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = {
      th: gl.getUniformLocation(program, "th"),
      bob: gl.getUniformLocation(program, "bob"),
      br: gl.getUniformLocation(program, "br"),
      pivot: gl.getUniformLocation(program, "pivot"),
      headBand: gl.getUniformLocation(program, "headBand"),
      bodyBand: gl.getUniformLocation(program, "bodyBand"),
      face: gl.getUniformLocation(program, "face"),
    };
    const warpLoc = {
      eyeBoxA: gl.getUniformLocation(program, "eyeBoxA"),
      eyeExtA: gl.getUniformLocation(program, "eyeExtA"),
      eyeBoxB: gl.getUniformLocation(program, "eyeBoxB"),
      eyeExtB: gl.getUniformLocation(program, "eyeExtB"),
      jawM: gl.getUniformLocation(program, "jawM"),
      jawK: gl.getUniformLocation(program, "jawK"),
    };
    // The warp face is known before the art arrives: set it now, still (face = 0) until the loop runs.
    const warp: FaceWarp = warpFor(artId, side, faceTraitsFromKey(traitsKey));
    const warpU = warpUniforms(warp);
    for (const key of Object.keys(warpLoc) as Array<keyof typeof warpLoc>) gl.uniform4fv(warpLoc[key], warpU[key]);
    gl.uniform2f(u.face, 0, 0);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    let last = 0;
    let now = 0;
    let nextBlink = 0.8 + Math.random() * 1.4;
    let blinkT = -1;
    let doubleBlink = false;
    let smug = 0;
    let smugT = 0;
    let amp = 0;
    let probes = 0;
    let frameNo = 0;
    let nextFidget = 4 + Math.random() * 4;
    let fidgets = 0;
    let carry = 0;
    let idle = false;
    const sq: Spring = { v: 0, x: 0 };
    const tilt: Spring = { v: 0, x: 0 };
    const jump: Spring = { v: 0, x: 0 };
    const mp = { w: 40, h: 0, r: 0, t: 0 };
    let seenReaction = 0;
    let timeBuf = new Float32Array(2048);
    let freqBuf = new Float32Array(1024);
    let lids: LidSprite[] = [];
    /** Where nothing is painted, the warp blinks and talks (decided once the art is read). */
    let warpBlink = false;
    let warpJaw = false;
    let debugEyes: Eye[] = [];
    let debugPatch: Box | null = null;
    let mouthBox: Box | null = null;
    let patchCanvas: HTMLCanvasElement | null = null;
    let patchAt: Point = [0, 0];
    let pivot: Point = [500, 680];
    let head: Point = [730, 830];
    let body: [number, number, number] = [790, 900, 990];
    let revealed = false;
    let overlayShown = true;
    overlay.style.visibility = "";

    const feats = (): [number, number, number] => {
      const el = audioRef.current?.current;
      const playing = Boolean(el && !el.paused && el.currentTime > 0);
      const an = el && playing ? analyserFor(el) : null;
      if (an) {
        if (timeBuf.length !== an.fftSize) {
          timeBuf = new Float32Array(an.fftSize);
          freqBuf = new Float32Array(an.frequencyBinCount);
        }
        an.getFloatTimeDomainData(timeBuf);
        let sum = 0;
        for (const v of timeBuf) sum += v * v;
        const level = Math.min(1, Math.sqrt(sum / timeBuf.length) / 0.32);
        an.getFloatFrequencyData(freqBuf);
        const bw = an.context.sampleRate / an.fftSize;
        let lo = 0;
        let hi = 0;
        let num = 0;
        let den = 0;
        for (let k = 1; k < freqBuf.length; k++) {
          const f = k * bw;
          const m = Math.pow(10, freqBuf[k] / 20);
          if (f >= 100 && f < 8000) {
            num += f * m;
            den += m;
          }
          if (f >= 150 && f < 900) lo += m;
          else if (f >= 2000 && f < 6000) hi += m;
        }
        return [level, num / (den || 1), hi / (lo || 1e-9)];
      }
      // No running audio graph (yet): flap the mouth to the syllable rhythm instead.
      if (talkingRef.current || playing) {
        const step = now * (sleepyRef.current ? 4.2 : 6.2);
        const syl = Math.floor(step);
        const on = step % 1 < 0.58;
        return [on ? 0.4 + (syl % 3) * 0.16 : 0.02, 480 + (syl % 5) * 280, 0.28 + (syl % 4) * 0.24];
      }
      return [0, 0, 0];
    };

    const viseme = (dt: number) => {
      const [a, c, ratio] = feats();
      const front = Math.max(-1, Math.min(1, Math.log2((ratio || 0.47) / 0.47) / 1.6));
      const weights: Record<string, number> = {};
      if (a < 0.08) weights.closed = 1;
      else {
        const o = Math.min(1, Math.pow((a - 0.08) / 0.4, 0.8) || 0);
        const fe = Math.max(0, front) * 0.75;
        const fo = Math.max(0, -front) * (c < 1300 ? 1 : 0.5);
        weights.small = (1 - o) * (1 - fe) * (1 - fo);
        weights.open = o * (1 - fe) * (1 - fo);
        weights.ee = fe;
        weights.O = fo;
      }
      const tgt = [0, 0, 0, 0];
      for (const key of Object.keys(weights)) {
        const shape = VIS[key as keyof typeof VIS];
        for (let j = 0; j < 4; j++) tgt[j] += shape[j] * weights[key];
      }
      const ease = (cur: number, target: number) => cur + (target - cur) * Math.min(1, dt * (target > cur ? 30 : 16));
      mp.w = ease(mp.w, tgt[0]);
      mp.h = ease(mp.h, tgt[1]);
      mp.r = ease(mp.r, tgt[2]);
      mp.t = ease(mp.t, tgt[3]);
      return a;
    };

    /**
     * The skin patch goes under the lids (a wide patch can reach an eye's corner), the viseme over.
     * A cartoon mouth swap, never a cross-fade: a half-faded patch let the painted smile show
     * through as a grey ghost under a thin bar, so below MOUTH_SHOWN the art's own mouth is
     * shown, and above it the patch is fully opaque.
     */
    const mouthShown = () => Boolean(mouthBox) && mp.h >= MOUTH_SHOWN;
    const drawPatch = () => {
      if (!patchCanvas || !mouthShown()) return;
      ov.drawImage(patchCanvas, patchAt[0], patchAt[1]);
    };
    const drawViseme = () => {
      if (mouthBox && mouthShown()) paintViseme(ov, mouthBox, mp);
    };

    const drawDebug = () => {
      ov.save();
      ov.lineWidth = 3;
      const stroke = (box: Box, color: string, on: boolean) => {
        ov.strokeStyle = on ? color : "rgba(120,120,120,0.9)";
        ov.setLineDash(on ? [] : [10, 8]);
        ov.strokeRect(box.x, box.y, box.w, box.h);
      };
      for (const eye of debugEyes) stroke(eye, "rgba(0,170,255,0.95)", lids.length > 0);
      if (debugPatch) stroke(debugPatch, "rgba(255,140,0,0.95)", Boolean(mouthBox));
      if (mouthBox) stroke(mouthBox, "rgba(255,0,150,0.95)", true);
      // The warp's boxes: solid green where it is the one blinking or talking, dashed where painted.
      for (const eye of warp.eyes) stroke(eye, "rgba(40,200,90,0.95)", warpBlink);
      stroke(warp.mouth, "rgba(40,200,90,0.95)", warpJaw);
      ov.restore();
    };

    /** One frame. Returns true when nothing is moving, so the loop can ease off. */
    const frame = (dt: number) => {
      now += dt;
      if (reactionRef.current !== seenReaction) {
        const variant = reactionRef.current;
        seenReaction = variant;
        if (variant % 3 === 1) {
          sq.v += 5;
          tilt.v -= 1.6;
          smugT = 1.8;
        } else if (variant % 3 === 2) {
          sq.v -= 7;
          jump.v -= 640;
          tilt.v += 2;
        } else {
          sq.v -= 9;
          jump.v -= 900;
          tilt.v += (variant % 2 === 0 ? -1 : 1) * 1.2;
        }
      }
      // Now and then it does something on its own, in character: never while it talks or rings.
      const temper = (archetypeRef.current && TEMPER[archetypeRef.current]) || CALM;
      if (!reduced && !still && !frozen && !poseRef.current && now > nextFidget) {
        nextFidget = now + 5 + Math.random() * 6;
        if (!talkingRef.current && !ringingRef.current) {
          const move = temper.fidgets[fidgets % temper.fidgets.length];
          fidgets += 1;
          if (move === "hop") {
            sq.v -= 5;
            jump.v -= 420;
          } else if (move === "wiggle") {
            tilt.v += fidgets % 2 ? 2.4 : -2.4;
            sq.v += 2;
          } else if (move === "glance") {
            tilt.v += fidgets % 2 ? 1.1 : -1.1;
          } else if (move === "smug") {
            smugT = 1.4;
          } else {
            smugT = 2.4;
            sq.v += 2;
          }
        }
      }
      if (blinkT < 0 && now > nextBlink) {
        blinkT = 0;
        doubleBlink = Math.random() < 0.18;
      }
      let b = 0;
      if (blinkT >= 0) {
        blinkT += dt;
        const x = blinkT / BLINK_S;
        b = x < 0.45 ? x / 0.45 : x < 1 ? 1 - (x - 0.45) / 0.55 : 0;
        b = Math.pow(Math.max(0, b), 0.8);
        if (x >= 1) {
          if (doubleBlink) {
            doubleBlink = false;
            blinkT = 0;
          } else {
            blinkT = -1;
            nextBlink = now + (sleepyRef.current ? 3.6 : 3) + Math.random() * 3;
          }
        }
      }
      smugT = Math.max(0, smugT - dt);
      const smugLid = smugT > 0 ? Math.min(1, smugT * 3) * 0.38 : 0;
      smug += (smugLid - smug) * Math.min(1, dt * 10);
      spring(sq, 0, 180, 9, dt);
      spring(jump, 0, 160, 11, dt);
      spring(tilt, 0, 40, 6, dt);
      const level = viseme(dt);
      const held = poseRef.current;
      if (held?.jaw !== undefined) {
        const open = Math.min(1, Math.max(0, held.jaw));
        mp.w = VIS.closed[0] + (VIS.open[0] - VIS.closed[0]) * open;
        mp.h = VIS.open[1] * open;
        mp.r = VIS.open[2] * open;
        mp.t = 0;
      } else if (still || frozen) {
        mp.w = 46;
        mp.h = 62;
        mp.r = 0.15;
        mp.t = 0;
      }
      amp += (level - amp) * Math.min(1, dt * (level > amp ? 28 : 14));
      const breathe = Math.sin((now * 2 * Math.PI) / (sleepyRef.current ? 6.4 : 4.2));
      const motion = reduced ? 0.25 : 1;
      const th = frozen ? frozen.th : still ? 0 : motion * (0.018 * Math.sin(now * 0.9) + 0.008 * Math.sin(now * 2.3 + 1) + tilt.x * 0.2 + amp * 0.02 * Math.sin(now * 9));
      const beat = Math.abs(Math.sin(now * 7));
      const bob = frozen ? frozen.bob : still ? 0 : motion * (-breathe * 5 - amp * 6 * temper.talk * beat);
      // The whole card leans into the louder syllables, more for a loud character than a quiet one.
      const talkPulse = frozen || still ? 0 : motion * amp * 0.03 * temper.talk * beat;
      // Ringing: short fast buzzes with rests between, like a phone vibrating on a table.
      const buzz = ringingRef.current && !reduced && !frozen && !still && Math.sin(now * 2.6) > 0.1 ? Math.sin(now * 75) * 2.6 : 0;
      gl.viewport(0, 0, W, H);
      gl.uniform1f(u.th, th);
      gl.uniform1f(u.bob, bob);
      gl.uniform1f(u.br, reduced ? 0 : 0.012 * (breathe * 0.5 + 0.5));
      gl.uniform2f(u.pivot, pivot[0], pivot[1]);
      gl.uniform2f(u.headBand, head[0], head[1]);
      gl.uniform3f(u.bodyBand, body[0], body[1], body[2]);
      const rest = sleepyRef.current ? 0.42 : 0;
      const eyeAmount = held?.blink !== undefined ? Math.min(1, Math.max(0, held.blink)) : shut ? 1 : Math.max(b, smug, rest);
      // The warp blinks where no lids are painted and opens the jaw where no mouth is painted.
      gl.uniform2f(u.face, warpBlink ? eyeAmount : 0, warpJaw ? Math.min(1, mp.h / VIS.open[1]) : 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (!revealed && !gl.isContextLost()) {
        // Read right after the draw, in the same task: no preserveDrawingBuffer needed.
        probes++;
        const probe = new Uint8Array(4);
        const spots: Array<[number, number]> = [
          [W / 2, H / 2],
          [W / 2, H * 0.62],
          [W * 0.38, H * 0.55],
          [W * 0.62, H * 0.42],
        ];
        for (const [x, y] of spots) {
          gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, probe);
          if (probe[3] > 16 && probe[0] + probe[1] + probe[2] > 12) {
            revealed = true;
            setLive(runKey);
            break;
          }
        }
      }
      ov.setTransform(1, 0, 0, 1, 0, 0);
      ov.clearRect(0, 0, W, H);
      ov.translate(0, bob);
      ov.translate(pivot[0], pivot[1]);
      ov.rotate(th);
      ov.translate(-pivot[0], -pivot[1]);
      const shows = revealed && (debug || mouthShown() || (lids.length > 0 && eyeAmount > 0.01));
      // A fully cleared overlay is hidden, not just left empty: Chromium can keep compositing the
      // last frame of a canvas that was only cleared (an open mouth stayed on a ringing call).
      if (shows !== overlayShown) {
        overlayShown = shows;
        overlay.style.visibility = shows ? "" : "hidden";
      }
      if (shows) {
        drawPatch();
        for (const lid of lids) drawLid(ov, lid, eyeAmount);
        drawViseme();
        if (debug) drawDebug();
      }
      // Output gains sized so a poke reads at phone size: about 4% squash, a 13 px hop, a 2 to 4 degree tilt.
      // With reduced motion a poke still answers, at a quarter of the size.
      const squash = sq.x * 0.08 * motion;
      const j = jump.x * 0.3 * motion;
      const driftX = reduced ? 0 : Math.sin(now * 0.17) * 7;
      const driftY = reduced ? 0 : Math.cos(now * 0.12) * 4;
      floatEl.style.transform = `translate3d(${driftX + buzz}px, ${j + driftY}px, 0)`;
      card.style.transform = `rotate(${tilt.x * 7 * motion + buzz * 0.35}deg) scale(${1 - squash + talkPulse}, ${1 + squash + breathe * 0.003 * motion + talkPulse})`;
      return !ringingRef.current && blinkT < 0 && smugT <= 0 && Math.abs(sq.x) + Math.abs(tilt.x) + Math.abs(jump.x) * 0.02 < 0.02 && amp < 0.01 && mp.h < 1;
    };

    const boot = async () => {
      try {
        let art: HTMLImageElement;
        try {
          art = await loadImage(src);
        } catch {
          // Gateways stall. Try again in a moment; the arch keeps its colour meanwhile.
          if (!dead) artFail(src);
          return;
        }
        if (dead) return;
        artShown(src);
        const source = await decodedArt(src, art, ended.signal);
        const plate = dead ? null : canvasOf(W, H);
        const pctx = plate?.getContext("2d", { willReadFrequently: true });
        if (!pctx) {
          // Unmounted meanwhile, or no 2D canvas: the bitmap's memory goes back either way.
          if (source !== art) (source as ImageBitmap).close();
          return;
        }
        pctx.fillStyle = background;
        pctx.fillRect(0, 0, W, H);
        const fit = Math.min(W / art.width, H / art.height);
        const dw = art.width * fit;
        const dh = art.height * fit;
        pctx.drawImage(source, (W - dw) / 2, (H - dh) / 2, dw, dh);
        if (source !== art) (source as ImageBitmap).close();
        const plateData = pctx.getImageData(0, 0, W, H);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        // The pixels just read, not the canvas: the same texture, without reading the canvas twice.
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, plateData);
        // Reading the face is its own task, so a frame (or a tap) can land between the two.
        await yieldToMain();
        if (dead) return;

        const choice = rigFor(artId, side, faceTraitsFromKey(traitsKey));
        const rig = choice.rig;
        pivot = rig.pivot;
        head = rig.head;
        body = rig.body;
        debugEyes = rig.eyes;
        debugPatch = choice.paintMouth ? (rig.patch ?? null) : null;
        const skinRgb = sampleSkin(plateData, rig.skin, parseColor(background));
        const grain = skinSwatch(plateData, rig.skin, skinRgb);
        if (choice.paintMouth) {
          // The token itself must match its group: a hat, hand or laser over the mouth stops it.
          const open = openMouth(plateData, rig, skinRgb, grain);
          if (open) {
            mouthBox = open.box;
            if (open.patch) {
              const stamp = canvasOf(open.patch.image.width, open.patch.image.height);
              stamp.getContext("2d")?.putImageData(open.patch.image, 0, 0);
              patchCanvas = stamp;
              patchAt = [open.patch.x, open.patch.y];
            }
          }
        }
        const eyesFit = rig.eyes.every((eye, i) => fits(featureHole(plateData, eye, skinRgb, EYE_PAD), rig.eyeExpect?.[i]));
        if (choice.paintLids && paintableSkin(skinRgb) && eyesFit) {
          let swatch: HTMLCanvasElement | null = null;
          if (grain) {
            swatch = canvasOf(grain.width, grain.height);
            swatch.getContext("2d")?.putImageData(grain as ImageData, 0, 0);
          }
          lids = rig.eyes.map((eye) => makeLid(plateData, eye, swatch, rgbCss(skinRgb)));
        }
        warpBlink = lids.length === 0;
        warpJaw = !mouthBox;
        if (dead) return;
        setPainted({ key: runKey, mouth: Boolean(mouthBox), lids: lids.length > 0 });
        onFaceRef.current?.({ mouth: Boolean(mouthBox), lids: lids.length > 0 });
        const loop = (t: number) => {
          if (dead) return;
          const dt = Math.min(0.05, (t - (last || t)) / 1000);
          last = t;
          if (!revealed && probes >= REVEAL_FRAMES) return; // the warp never showed: keep the static image
          raf = requestAnimationFrame(loop);
          if (document.hidden && !talkingRef.current && revealed) return;
          // At rest, with nothing moving, half the frame rate is plenty.
          frameNo++;
          if (idle && frameNo % 2 === 1) {
            carry += dt;
            return;
          }
          idle = frame(Math.min(0.1, dt + carry));
          carry = 0;
        };
        raf = requestAnimationFrame(loop);
      } catch {
        /* the art loaded but could not be read: the static image stays */
      }
    };
    void boot();
    return () => {
      dead = true;
      ended.abort();
      cancelAnimationFrame(raf);
      unlisten();
      if (!gl.isContextLost()) {
        gl.deleteTexture(texture);
        gl.deleteProgram(program);
        gl.deleteBuffer(buffer);
      }
    };
  }, [src, artFail, artShown, artId, side, background, traitsKey, debug, still, shut, frozen, runKey]);

  const sun = SUN[phase];
  return (
    <div
      className="relative h-full w-full"
      data-portrait={portraitLive ? "live" : "static"}
      data-mouth={paint ? (paint.mouth ? "painted" : "none") : undefined}
      data-lids={paint ? (paint.lids ? "painted" : "none") : undefined}
      data-blink={paint ? (paint.lids ? "lids" : "warp") : undefined}
      data-jaw={paint ? (paint.mouth ? "painted" : "warp") : undefined}
      data-talking={talking ? "yes" : "no"}
      onPointerDown={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width;
        const y = (event.clientY - rect.top) / rect.height;
        onTapRef.current?.(pokeZone(x, y, hat));
      }}
    >
      <div ref={floatRef} className="absolute inset-0">
        <div className="pointer-events-none absolute -bottom-3 left-[10%] right-[10%] h-8 rounded-full bg-[radial-gradient(ellipse,rgba(24,28,58,0.42),transparent_72%)] blur-md" />
        {/* The card itself is white and the art sits 2px inside it, under the ring: on a tilted,
            scaled card the anti-aliased outer edge then shows only white, never a hairline of
            background or the art's bottom row below the ring. */}
        <div
          ref={cardRef}
          className="absolute inset-0 overflow-hidden rounded-[999px_999px_36px_36px] bg-white"
          style={{ boxShadow: sun.shadow }}
        >
          <div className="absolute inset-[2px] overflow-hidden rounded-[inherit]" style={{ background }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- the static fallback must be the exact texture URL the warp loads */}
            <img
              src={src}
              alt=""
              onLoad={() => artShown(src)}
              onError={() => artFail(src)}
              className={`absolute inset-0 h-full w-full object-cover ${portraitLive || artBroken ? "opacity-0" : ""}`}
            />
            <canvas ref={glRef} className={`absolute inset-0 h-full w-full ${portraitLive ? "" : "opacity-0"}`} />
            <canvas ref={ovRef} className={`pointer-events-none absolute inset-0 h-full w-full ${portraitLive ? "" : "opacity-0"}`} />
            <div className="pointer-events-none absolute inset-0" style={{ background: sun.wash, mixBlendMode: "soft-light" }} />
            {retrying && (
              <div role="status" className="pointer-events-none absolute inset-0 grid place-items-center">
                <span className="rounded-full bg-white/80 px-4 py-2 text-[14px] font-semibold tracking-[0.01em] text-[#1d2340]/70 shadow-[0_10px_24px_-16px_rgba(24,30,72,0.6)] motion-safe:animate-pulse">
                  Calling Chog #{artId}…
                </span>
              </div>
            )}
          </div>
          <div
            className="pointer-events-none absolute inset-0 rounded-[inherit]"
            style={{ boxShadow: `inset 0 0 0 6px #fff, ${sun.rim}` }}
          />
        </div>
      </div>
    </div>
  );
}
