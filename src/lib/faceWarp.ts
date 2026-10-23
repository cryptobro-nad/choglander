import warpJson from "../../public/chog/face-warp.json";
import rigsJson from "../../public/chog/face-rig.json";
import type { Box, FaceTraits } from "@/lib/faceRig";
import type { Side } from "@/lib/types";

/**
 * The warp face: where a portrait blinks and talks by moving the art's own pixels.
 *
 * The painted lids and mouth (faceRig.rigFor, facePaint) need to know a face to the pixel, so they
 * are only drawn on measured groups. The warp only needs to know roughly where the eyes and the
 * mouth are: a blink squashes the eye region toward a line across it, and talking stretches the
 * art around the mouth line and drops the chin. Nothing new is drawn, so a box that is a little
 * off moves a little skin instead of painting a feature in the wrong place. Every Chog gets one:
 * its Origin trait group when measured, else its Base and Side, and the one-of-ones their own
 * (public/chog/face-warp.json, written by scripts/measure_warp.py).
 */

export type WarpEye = Box & {
  /** How far a full blink squashes this box: 0.62 leaves 38% of its height. */
  depth: number;
  /** Where across the box the squash closes, from its top (0) to its bottom (1). */
  line: number;
  /** How much of the eye below the line closes too: 1, or 0 for a laser, whose beam leaves below it. */
  lower: number;
};
export type WarpMouth = Box & {
  /** How far below the mouth line the chin drop fades out, in art pixels. */
  chin: number;
  /** Share of the full jaw drop: less where a laser beam crosses the mouth, so it barely bends. */
  gain: number;
};
export type FaceWarp = {
  /** One or two boxes, left to right. A visor or glasses is one box. */
  eyes: WarpEye[];
  mouth: WarpMouth;
  /** Where the boxes came from, for the rig page. */
  from: "art" | "group" | "base";
};

type Rect = [number, number, number, number];
type WarpTable = {
  bases: Record<string, { eyes: Rect[]; mouth: Rect; chin?: number }>;
  eyes: Record<string, { eyes: Rect[]; depth?: number; line?: number; lower?: number }>;
  mouths: Record<string, Rect>;
  arts: Record<string, { eyes: Rect[]; mouth: Rect; chin?: number }>;
};

const TABLE = warpJson as unknown as WarpTable;
const DEMO = rigsJson as unknown as Record<string, { traits: { side: Side; mouth: string; eyes: string } }>;

/** A blink squashes the eye to this share of its height at the peak. */
export const EYE_DEPTH = 0.62;
/** The squash closes on a line this far down the eye box: high, so a hat brim just above the eye barely moves. */
export const EYE_LINE = 0.3;
/**
 * A laser eye closes from above onto its middle, where the beam starts, and leaves the rest still:
 * squashing the beam itself would bend it.
 */
export const LASER_LINE = 0.5;
/** A laser beam runs across the mouth: a smaller jaw keeps it from kinking as the Chog talks. */
export const LASER_JAW = 0.6;
export const CHIN = 130;

const rect = ([x, y, w, h]: Rect): Box => ({ x, y, w, h });

/** The warp face for a portrait. Never empty: the Side's template is the floor. */
export function warpFor(artId: number, side: Side, traits?: FaceTraits): FaceWarp {
  const art = TABLE.arts[String(artId)];
  if (art) {
    return {
      eyes: art.eyes.map((eye) => ({ ...rect(eye), depth: EYE_DEPTH, line: EYE_LINE, lower: 1 })),
      mouth: { ...rect(art.mouth), chin: art.chin ?? CHIN, gain: 1 },
      from: "art",
    };
  }
  const demo = DEMO[String(artId)];
  const face: FaceTraits = demo ? { ...demo.traits, base: "Origin" } : (traits ?? {});
  const faceSide: Side = face.side === "Left" || face.side === "Right" ? face.side : side;
  const baseKey = `${face.base ?? "Origin"}|${faceSide}`;
  const origin = baseKey === `Origin|${faceSide}`;
  const base = TABLE.bases[baseKey] ?? TABLE.bases[`Origin|${faceSide}`];
  // Only Origin art shares the eye and mouth layers the groups were measured on.
  const eyeGroup = origin && face.eyes ? TABLE.eyes[`${faceSide}|${face.eyes}`] : undefined;
  const mouthGroup = origin && face.mouth ? TABLE.mouths[`${faceSide}|${face.mouth}`] : undefined;
  // Skull and Radioactive lasers have no group of their own but still start their beams mid-eye.
  const laser = /laser/i.test(face.eyes ?? "");
  const line = eyeGroup?.line ?? (laser ? LASER_LINE : EYE_LINE);
  const lower = eyeGroup?.lower ?? (laser ? 0 : 1);
  return {
    eyes: (eyeGroup?.eyes ?? base.eyes).map((eye) => ({ ...rect(eye), depth: eyeGroup?.depth ?? EYE_DEPTH, line, lower })),
    mouth: { ...rect(mouthGroup ?? base.mouth), chin: base.chin ?? CHIN, gain: laser ? LASER_JAW : 1 },
    from: eyeGroup || mouthGroup ? "group" : "base",
  };
}

export type Vec4 = [number, number, number, number];

/**
 * One eye's shader parameters. box: centre x, the closing line, half width, depth.
 * ext: how far the eye reaches above and below the line, and the skin margins that stretch over
 * the space it leaves.
 */
