import { describe, expect, it } from "vitest";
import bookJson from "@/data/tokens.json";
import { metaFromBook, profileFromMeta, type TokenBook } from "@/lib/chog";
import { faceTraits, measuredGroups, rigFor, type Box } from "@/lib/faceRig";
import { EYE_DEPTH, WARP_GLSL, warpFor, warpSourceY, warpUniforms, type FaceWarp } from "@/lib/faceWarp";
import { CHOG_SUPPLY } from "@/lib/ids";

const book = bookJson as TokenBook;

/** Every Chog as the app sees it: its portrait's Side, its face traits, the painted rig and the warp. */
const everyone = Array.from({ length: CHOG_SUPPLY }, (_, i) => {
  const artId = i + 1;
  const profile = profileFromMeta(artId, metaFromBook(book, artId)!);
  const traits = faceTraits(profile.traits);
  const base = profile.traits.find((trait) => trait.trait_type === "Base")?.value;
  return { artId, side: profile.side, traits, base, rig: rigFor(artId, profile.side, traits), warp: warpFor(artId, profile.side, traits) };
});

const inside = (box: Box) => box.x >= 0 && box.y >= 0 && box.x + box.w <= 1000 && box.y + box.h <= 1000 && box.w > 0 && box.h > 0;

describe("every one of the 1,969 Chogs", () => {
  it("blinks and talks: painted lids and mouth where measured, the warp everywhere else", () => {
    let paintedMouths = 0;
    let paintedLids = 0;
    for (const chog of everyone) {
      const { warp, rig } = chog;
      expect(warp.eyes.length, `#${chog.artId}`).toBeGreaterThanOrEqual(1);
      expect(warp.eyes.length).toBeLessThanOrEqual(2);
      for (const eye of warp.eyes) {
        expect(inside(eye), `#${chog.artId} eye`).toBe(true);
        expect(eye.depth).toBeGreaterThanOrEqual(0.4);
      }
      expect(inside(warp.mouth), `#${chog.artId} mouth`).toBe(true);
      // The mouth sits below the eyes, in the lower half of the face.
      expect(warp.mouth.y + warp.mouth.h / 2).toBeGreaterThan(Math.min(...warp.eyes.map((eye) => eye.y + eye.h / 2)));
      if (rig.paintMouth) paintedMouths++;
      if (rig.paintLids) paintedLids++;
    }
    // The painted features stay where they were measured; the warp covers the rest.
    expect(paintedMouths).toBeLessThan(CHOG_SUPPLY);
    expect(paintedLids).toBeLessThan(CHOG_SUPPLY);
  });

  it("paints nothing where the face was not measured", () => {
    const { mouths, eyes } = measuredGroups();
    for (const { artId, traits, rig, base } of everyone) {
      const origin = base === "Origin" && traits.side !== undefined;
      expect(rig.paintMouth, `#${artId}`).toBe(origin && mouths.includes(`${traits.side}|${traits.mouth}`));
      expect(rig.paintLids, `#${artId}`).toBe(origin && eyes.includes(`${traits.side}|${traits.eyes}`));
    }
  });

  it("closes laser eyes from above only, so the beam below the line never bends", () => {
    const lasers = everyone.filter((chog) => /laser/i.test(chog.traits.eyes ?? ""));
    expect(lasers.length).toBeGreaterThan(250);
    for (const { warp } of lasers) {
      const u = warpUniforms(warp);
      for (const eye of warp.eyes) {
        expect(eye.lower).toBe(0);
        const below = eye.y + eye.h * 0.75;
        for (const x of [eye.x, eye.x + eye.w / 2, eye.x + eye.w]) expect(warpSourceY(x, below, u, 1, 0)).toBeCloseTo(below, 6);
      }
    }
  });

  it("gives the one-of-ones their own boxes and Skull and Radioactive their own template", () => {
    const by = (from: FaceWarp["from"]) => everyone.filter((chog) => chog.warp.from === from).map((chog) => chog.artId);
    expect(by("art").sort((a, b) => a - b)).toEqual([53, 392, 434, 494, 973, 1006, 1159, 1290, 1373, 1376]);
    const skull = everyone.find((chog) => chog.base === "Skull" && chog.side === "Right")!;
    const origin = everyone.find((chog) => chog.base === "Origin" && chog.side === "Right" && chog.traits.eyes === skull.traits.eyes)!;
    expect(skull.warp.from).toBe("base");
    expect(skull.warp.eyes).not.toEqual(origin.warp.eyes);
    expect(skull.warp.mouth).not.toEqual(origin.warp.mouth);
  });
});

