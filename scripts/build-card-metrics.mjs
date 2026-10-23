// Writes src/lib/cardMetrics.json: the advance width of every character the share card can set,
// for each static font in public/fonts/card. The card is drawn twice, on a canvas in the app and by
// ImageResponse on the server (the X card), and both wrap the line with these numbers, so the two
// break it in exactly the same places.
//
//   node scripts/build-card-metrics.mjs
//
// Reads WOFF 1.0 (zlib per table): cmap format 4 and hmtx. Kerning is left out; the layout keeps a
// small margin for it.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const root = process.cwd();
const FONTS = {
  serif: "fraunces-500.woff",
  serifBold: "fraunces-600.woff",
  sans: "inter-500.woff",
  sansBold: "inter-600.woff",
};

/** Printable Latin-1 and the punctuation lines use (quotes, dashes, ellipsis, bullets). */
const RANGES = [
  [0x20, 0x7e],
  [0xa0, 0xff],
  [0x2010, 0x2027],
  [0x2030, 0x203a],
];

function tables(woff) {
  const view = new DataView(woff.buffer, woff.byteOffset, woff.byteLength);
  if (view.getUint32(0) !== 0x774f4646) throw new Error("not a WOFF 1.0 file");
  const count = view.getUint16(12);
  const out = {};
  for (let i = 0; i < count; i++) {
    const at = 44 + i * 20;
    const tag = String.fromCharCode(...woff.subarray(at, at + 4));
    const offset = view.getUint32(at + 4);
    const compLength = view.getUint32(at + 8);
    const origLength = view.getUint32(at + 12);
    const raw = woff.subarray(offset, offset + compLength);
    const data = compLength < origLength ? zlib.inflateSync(raw) : Buffer.from(raw);
    out[tag] = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }
  return out;
}

function cmap4(cmap) {
  const count = cmap.getUint16(2);
  let sub = -1;
  for (let i = 0; i < count; i++) {
    const platform = cmap.getUint16(4 + i * 8);
    const encoding = cmap.getUint16(6 + i * 8);
    const offset = cmap.getUint32(8 + i * 8);
    if (cmap.getUint16(offset) === 4 && (platform === 3 || platform === 0) && (encoding === 1 || platform === 0)) sub = offset;
  }
  if (sub < 0) throw new Error("no cmap format 4");
  const segX2 = cmap.getUint16(sub + 6);
  const ends = sub + 14;
  const starts = ends + segX2 + 2;
  const deltas = starts + segX2;
  const ranges = deltas + segX2;
  return (code) => {
    for (let s = 0; s < segX2; s += 2) {
      const end = cmap.getUint16(ends + s);
      if (code > end) continue;
      const start = cmap.getUint16(starts + s);
      if (code < start) return 0;
      const delta = cmap.getInt16(deltas + s);
      const rangeOffset = cmap.getUint16(ranges + s);
      if (!rangeOffset) return (code + delta) & 0xffff;
      const glyph = cmap.getUint16(ranges + s + rangeOffset + (code - start) * 2);
      return glyph ? (glyph + delta) & 0xffff : 0;
    }
    return 0;
  };
}

function metrics(file) {
  const t = tables(fs.readFileSync(path.join(root, "public/fonts/card", file)));
  const upem = t.head.getUint16(18);
  const ascent = t.hhea.getInt16(4);
  const descent = t.hhea.getInt16(6);
  const longMetrics = t.hhea.getUint16(34);
  const glyphOf = cmap4(t.cmap);
  const advanceOf = (glyph) => t.hmtx.getUint16(4 * Math.min(glyph, longMetrics - 1));
  const adv = {};
  for (const [from, to] of RANGES) {
    for (let code = from; code <= to; code++) {
      const glyph = glyphOf(code);
      if (glyph) adv[String.fromCodePoint(code)] = Math.round((advanceOf(glyph) / upem) * 10000) / 10000;
    }
  }
  return { ascent: Math.round((ascent / upem) * 1000) / 1000, descent: Math.round((-descent / upem) * 1000) / 1000, adv };
}

const out = Object.fromEntries(Object.entries(FONTS).map(([key, file]) => [key, metrics(file)]));
const target = path.join(root, "src/lib/cardMetrics.json");
fs.writeFileSync(target, `${JSON.stringify(out)}\n`);
console.log(`Wrote ${path.relative(root, target)}: ${Object.keys(out).length} fonts, ${Object.keys(out.serif.adv).length} characters each.`);
