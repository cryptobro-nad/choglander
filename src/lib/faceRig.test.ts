import { describe, expect, it } from "vitest";
import demoRigs from "../../public/chog/face-rig.json";
import { DEMO_META } from "@/lib/chog";
import { OPEN_SHAPE, traceViseme, unrle } from "@/lib/facePaint";
import {
  containsPoint,
  faceTraits,
  faceTraitsFromKey,
  faceTraitsKey,
  intersects,
  measuredGroups,
  mouthPlacement,
  rigFor,
  type Box,
  type FaceTraits,
} from "@/lib/faceRig";
import type { Side } from "@/lib/types";

const BLUSH: Record<number, Box> = {
  375: { x: 275, y: 632, w: 142, h: 128 },
  242: { x: 275, y: 632, w: 142, h: 128 },
  642: { x: 475, y: 525, w: 58, h: 49 },
};

/** Centre of the painted mouth on each demo art. */
const MOUTH_CENTER: Record<number, [number, number]> = {
  375: [736, 659],
  242: [736, 659],
  642: [545, 683],
  821: [573, 675],
};

/** Both eyes of the Left demo Chogs. The far eye is the one the old rig left open (audit finding 2). */
const EYES: Record<number, { near: [number, number]; far: [number, number] }> = {
  375: { near: [419, 553], far: [842, 427] },
  242: { near: [444, 529], far: [830, 446] },
};

const bottom = (box: Box) => box.y + box.h;
const origin = (side: Side, mouth?: string, eyes?: string): FaceTraits => ({ side, mouth, eyes, base: "Origin" });

describe("demo rigs", () => {
  it("cover each painted mouth, keep it off the blush, and keep the warp rigid below it", () => {
    for (const artId of [375, 642, 821, 242]) {
      const { rig, paintMouth } = rigFor(artId, "Left");
      expect(paintMouth).toBe(true);
      const [cx, cy] = MOUTH_CENTER[artId];
      expect(containsPoint(rig.patch ?? rig.mouth, cx, cy)).toBe(true);
      expect(containsPoint(rig.mouth, cx, cy)).toBe(true);
      const lowest = Math.max(bottom(rig.mouth), bottom(rig.patch ?? rig.mouth));
      expect(rig.head[0]).toBeGreaterThan(lowest);
      expect(rig.body[0]).toBeGreaterThan(lowest);
      const place = mouthPlacement(rig.mouth);
      expect(containsPoint(rig.mouth, place.cx, place.top + 20)).toBe(true);
      const blush = BLUSH[artId];
      if (blush) expect(intersects(rig.mouth, blush)).toBe(false);
      for (const eye of rig.eyes) expect(intersects(eye, rig.patch ?? rig.mouth)).toBe(false);
    }
  });

  it("blink both eyes on 375 and 242, not just the near one", () => {
    for (const artId of [375, 242]) {
      const { rig, paintLids } = rigFor(artId, "Left");
      expect(paintLids).toBe(true);
      expect(rig.eyes).toHaveLength(2);
      const { near, far } = EYES[artId];
      expect(rig.eyes.some((eye) => containsPoint(eye, ...near))).toBe(true);
      expect(rig.eyes.some((eye) => containsPoint(eye, ...far))).toBe(true);
      // Each eye has its own box: they do not overlap, so a shut lid line has no step.
      expect(intersects(rig.eyes[0], rig.eyes[1])).toBe(false);
    }
  });

  it("paint no lids over 642's closed arcs or 821's glasses", () => {
    for (const artId of [642, 821]) {
      const { rig, paintLids } = rigFor(artId, "Right");
      expect(paintLids).toBe(false);
      expect(rig.eyes).toEqual([]);
    }
  });

  it("take their groups from the same traits as the bundled metadata", () => {
    for (const [id, demo] of Object.entries(demoRigs)) {
      const traits = faceTraits(DEMO_META[Number(id)].attributes);
      expect({ side: traits.side, mouth: traits.mouth, eyes: traits.eyes }).toEqual(demo.traits);
    }
  });
});

