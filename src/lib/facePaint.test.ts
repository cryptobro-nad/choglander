import { describe, expect, it } from "vitest";
import { featureHole, fits, lidMasks, mouthPatch, paintableSkin, parseColor, sampleSkin, skinSwatch, unrle, type Pixels, type Rgb } from "@/lib/facePaint";

const SKIN: Rgb = [238, 230, 214];
const INK: Rgb = [18, 18, 18];

function image(w: number, h: number, fill: Rgb): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([...fill, 255], i * 4);
  return { width: w, height: h, data };
}

function paint(img: Pixels, x0: number, y0: number, w: number, h: number, color: Rgb) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) img.data.set([...color, 255], (y * img.width + x) * 4);
}

function at(img: Pixels, x: number, y: number): Rgb {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}

describe("sampleSkin", () => {
  it("ignores the background colour even where it shows through the probes", () => {
    const bg: Rgb = [244, 236, 220]; // a cream background, close to the skin
    const img = image(200, 200, bg);
    paint(img, 40, 40, 30, 60, [190, 120, 90]); // the skin covers 30 of the probe's 60 columns
    const skin = sampleSkin(img, [{ x: 40, y: 40, w: 60, h: 60 }], bg);
    expect(skin).toEqual([190, 120, 90]);
  });

  it("skips lines and falls back to cream when a probe shows no skin", () => {
    const img = image(100, 100, INK);
    expect(sampleSkin(img, [{ x: 10, y: 10, w: 20, h: 20 }])).toEqual([237, 228, 212]);
  });
});

describe("featureHole", () => {
  it("takes the enclosed feature and leaves anything joined to the edge", () => {
    const img = image(200, 200, SKIN);
    paint(img, 90, 90, 20, 10, INK); // the mouth, enclosed
    paint(img, 60, 120, 80, 4, INK); // a jaw line that runs out of the rect
    const hole = featureHole(img, { x: 80, y: 80, w: 40, h: 30 }, SKIN, 16);
    expect(hole.area).toBe(200);
    const jaw = (121 - hole.y0) * hole.w + (100 - hole.x0);
    expect(hole.hole[jaw]).toBe(0);
    expect(hole.outside[jaw]).toBe(1);
    expect(hole.band).toBeLessThan(1);
  });

  it("fits() accepts the measured size and a clear ring, and rejects a covered feature", () => {
    const expect_ = { area: 2000, band: 0.95 };
    expect(fits({ area: 2050, band: 0.96 }, expect_)).toBe(true);
    expect(fits({ area: 400, band: 0.96 }, expect_)).toBe(false); // joined to a hand or laser
    expect(fits({ area: 2600, band: 0.96 }, expect_)).toBe(false); // something extra inside
    expect(fits({ area: 2000, band: 0.8 }, expect_)).toBe(false); // the ring is covered
    expect(fits({ area: 1, band: 0 })).toBe(true); // hand-measured: no expectation
  });
});

describe("mouthPatch", () => {
  it("erases the enclosed mouth with skin and never touches the jaw beside it", () => {
    const img = image(200, 200, SKIN);
    paint(img, 90, 90, 20, 10, INK);
    paint(img, 60, 103, 80, 4, INK); // jaw line 3 px below the mouth, joined to the outside
    const patch = mouthPatch(img, { x: 80, y: 80, w: 40, h: 22 }, 16, SKIN);
    const out = { width: patch.image.width, height: patch.image.height, data: patch.image.data };
    const px = (x: number, y: number) => at(out, x - patch.x, y - patch.y);
    expect(px(100, 95)).toEqual(SKIN);
    expect(px(95, 92)).toEqual(SKIN);
    expect(px(100, 104)).toEqual(INK);
    expect(px(70, 105)).toEqual(INK);
  });

  it("puts the art's grain back on the fill", () => {
    const img = image(200, 200, SKIN);
    paint(img, 90, 90, 20, 10, INK);
    const grain = image(4, 4, SKIN);
    grain.data.set([SKIN[0] - 8, SKIN[1] - 8, SKIN[2] - 8, 255], 0);
    const patch = mouthPatch(img, { x: 80, y: 80, w: 40, h: 30 }, 16, SKIN, grain);
    const out = { width: patch.image.width, height: patch.image.height, data: patch.image.data };
    const values = new Set<number>();
    for (let y = 90; y < 100; y++) for (let x = 90; x < 110; x++) values.add(at(out, x - patch.x, y - patch.y)[0]);
    expect(values.size).toBeGreaterThan(1);
  });
});

describe("lids", () => {
  it("cover the black-and-white eye inside its silhouette, never the blush", () => {
    const img = image(60, 60, SKIN);
    paint(img, 20, 20, 10, 10, INK);
    paint(img, 30, 20, 10, 10, [230, 90, 140]); // blush inside the silhouette
    const eye = { x: 20, y: 20, w: 20, h: 10, mask: { x: 20, y: 20, w: 20, h: 10, rle: [0, 200] } };
    const { fill, shape } = lidMasks(img, eye);
    expect(shape.reduce((a, b) => a + b, 0)).toBe(200);
    expect(fill[5 * 20 + 5]).toBe(1);
    expect(fill[5 * 20 + 15]).toBe(0);
  });

  it("decode silhouettes from run lengths", () => {
    expect(Array.from(unrle([2, 3, 1, 2], 8))).toEqual([0, 0, 1, 1, 1, 0, 1, 1]);
  });

  it("take a grain swatch only from clean skin tiles", () => {
    const img = image(100, 100, SKIN);
    paint(img, 50, 50, 4, 4, [230, 90, 140]);
    const swatch = skinSwatch(img, [{ x: 40, y: 40, w: 24, h: 24 }, { x: 0, y: 0, w: 24, h: 24 }], SKIN);
    expect(swatch?.width).toBe(24);
    expect(skinSwatch(img, [{ x: 40, y: 40, w: 24, h: 24 }], SKIN)).toBeNull();
  });
});

describe("paintableSkin", () => {
  it("paints on the cream face only, not on dark or brightly coloured skins", () => {
    expect(paintableSkin([238, 230, 214])).toBe(true);
    expect(paintableSkin([98, 52, 36])).toBe(false);
    expect(paintableSkin([110, 160, 230])).toBe(false);
  });
});

describe("parseColor", () => {
  it("reads hex and rgb()", () => {
    expect(parseColor("#7ed6d2")).toEqual([126, 214, 210]);
    expect(parseColor("#fff")).toEqual([255, 255, 255]);
    expect(parseColor("rgb(1, 2, 3)")).toEqual([1, 2, 3]);
    expect(parseColor("teal")).toBeNull();
  });
});