describe("the warp", () => {
  // One check per distinct face: the tokens share a few hundred.
  const faces = new Map<string, FaceWarp>();
  for (const { warp } of everyone) faces.set(JSON.stringify(warp), warp);

  it("leaves the art untouched at rest", () => {
    let moved = 0;
    for (const face of faces.values()) {
      const u = warpUniforms(face);
      for (let x = 0; x <= 1000; x += 50) for (let y = 0; y < 1000; y += 7) if (warpSourceY(x, y, u, 0, 0) !== y) moved++;
    }
    expect(moved).toBe(0);
  });

  it("never folds or tears the art, mid-blink or with the jaw open, and keeps the hat top and collar still", () => {
    expect(faces.size).toBeGreaterThan(20);
    const folds: string[] = [];
    const edges: string[] = [];
    for (const face of faces.values()) {
      const u = warpUniforms(face);
      for (const [blink, open] of [
        [1, 1],
        [0.5, 0.5],
        [1, 0],
        [0, 1],
      ]) {
        for (let x = 0; x <= 1000; x += 20) {
          let previous = -Infinity;
          for (let y = 0; y < 1000; y += 2) {
            const row = warpSourceY(x, y, u, blink, open);
            // Monotonic rows: no pixel of the art shows twice, upside down or not at all.
            if (row < previous) folds.push(`${JSON.stringify(face)} at ${x},${y} blink ${blink} jaw ${open}`);
            previous = row;
            if ((y < 110 || y > 900) && row !== y) edges.push(`${JSON.stringify(face)} at ${x},${y}`);
          }
        }
      }
    }
    expect(folds.slice(0, 3)).toEqual([]);
    expect(edges.slice(0, 3)).toEqual([]);
  });

  it("visibly moves the eyes on a blink and the mouth when it opens", () => {
    for (const face of faces.values()) {
      const u = warpUniforms(face);
      const eye = face.eyes[0];
      // Near the edge that closes (the bottom, or the top of a laser eye), the squash shows art from
      // further out: the eye's content is pulled toward its line.
      const ex = eye.x + eye.w / 2;
      const ey = eye.y + eye.h * (eye.lower > 0 ? 0.85 : 0.15);
      expect(Math.abs(warpSourceY(ex, ey, u, 1, 0) - ey)).toBeGreaterThan(eye.h * 0.1);
      const mx = face.mouth.x + face.mouth.w / 2;
      const below = face.mouth.y + face.mouth.h / 2 + 30;
      // Below the mouth line the art drops: the row shown comes from higher up.
      expect(below - warpSourceY(mx, below, u, 0, 1)).toBeGreaterThan(8);
    }
  });

  it("repeats a lone visor box with no depth, so the shader always has two", () => {
    const visor = warpFor(1, "Right", { side: "Right", mouth: "Bubblegum", eyes: "Gradient visor", base: "Origin" });
    expect(visor.eyes).toHaveLength(1);
    expect(visor.eyes[0].depth).toBeLessThan(EYE_DEPTH);
    const u = warpUniforms(visor);
    expect(u.eyeBoxB[3]).toBe(0);
    expect(u.eyeBoxB.slice(0, 3)).toEqual(u.eyeBoxA.slice(0, 3));
  });

  it("ships the same squash and jaw falloffs in the shader as in warpSourceY", () => {
    for (const piece of ["0.7 * box.z", "1.35 * box.z", "0.6 * jawM.z", "a / s", "mix(-jawK.w, 1.0"]) expect(WARP_GLSL).toContain(piece);
  });
});
