import { mouthPlacement, type Box, type Eye, type Expect, type FaceRig } from "@/lib/faceRig";

/**
 * Pixel rules for painting on the Chog art. scripts/measure_faces.py mirrors these exactly, so the
 * contact sheets in the evidence folder show what the app paints.
 */

export type Viseme = { w: number; h: number; r: number; t: number };
export type Rgb = [number, number, number];
/** ImageData, or anything shaped like it (tests run without a DOM). */
export type Pixels = { width: number; height: number; data: Uint8ClampedArray };

export const OPEN_SHAPE: Viseme = { w: 46, h: 62, r: 0.15, t: 0 };

/** |dr|+|dg|+|db| from the skin above which a pixel is a feature, not skin. */
export const NONSKIN = 60;
/** Fill sources for the mouth patch must be this close to the skin. */
export const SOURCE = 36;
export const MOUTH_PAD = 16;
export const EYE_PAD = 8;
/** A shut lid rests at this share of the eye's height, so the lower lash line still shows. */
export const LID_CLOSE = 0.88;
/** Lids only paint over black-and-white eye pixels: anything this colourful is left alone. */
const LID_CHROMA = 48;
const FALLBACK_SKIN: Rgb = [237, 228, 212];

const dist = (d: Uint8ClampedArray, i: number, c: Rgb) => Math.abs(d[i] - c[0]) + Math.abs(d[i + 1] - c[1]) + Math.abs(d[i + 2] - c[2]);