describe("rigFor on any other token", () => {
  it("paints nothing when the traits are not known", () => {
    for (const side of ["Left", "Right"] as const) {
      const choice = rigFor(1462, side);
      expect(choice.paintMouth).toBe(false);
      expect(choice.paintLids).toBe(false);
      expect(choice.rig.eyes).toEqual([]);
    }
  });

  it("paints a measured mouth and reviewed lids", () => {
    const choice = rigFor(501, "Left", origin("Left", "Smile", "Base"));
    expect(choice.paintMouth).toBe(true);
    expect(choice.paintLids).toBe(true);
    expect(choice.rig.mouthExpect?.area).toBeGreaterThan(0);
    expect(choice.rig.eyeExpect).toHaveLength(2);
  });

  it("skips mouths and eyes that were not measured or did not pass review", () => {
    expect(rigFor(1700, "Left", origin("Left", "Drooling", "Happy"))).toMatchObject({ paintMouth: false, paintLids: false });
    expect(rigFor(1563, "Right", origin("Right", "Gold Tooth", "Heart"))).toMatchObject({ paintMouth: false, paintLids: false });
    expect(rigFor(458, "Right", origin("Right", "Bubblegum", "Retro Glass"))).toMatchObject({ paintMouth: false, paintLids: false });
  });

  it("never paints one-of-ones, '?' mouths or bases other than Origin", () => {
    const oneOfOne = faceTraits([
      { trait_type: "Base", value: "1:1" },
      { trait_type: "Tier", value: "Legendary" },
    ]);
    expect(oneOfOne).toEqual({});
    expect(rigFor(392, "Left", oneOfOne)).toMatchObject({ paintMouth: false, paintLids: false });
    expect(rigFor(1289, "Left", origin("Left", undefined, "Smirk")).paintMouth).toBe(false);
    expect(rigFor(846, "Right", { side: "Right", mouth: "Smile", eyes: "Round", base: "Skull" })).toMatchObject({ paintMouth: false, paintLids: false });
  });

  it("does not trust traits whose Side disagrees with the portrait", () => {
    expect(rigFor(1, "Right", origin("Left", "Smile", "Base"))).toMatchObject({ paintMouth: false, paintLids: false });
  });

  it("keeps every painted pixel inside the rigid head band, for every measured pair", () => {
    const { mouths, eyes } = measuredGroups();
    expect(mouths.length).toBeGreaterThanOrEqual(8);
    expect(eyes.length).toBeGreaterThanOrEqual(4);
    for (const mouthKey of mouths) {
      const [side, mouth] = mouthKey.split("|") as [Side, string];
      for (const eyeKey of [...eyes.filter((key) => key.startsWith(`${side}|`)), `${side}|none`]) {
        const { rig } = rigFor(1, side, origin(side, mouth, eyeKey.split("|")[1]));
        const painted = [rig.mouth, rig.patch ?? rig.mouth, ...rig.eyes];
        const lowest = Math.max(...painted.map(bottom));
        expect(rig.head[0]).toBeGreaterThan(lowest);
        expect(rig.body[0]).toBeGreaterThan(lowest);
        // The open mouth never lands on an eye's pixels. (A wide patch may reach under an eye's
        // corner; it is drawn first and the lid over it, and it only changes the mouth's pixels.)
        const { points } = traceViseme(rig.mouth, OPEN_SHAPE);
        const xs = points.map(([x]) => x);
        const ys = points.map(([, y]) => y);
        const open = { x: Math.min(...xs) - 5, y: Math.min(...ys) - 5, w: Math.max(...xs) - Math.min(...xs) + 10, h: Math.max(...ys) - Math.min(...ys) + 10 };
        for (const eye of rig.eyes) {
          const mask = eye.mask!;
          const shape = unrle(mask.rle, mask.w * mask.h);
          let hits = 0;
          for (let i = 0; i < shape.length; i++) if (shape[i] && containsPoint(open, mask.x + (i % mask.w), mask.y + Math.floor(i / mask.w))) hits++;
          expect(hits).toBe(0);
        }
      }
    }
  });

  it("ships an eye silhouette that decodes to its rect and covers the eye's centre", () => {
    for (const key of measuredGroups().eyes) {
      const [side, eyes] = key.split("|") as [Side, string];
      const { rig } = rigFor(1, side, origin(side, undefined, eyes));
      expect(rig.eyes).toHaveLength(2);
      for (const eye of rig.eyes) {
        const mask = eye.mask!;
        expect(mask.rle.reduce((sum, n) => sum + n, 0)).toBe(mask.w * mask.h);
        const shape = unrle(mask.rle, mask.w * mask.h);
        const cx = Math.round(eye.x + eye.w / 2 - mask.x);
        const cy = Math.round(eye.y + eye.h / 2 - mask.y);
        expect(shape[cy * mask.w + cx]).toBe(1);
        expect(containsPoint(mask, eye.x, eye.y)).toBe(true);
        expect(containsPoint(mask, eye.x + eye.w, eye.y + eye.h)).toBe(true);
      }
    }
  });
});

describe("faceTraits", () => {
  it("reads Side, Mouth, Eyes and Base, and round-trips through its key", () => {
    const traits = faceTraits(DEMO_META[821].attributes);
    expect(traits).toEqual({ side: "Right", mouth: "Lip Bite", eyes: "Retro Glass", base: expect.any(String) });
    expect(faceTraitsFromKey(faceTraitsKey(traits))).toEqual(traits);
    expect(faceTraitsFromKey(faceTraitsKey({}))).toEqual({ side: undefined, mouth: undefined, eyes: undefined, base: undefined });
    expect(faceTraits(undefined)).toEqual({});
  });
});
