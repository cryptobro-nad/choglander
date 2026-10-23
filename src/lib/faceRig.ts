import rigsJson from "../../public/chog/face-rig.json";
import groupsJson from "../../public/chog/face-groups.json";
import type { RawTrait, Side } from "@/lib/types";

/** A rectangle in the 1000×1000 art, y down. */
export type Box = { x: number; y: number; w: number; h: number };

/** An eye's silhouette: row-major run lengths over its rect, starting with a run of "outside". */
export type EyeMask = Box & { rle: number[] };

/** An eye box. The lid travels from its top to near its bottom; `mask` limits what it may cover. */
export type Eye = Box & { sag?: number; mask?: EyeMask };

/** What a token in this group looks like around a feature, so a hat, hand or laser can be caught. */
export type Expect = { area: number; band: number };

export type FaceRig = {
  pivot: [number, number];
  /** Warp stays full until head[0], so the painted features move with the art. */
  head: [number, number];
  body: [number, number, number];
  eyes: Eye[];
  /** One per eye, from the group measurement. */
  eyeExpect?: Expect[];
  /** Where the open viseme is drawn. */
  mouth: Box;
  /** The painted mouth layer that the skin patch erases. Defaults to `mouth`. */
  patch?: Box;
  /** False draws the viseme over the intact art, with no skin patch. */
  inpaint?: boolean;
  mouthExpect?: Expect;
  /** Tiles that are bare skin on nearly every token of this Side. */
  skin: Box[];
};

/** The traits that decide a face, as read from a token's attributes. */
export type FaceTraits = { side?: string; mouth?: string; eyes?: string; base?: string };

export type RigChoice = { rig: FaceRig; paintMouth: boolean; paintLids: boolean };

type GroupEyes = { eyes: Eye[]; area: number[]; band: number[] };
type GroupMouth = { mouth: Box; patch: Box; area: number; band: number; inpaint?: boolean };
type FaceGroups = {
  sides: Record<Side, { skin: [number, number, number, number][] }>;
  mouths: Record<string, GroupMouth>;
  eyes: Record<string, GroupEyes>;
};
/** A demo Chog: its traits pick the measured groups; the warp is tuned by hand. */
type DemoRig = {
  traits: { side: Side; mouth: string; eyes: string };
  pivot: [number, number];
  head: [number, number];
  body: [number, number, number];
};

const GROUPS = groupsJson as unknown as FaceGroups;
const DEMO = rigsJson as unknown as Record<string, DemoRig>;

/** Open viseme path is about this wide and tall before per-face scale. */
export const OPEN_VISEME = { w: 92, h: 74 };

/** Painted pixels must sit this far above the point where the head warp starts to bend. */
const WARP_MARGIN = 24;

const SIDE_WARP: Record<Side, Pick<FaceRig, "pivot" | "head" | "body">> = {
  Left: { pivot: [480, 690], head: [740, 840], body: [800, 910, 990] },
  Right: { pivot: [500, 630], head: [760, 860], body: [810, 915, 990] },
};

/** Where an unmeasured mouth roughly is. Never painted; only the debug view draws it. */
const FALLBACK_MOUTH: Record<Side, Box> = {
  Left: { x: 684, y: 614, w: 96, h: 78 },
  Right: { x: 492, y: 640, w: 116, h: 76 },
};

function skinTiles(side: Side): Box[] {
  return (GROUPS.sides[side]?.skin ?? []).map(([x, y, w, h]) => ({ x, y, w, h }));
}

/** Push the rigid band below the lowest painted pixel, so the overlay cannot drift off the art. */
function settleWarp(rig: FaceRig, painted: Box[]): FaceRig {
  if (!painted.length) return rig;
  const lowest = Math.max(...painted.map((box) => box.y + box.h)) + WARP_MARGIN;
  const head0 = Math.max(rig.head[0], lowest);
  const body0 = Math.max(rig.body[0], lowest);
  return {
    ...rig,
    head: [head0, Math.max(rig.head[1], head0 + 90)],
    body: [body0, Math.max(rig.body[1], body0 + 80), rig.body[2]],
  };
}

/** Read the face traits from a token's attributes. One-of-ones have no Side and get none. */
export function faceTraits(attributes?: RawTrait[] | null): FaceTraits {
  if (!attributes) return {};
  const get = (type: string) => attributes.find((trait) => trait.trait_type === type)?.value;
  const side = get("Side");
  if (side !== "Left" && side !== "Right") return {};
  return { side, mouth: get("Mouth"), eyes: get("Eyes"), base: get("Base") };
}