export function rgbCss(c: Rgb) {
  return `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;
}

/** Parse "#rgb", "#rrggbb" or "rgb(r,g,b)". */
export function parseColor(css: string | undefined | null): Rgb | null {
  if (!css) return null;
  const hex = css.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const rgb = css.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

function blank(width: number, height: number): ImageData {
  if (typeof ImageData !== "undefined") return new ImageData(width, height);
  return { width, height, data: new Uint8ClampedArray(width * height * 4), colorSpace: "srgb" } as ImageData;
}

/**
 * This token's skin: the median of the probe tiles (bare skin on nearly every token of the Side),
 * skipping lines, specks and anything the colour of the background, which some arts show through.
 */
export function sampleSkin(data: Pixels, probes: Box[], background?: Rgb | null): Rgb {
  const { width, height, data: px } = data;
  const corner = (x: number, y: number): Rgb => {
    const i = (Math.min(height - 1, y) * width + Math.min(width - 1, x)) * 4;
    return [px[i], px[i + 1], px[i + 2]];
  };
  const avoid: Rgb[] = [corner(4, 4), corner(width - 5, 4)];
  if (background) avoid.push(background);
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  for (const box of probes) {
    for (let y = Math.max(0, box.y); y < Math.min(height, box.y + box.h); y += 2) {
      for (let x = Math.max(0, box.x); x < Math.min(width, box.x + box.w); x += 2) {
        const i = (y * width + x) * 4;
        if (px[i + 3] < 200 || px[i] + px[i + 1] + px[i + 2] <= 150) continue;
        if (avoid.some((c) => dist(px, i, c) <= 40)) continue;
        rs.push(px[i]);
        gs.push(px[i + 1]);
        bs.push(px[i + 2]);
      }
    }
  }
  if (rs.length < 20) return FALLBACK_SKIN;
  const mid = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  return [mid(rs), mid(gs), mid(bs)];
}

/** `hole`: the feature. `outside`: non-skin joined to the rect's edge, which must never be painted. */
export type Hole = { x0: number; y0: number; w: number; h: number; hole: Uint8Array; outside: Uint8Array; area: number; band: number };

/**
 * The non-skin pixels inside box+pad whose 4-connected component does not reach the rect's edge:
 * the painted feature itself. Anything joined to the outside (the jaw, hair, a hand, a laser) is
 * left alone. `band` is the share of skin in the ring between the box and the padded rect.
 */
export function featureHole(data: Pixels, box: Box, skin: Rgb, pad: number): Hole {
  const x0 = Math.max(0, Math.floor(box.x - pad));
  const y0 = Math.max(0, Math.floor(box.y - pad));
  const x1 = Math.min(data.width, Math.ceil(box.x + box.w + pad));
  const y1 = Math.min(data.height, Math.ceil(box.y + box.h + pad));
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  const nonskin = new Uint8Array(w * h);
  let ring = 0;
  let ringSkin = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((y0 + y) * data.width + (x0 + x)) * 4;
      const feature = dist(data.data, i, skin) > NONSKIN;
      nonskin[y * w + x] = feature ? 1 : 0;
      const inBox = x0 + x >= box.x && x0 + x < box.x + box.w && y0 + y >= box.y && y0 + y < box.y + box.h;
      if (!inBox) {
        ring++;
        if (!feature) ringSkin++;
      }
    }
  }
  // Flood from the edge: every non-skin pixel reachable from it is not part of the feature.
  const outside = new Uint8Array(w * h);
  const stack: number[] = [];
  const seed = (i: number) => {
    if (nonskin[i] && !outside[i]) {
      outside[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x);
    seed((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    seed(y * w);
    seed(y * w + w - 1);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    if (x > 0) seed(i - 1);
    if (x < w - 1) seed(i + 1);
    if (i >= w) seed(i - w);
    if (i < (h - 1) * w) seed(i + w);
  }
  const hole = new Uint8Array(w * h);
  let area = 0;
  for (let i = 0; i < w * h; i++) {
    if (nonskin[i] && !outside[i]) {
      hole[i] = 1;
      area++;
    }
  }
  return { x0, y0, w, h, hole, outside, area, band: ring ? ringSkin / ring : 1 };
}

/**
 * Whether this token looks like its group around a feature: the feature is about the measured size
 * and the ring around it is as clear as on the clean samples. A hat, hand, laser or accessory that
 * covers the spot fails this, and the feature is not painted on that token.
 */
export function fits(hole: Pick<Hole, "area" | "band">, expect?: Expect) {
  if (!expect) return true;
  // Clean samples of a group land within a few percent of each other; the slack covers small eyes.
  const areaOk = expect.area <= 0 || (hole.area >= expect.area * 0.85 - 80 && hole.area <= expect.area * 1.2 + 80);
  return areaOk && hole.band >= expect.band - 0.06;
}

/**
 * Copy a rectangle and replace the painted mouth with this token's skin. Each column of the hole is
 * filled with a blend from the skin just above it to the skin just below (each end averaged over a
 * few columns, so the fill does not streak), and `grain` (a swatch of real skin) puts the art's
 * texture back on top. The jaw, hair or anything else joined to the rect's edge is never touched.
 */
export function mouthPatch(source: Pixels, box: Box, pad = MOUTH_PAD, skin: Rgb = FALLBACK_SKIN, grain?: Pixels | null) {
  const { x0, y0, w, h, hole, outside } = featureHole(source, box, skin, pad);
  const out = blank(w, h);
  const src = source.data;
  const dst = out.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = ((y0 + y) * source.width + (x0 + x)) * 4;
      const di = (y * w + x) * 4;
      dst[di] = src[si];
      dst[di + 1] = src[si + 1];
      dst[di + 2] = src[si + 2];
      dst[di + 3] = 255;
    }
  }
  // Grow the hole by 3 px to take its anti-aliased edge, but never into the outline beside it.
  const dilated = new Uint8Array(hole);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!hole[y * w + x]) continue;
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (dx * dx + dy * dy > 10 || nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (!outside[ny * w + nx]) dilated[ny * w + nx] = 1;
        }
      }
    }
  }
  const isSource = (x: number, y: number) => {
    if (x < 0 || x >= w || y < 0 || y >= h || dilated[y * w + x]) return false;
    return dist(dst, (y * w + x) * 4, skin) <= SOURCE;
  };
  /** Mean of the skin sources on row y within 3 px of column x, or null. */
  const sourceAt = (x: number, y: number): Rgb | null => {
    if (!isSource(x, y)) return null;
    const sum: Rgb = [0, 0, 0];
    let n = 0;
    for (let dx = -3; dx <= 3; dx++) {
      if (!isSource(x + dx, y)) continue;
      const i = (y * w + x + dx) * 4;
      sum[0] += dst[i];
      sum[1] += dst[i + 1];
      sum[2] += dst[i + 2];
      n++;
    }
    return [sum[0] / n, sum[1] / n, sum[2] / n];
  };
  const mean: Rgb = [0, 0, 0];
  if (grain) {
    const n = grain.width * grain.height;
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) mean[c] += grain.data[i * 4 + c] / n;
  }
  const grainAt = (x: number, y: number, c: number) => {
    if (!grain) return 0;
    const gx = (x0 + x) % grain.width;
    const gy = (y0 + y) % grain.height;
    return grain.data[(gy * grain.width + gx) * 4 + c] - mean[c];
  };
  for (let x = 0; x < w; x++) {
    let y = 0;
    while (y < h) {
      if (!dilated[y * w + x]) {
        y++;
        continue;
      }
      const yStart = y;
      while (y < h && dilated[y * w + x]) y++;
      const yEnd = y - 1;
      let above: Rgb | null = null;
      let below: Rgb | null = null;
      for (let k = 1; k <= 64 && !above; k++) above = sourceAt(x, yStart - k);
      for (let k = 1; k <= 64 && !below; k++) below = sourceAt(x, yEnd + k);
      const a = above ?? below ?? skin;
      const b = below ?? a;
      for (let yy = yStart; yy <= yEnd; yy++) {
        const t = (yy - yStart) / Math.max(1, yEnd - yStart);
        const i = (yy * w + x) * 4;
        for (let c = 0; c < 3; c++) dst[i + c] = Math.round(a[c] + (b[c] - a[c]) * t + grainAt(x, yy, c));
        dst[i + 3] = 255;
      }
    }
  }
  return { image: out, x: x0, y: y0 };
}

/**
 * Whether painted features suit this skin. The patch and lid rules were tuned and reviewed on the
 * cream face most Chogs have; on the dark and the brightly coloured skins the refill shows as a
 * streaky rectangle (evidence/engine/mouth_area_outliers.png), so those keep the art untouched.
 */
export function paintableSkin(skin: Rgb) {
  return skin[0] + skin[1] + skin[2] >= 450 && Math.max(...skin) - Math.min(...skin) <= 60;
}

/**
 * Prepare the open-mouth paint for one token, or null when it must not be painted: this token's
 * mouth is covered, is not where its group puts it, or sits on a skin the fill was not made for.
 * Call only when rigFor() said paintMouth.
 */
export function openMouth(plate: Pixels, rig: FaceRig, skin: Rgb, grain?: Pixels | null) {
  if (!paintableSkin(skin)) return null;
  const target = rig.patch ?? rig.mouth;
  if (!fits(featureHole(plate, target, skin, MOUTH_PAD), rig.mouthExpect)) return null;
  return { patch: rig.inpaint === false ? null : mouthPatch(plate, target, MOUTH_PAD, skin, grain), box: rig.mouth };
}

/**
 * Bake a still open mouth onto a 1000×1000 plate (the share image). Call only when rigFor() said
 * paintMouth. Returns false, leaving the plate alone, when this token's mouth fails the check.
 */
export function paintOpenMouth(ctx: CanvasRenderingContext2D, rig: FaceRig, background?: string) {
  const plate = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
  const skin = sampleSkin(plate, rig.skin, parseColor(background));
  const open = openMouth(plate, rig, skin, skinSwatch(plate, rig.skin, skin));
  if (!open) return false;
  if (open.patch) ctx.putImageData(open.patch.image as ImageData, open.patch.x, open.patch.y);
  paintViseme(ctx, open.box, OPEN_SHAPE);
  return true;
}

export function traceViseme(box: Box, shape: Viseme) {
  const place = mouthPlacement(box);
  const w = shape.w * place.sx;
  const h = shape.h * place.sy;
  const r = shape.r;
  const hu = h * (0.06 + 0.5 * r);
  const hd = h * (1.15 - 0.6 * r);
  const yc = place.top + hu;
  const p = 1 - 0.45 * (1 - r);
  const points: Array<[number, number]> = [];
  for (let i = 0; i <= 48; i++) {
    const th = Math.PI + (i / 48) * 2 * Math.PI;
    const cs = Math.cos(th);
    const sn = Math.sin(th);
    const x = place.cx + w * Math.sign(cs) * Math.pow(Math.abs(cs), sn > 0 ? p : 1);
    const y = yc + (sn < 0 ? sn * hu : Math.pow(sn, p) * hd);
    points.push([x, y]);
  }
  return { points, place, w, h, hu, hd, yc };
}

export function paintViseme(ctx: CanvasRenderingContext2D, box: Box, shape: Viseme) {
  if (shape.h < 4) return;
  const { points, place, w, hu, hd, yc } = traceViseme(box, shape);
  const path = new Path2D();
  points.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
  path.closePath();
  ctx.lineJoin = "round";
  ctx.fillStyle = "#5b1730";
  ctx.fill(path);
  ctx.save();
  ctx.clip(path);
  ctx.fillStyle = "#e0577f";
  ctx.globalAlpha *= 1 - shape.t * 0.85;
  ctx.beginPath();
  ctx.ellipse(place.cx + 3, yc + hd * 0.95, w * 0.62, Math.max(2, hd * 0.5), 0, 0, 7);
  ctx.fill();
  ctx.globalAlpha = shape.t;
  ctx.fillStyle = "#f4efe6";
  ctx.fillRect(place.cx - w, yc - hu - 4, w * 2, hu + Math.min(14, hd * 0.4) + 4);
  ctx.restore();
  ctx.strokeStyle = "#121212";
  ctx.lineWidth = 10;
  ctx.stroke(path);
}

/** Decode an eye silhouette (row-major run lengths, starting with "outside"). */
export function unrle(runs: number[], length: number) {
  const out = new Uint8Array(length);
  let i = 0;
  let on = false;
  for (const n of runs) {
    if (on) out.fill(1, i, Math.min(length, i + n));
    i += n;
    on = !on;
  }
  return out;
}

/**
 * Where a lid may paint on this token: inside the group's eye silhouette, and only where the art is
 * black or white there. The outline, blush, hair and hats are never painted over, and the skin
 * around the eye keeps its own grain. Returns the fill mask and the silhouette (for the lid line).
 */
export function lidMasks(plate: Pixels, eye: Eye) {
  const m = eye.mask ?? { x: eye.x, y: eye.y, w: eye.w, h: eye.h, rle: [0, eye.w * eye.h] };
  const shape = unrle(m.rle, m.w * m.h);
  const fill = new Uint8Array(m.w * m.h);
  const d = plate.data;
  for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) {
      const k = y * m.w + x;
      const px = m.x + x;
      const py = m.y + y;
      if (!shape[k] || px < 0 || py < 0 || px >= plate.width || py >= plate.height) continue;
      const i = (py * plate.width + px) * 4;
      const chroma = Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
      if (chroma <= LID_CHROMA) fill[k] = 1;
    }
  }
  return { rect: { x: m.x, y: m.y, w: m.w, h: m.h }, fill, shape };
}

/**
 * A swatch of this token's real skin (up to four clean probe tiles side by side), so a lid carries
 * the art's grain instead of a flat colour. Null when no tile is clean.
 */
export function skinSwatch(plate: Pixels, probes: Box[], skin: Rgb): Pixels | null {
  const skinChroma = Math.max(...skin) - Math.min(...skin);
  const d = plate.data;
  const clean = probes.filter((box) => {
    if (box.x < 0 || box.y < 0 || box.x + box.w > plate.width || box.y + box.h > plate.height) return false;
    let ok = 0;
    for (let y = box.y; y < box.y + box.h; y++) {
      for (let x = box.x; x < box.x + box.w; x++) {
        const i = (y * plate.width + x) * 4;
        const chroma = Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
        if (chroma > skinChroma + 30) return false;
        if (dist(d, i, skin) <= NONSKIN) ok++;
      }
    }
    return ok >= box.w * box.h * 0.97;
  });
  const tiles = clean.slice(0, 4);
  if (!tiles.length) return null;
  const h = Math.min(...tiles.map((box) => box.h));
  const w = tiles.reduce((sum, box) => sum + box.w, 0);
  const out = blank(w, h);
  let ox = 0;
  for (const box of tiles) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < box.w; x++) {
        const si = ((box.y + y) * plate.width + box.x + x) * 4;
        const di = (y * w + ox + x) * 4;
        out.data[di] = d[si];
        out.data[di + 1] = d[si + 1];
        out.data[di + 2] = d[si + 2];
        out.data[di + 3] = 255;
      }
    }
    ox += box.w;
  }
  return out;
}

/** The lid's shape at `amount` (0 open, 1 shut): from above the eye down to a sagging curve. */
export function lidCurve(eye: Eye, amount: number) {
  const sag = eye.sag ?? 8;
  const ly = eye.y + eye.h * amount * LID_CLOSE;
  return { left: eye.x - 8, right: eye.x + eye.w + 8, top: eye.y - 8, ly, cx: eye.x + eye.w / 2, cy: ly + sag * amount };
}

/** Trace the lid fill (closed path) or its line onto ctx. */
export function traceLid(ctx: CanvasRenderingContext2D, eye: Eye, amount: number, part: "fill" | "line") {
  const c = lidCurve(eye, amount);
  ctx.beginPath();
  if (part === "fill") {
    ctx.moveTo(c.left, c.top);
    ctx.lineTo(c.right, c.top);
    ctx.lineTo(c.right, c.ly);
    ctx.quadraticCurveTo(c.cx, c.cy, c.left, c.ly);
    ctx.closePath();
  } else {
    ctx.moveTo(c.left, c.ly);
    ctx.quadraticCurveTo(c.cx, c.cy, c.right, c.ly);
  }
}

/** Paint a lid straight onto ctx, with no mask. For eyes measured by hand, without a silhouette. */
export function paintLid(ctx: CanvasRenderingContext2D, eye: Eye, amount: number, color: string | CanvasPattern) {
  if (amount <= 0.01) return;
  ctx.save();
  traceLid(ctx, eye, amount, "fill");
  ctx.fillStyle = color;
  ctx.fill();
  traceLid(ctx, eye, amount, "line");
  ctx.strokeStyle = "#121212";
  ctx.lineCap = "round";
  ctx.lineWidth = 8;
  ctx.stroke();
  ctx.restore();
}