export function eyeParams(eye: WarpEye): { box: Vec4; ext: Vec4 } {
  const close = eye.y + eye.h * eye.line;
  const up = close - eye.y;
  const down = (eye.y + eye.h - close) * eye.lower;
  return { box: [eye.x + eye.w / 2, close, eye.w / 2, eye.depth], ext: [up, down, Math.max(24, up), Math.max(24, down)] };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The upper lip lifts this share of the jaw drop. */
export const LIP_LIFT = 0.3;

/**
 * The jaw's shader parameters. m: mouth centre, half width of the moving region, half height of
 * the stretch. k: the full drop in pixels, how far it fades above and below, and the lip lift.
 * The drop is capped so the stretch never folds: its steepest slope stays below 1.
 */
export function jawParams(mouth: WarpMouth): { m: Vec4; k: Vec4 } {
  const half = clamp(mouth.h * 0.45, 16, 40);
  const drop = Math.min(clamp(mouth.h * 0.3, 14, 26), half * 0.7) * mouth.gain;
  return {
    m: [mouth.x + mouth.w / 2, mouth.y + mouth.h / 2, Math.max(mouth.w / 2 + 60, 120), half],
    k: [drop, clamp(mouth.h * 0.8, 40, 80), mouth.chin, LIP_LIFT],
  };
}

/** Every uniform the warp needs. A face with one eye box repeats it with no depth. */
export function warpUniforms(face: FaceWarp) {
  const [a, b = { ...face.eyes[0], depth: 0 }] = face.eyes;
  const eyeA = eyeParams(a);
  const eyeB = eyeParams(b);
  const jaw = jawParams(face.mouth);
  return { eyeBoxA: eyeA.box, eyeExtA: eyeA.ext, eyeBoxB: eyeB.box, eyeExtB: eyeB.ext, jawM: jaw.m, jawK: jaw.k };
}

export type WarpUniforms = ReturnType<typeof warpUniforms>;

function smoothstep(e0: number, e1: number, x: number) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** The vertical shift an eye squash puts on the art pixel shown at (x, y). Mirrors the shader. */
function squash(x: number, y: number, box: Vec4, ext: Vec4, blink: number) {
  const s = 1 - box[3] * blink;
  const t = y - box[1];
  const reach = t <= 0 ? ext[0] : ext[1];
  const margin = t <= 0 ? ext[2] : ext[3];
  const a = Math.abs(t);
  const e = reach * s;
  const src = a < e ? a / s : a < reach + margin ? reach + ((a - e) * margin) / (reach + margin - e) : a;
  const wx = 1 - smoothstep(0.7 * box[2], 1.35 * box[2], Math.abs(x - box[0]));
  return Math.sign(t) * (src - a) * wx;
}

/** The vertical shift the jaw puts on the art pixel shown at (x, y). Mirrors the shader. */
function jawShift(x: number, y: number, m: Vec4, k: Vec4, open: number) {
  const t = y - m[1];
  const fade = t > 0 ? k[2] : k[1];
  const drop = open * k[0] * (-k[3] + (1 + k[3]) * smoothstep(-m[3], m[3], t)) * (1 - smoothstep(m[3], m[3] + fade, Math.abs(t)));
  const wx = 1 - smoothstep(0.6 * m[2], m[2], Math.abs(x - m[0]));
  return -drop * wx;
}

/**
 * Which art row the warp shows at (x, y), for a blink and a jaw opening from 0 to 1. The shader in
 * ChogEngine computes exactly this; the tests use it to check the warp never folds or tears.
 */
export function warpSourceY(x: number, y: number, u: WarpUniforms, blink: number, open: number) {
  // Applied one after another, not summed: each step keeps the rows in order, so where an eye's
  // margin meets the jaw the two never fold the art between them.
  let row = y + jawShift(x, y, u.jawM, u.jawK, open);
  row += squash(x, row, u.eyeBoxA, u.eyeExtA, blink);
  row += squash(x, row, u.eyeBoxB, u.eyeExtB, blink);
  return row;
}

/** GLSL for the same warp. `q` is in art pixels; returns the art row to sample. */
export const WARP_GLSL = `
uniform vec4 eyeBoxA, eyeExtA, eyeBoxB, eyeExtB, jawM, jawK; uniform vec2 face;
float squash(vec2 q, vec4 box, vec4 ext){
  float s = 1.0 - box.w * face.x;
  float t = q.y - box.y;
  float up = step(t, 0.0);
  float reach = mix(ext.y, ext.x, up);
  float margin = mix(ext.w, ext.z, up);
  float a = abs(t);
  float e = reach * s;
  float src = a < e ? a / s : (a < reach + margin ? reach + (a - e) * margin / (reach + margin - e) : a);
  float wx = 1.0 - smoothstep(0.7 * box.z, 1.35 * box.z, abs(q.x - box.x));
  return sign(t) * (src - a) * wx;
}
float jawShift(vec2 q){
  float t = q.y - jawM.y;
  float fade = t > 0.0 ? jawK.z : jawK.y;
  float drop = face.y * jawK.x * (mix(-jawK.w, 1.0, smoothstep(-jawM.w, jawM.w, t))) * (1.0 - smoothstep(jawM.w, jawM.w + fade, abs(t)));
  float wx = 1.0 - smoothstep(0.6 * jawM.z, jawM.z, abs(q.x - jawM.x));
  return -drop * wx;
}
float faceRow(vec2 q){
  q.y += jawShift(q);
  q.y += squash(q, eyeBoxA, eyeExtA);
  return q.y + squash(q, eyeBoxB, eyeExtB);
}
`;