/** A stable string for a token's face traits, for effect dependencies. */
export function faceTraitsKey(traits: FaceTraits): string {
  return [traits.side, traits.mouth, traits.eyes, traits.base].map((value) => value ?? "").join("|");
}

/**
 * The rig for a portrait, and which painted features are safe on it.
 *
 * A mouth is painted only when the token's (Side, Mouth) group was measured, and lids only when
 * its (Side, Eyes) group was measured and reviewed on a contact sheet (scripts/measure_faces.py).
 * The four demo Chogs read their groups from their own traits and keep a hand-tuned warp. Every
 * other token keeps the warp, bob and tilt and nothing more, so a Chog never gets a second mouth
 * or lids in the wrong place. One-of-ones (no Side), "?" mouths and bases other than Origin are
 * never painted. The engine still checks each token's pixels before painting (facePaint.fits).
 */
export function rigFor(artId: number, side: Side, traits?: FaceTraits): RigChoice {
  const demo = DEMO[String(artId)];
  const face: FaceTraits = demo ? { ...demo.traits, base: "Origin" } : (traits ?? {});
  const faceSide: Side = demo ? demo.traits.side : side;
  const known = face.side === faceSide && (face.base === undefined || face.base === "Origin");
  const mouthGroup = known && face.mouth ? GROUPS.mouths[`${faceSide}|${face.mouth}`] : undefined;
  const eyeGroup = known && face.eyes ? GROUPS.eyes[`${faceSide}|${face.eyes}`] : undefined;
  const warp = demo ? { pivot: demo.pivot, head: demo.head, body: demo.body } : SIDE_WARP[faceSide];
  const eyes = eyeGroup ? eyeGroup.eyes.map((eye) => ({ ...eye })) : [];
  const mouth = mouthGroup ? { ...mouthGroup.mouth } : { ...FALLBACK_MOUTH[faceSide] };
  const painted: Box[] = [...eyes];
  if (mouthGroup) painted.push(mouthGroup.mouth, mouthGroup.patch);
  const rig = settleWarp(
    {
      pivot: [...warp.pivot] as [number, number],
      head: [...warp.head] as [number, number],
      body: [...warp.body] as [number, number, number],
      eyes,
      ...(eyeGroup ? { eyeExpect: eyeGroup.eyes.map((_, i) => ({ area: eyeGroup.area[i], band: eyeGroup.band[i] })) } : {}),
      mouth,
      ...(mouthGroup ? { patch: { ...mouthGroup.patch }, mouthExpect: { area: mouthGroup.area, band: mouthGroup.band } } : {}),
      ...(mouthGroup?.inpaint === false ? { inpaint: false } : {}),
      skin: skinTiles(faceSide),
    },
    painted,
  );
  return { rig, paintMouth: Boolean(mouthGroup), paintLids: eyes.length > 0 };
}

/** @deprecated Use rigFor(), which also says whether the mouth and lids may be painted. */
export function faceRig(artId: number, side: Side): FaceRig {
  return rigFor(artId, side).rig;
}

export function measuredArtIds(): number[] {
  return Object.keys(DEMO).map((id) => Number(id));
}

/** The measured (Side, trait) group keys, for tests and the rig page. */
export function measuredGroups() {
  return { mouths: Object.keys(GROUPS.mouths), eyes: Object.keys(GROUPS.eyes) };
}

/** Viseme anchor. The open shape fills the painted mouth, with room for the stroke. */
export function mouthPlacement(box: Box) {
  const sx = (box.w - 18) / OPEN_VISEME.w;
  const sy = (box.h - 16) / OPEN_VISEME.h;
  return {
    cx: box.x + box.w / 2,
    top: box.y + 6,
    sx,
    sy,
  };
}

export function intersects(a: Box, b: Box) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function containsPoint(box: Box, x: number, y: number) {
  return x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
}

export function isCream(r: number, g: number, b: number) {
  return r > 175 && g > 155 && b > 125 && r - g < 58 && g + 18 >= b && r - b < 110;
}

export function isFeatureDark(r: number, g: number, b: number) {
  return r < 78 && g < 78 && b < 92;
}

/** The inverse of faceTraitsKey(). */
export function faceTraitsFromKey(key: string): FaceTraits {
  const [side, mouth, eyes, base] = key.split("|");
  return { side: side || undefined, mouth: mouth || undefined, eyes: eyes || undefined, base: base || undefined };
}
