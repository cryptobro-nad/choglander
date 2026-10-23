// Builds src/app/og-base.png, the home page's link preview without its title (opengraph-image.tsx
// sets "Choglander" over it). The left side (sky, incoming-call pill, tagline, sun) comes from
// scripts/og-backdrop.png; the right side is drawn here from the real token art in public/chog, so
// every Chog looks exactly as its NFT does. The Hype Man (#642) is the main act: the big card in front.
// Usage: node scripts/build-og.mjs
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "..");
const BACKDROP = path.join(root, "scripts/og-backdrop.png");
const OUT = path.join(root, "src/app/og-base.png");
const W = 1200;
const H = 630;

/** The setting sun in the old preview: its centre and radius, so the wash never eats into it. */
const SUN = { x: 565, y: 627, r: 95 };

/** Where a row's wash starts: just right of the sun (and its glow) on the rows it rises into, else x = 600. */
function washFrom(y) {
  const dy = y - SUN.y;
  const edge = Math.abs(dy) < SUN.r ? SUN.x + Math.sqrt(SUN.r * SUN.r - dy * dy) : 0;
  return Math.max(600, Math.round(edge + 18));
}

/**
 * The backdrop: the old preview with its right side washed back to plain sky, row by row from the
 * sky at the far right edge, faded in over 22 px so the seam never shows. Made once from the old
 * og-base.png, then kept, so running this again never draws cards over cards.
 */
async function backdrop() {
  if (fs.existsSync(BACKDROP)) return fs.readFileSync(BACKDROP);
  const { data, info } = await sharp(OUT).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (x, y, c) => data[(y * info.width + x) * 3 + c];
  for (let y = 0; y < H; y++) {
    const FROM = washFrom(y);
    const FULL = FROM + 22;
    // The sky at this row, at both ends of the wash: medians, so a star never smears into a streak.
    const median = (from, to) =>
      [0, 1, 2].map((c) => {
        const values = [];
        for (let x = from; x < to; x++) values.push(at(x, y, c));
        return values.sort((a, b) => a - b)[values.length >> 1];
      });
    const near = median(FROM - 7, FROM);
    const far = median(W - 16, W);
    // The sky brightens toward the sun, so the wash runs from the colour at its start to the one at
    // the edge instead of one flat colour, and leaves no seam.
    for (let x = FROM; x < W; x++) {
      const t = Math.min(1, (x - FROM) / (FULL - FROM));
      const mix = t * t * (3 - 2 * t);
      const along = (x - FROM) / (W - 1 - FROM);
      for (let c = 0; c < 3; c++) {
        const sky = near[c] + (far[c] - near[c]) * along;
        const i = (y * info.width + x) * 3 + c;
        data[i] = Math.round(data[i] * (1 - mix) + sky * mix);
      }
    }
  }
  const png = await sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } }).png().toBuffer();
  fs.writeFileSync(BACKDROP, png);
  return png;
}

/** An arch: a square whose top is a half circle, the shape the app draws every Chog in. */
const arch = (size, inset = 0) => {
  const s = size - inset * 2;
  const r = s / 2;
  const foot = Math.round(s * 0.11);
  return `M ${inset} ${inset + r} A ${r} ${r} 0 0 1 ${inset + s} ${inset + r} L ${inset + s} ${inset + s - foot} Q ${inset + s} ${inset + s} ${inset + s - foot} ${inset + s} L ${inset + foot} ${inset + s} Q ${inset} ${inset + s} ${inset} ${inset + s - foot} Z`;
};

/** One Chog in its arch, white rim, soft shadow and name tag, on a transparent tile; then tilted. */
async function card(artId, size, label, tilt) {
  const rim = Math.round(size * 0.035);
  const pad = Math.round(size * 0.18);
  const tagH = Math.round(size * 0.13);
  const tile = { w: size + pad * 2, h: size + pad * 2 + tagH };
  const art = await sharp(path.join(root, "public/chog", `${artId}.webp`))
    .resize(size - rim * 2, size - rim * 2, { fit: "cover" })
    .png()
    .toBuffer();
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size - rim * 2}" height="${size - rim * 2}"><path d="${arch(size - rim * 2)}" fill="#fff"/></svg>`);
  const inner = await sharp(art).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
  const font = Math.round(tagH * 0.46);
  const tagW = Math.round(label.length * font * 0.58 + font * 1.9);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${tile.w}" height="${tile.h}">
    <defs><filter id="s" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="${Math.round(size * 0.035)}"/></filter></defs>
    <g transform="translate(${pad} ${pad + Math.round(size * 0.045)})" opacity="0.5" filter="url(#s)"><path d="${arch(size)}" fill="#090a1f"/></g>
    <g transform="translate(${pad} ${pad})"><path d="${arch(size)}" fill="#ffffff"/></g>
    <g transform="translate(${pad + size / 2 - tagW / 2} ${pad + size - tagH * 0.45})">
      <rect width="${tagW}" height="${tagH}" rx="${tagH / 2}" fill="#ffffff"/>
      <text x="${tagW / 2}" y="${tagH * 0.66}" text-anchor="middle" font-family="Segoe UI, Inter, Arial, sans-serif" font-weight="600" font-size="${font}" fill="#1b2150">${label}</text>
    </g>
  </svg>`;
  // The name tag goes on after the art, so it sits over the arch's foot as the app's tags do.
  const body = await sharp(Buffer.from(svg))
    .composite([{ input: inner, left: pad + rim, top: pad + rim }])
    .png()
    .toBuffer();
  const tagOnly = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${tile.w}" height="${tile.h}">
    <g transform="translate(${pad + size / 2 - tagW / 2} ${pad + size - tagH * 0.45})">
      <rect width="${tagW}" height="${tagH}" rx="${tagH / 2}" fill="#ffffff"/>
      <text x="${tagW / 2}" y="${tagH * 0.66}" text-anchor="middle" font-family="Segoe UI, Inter, Arial, sans-serif" font-weight="600" font-size="${font}" fill="#1b2150">${label}</text>
    </g></svg>`);
  const flat = await sharp(body).composite([{ input: tagOnly }]).png().toBuffer();
  const turned = await sharp(flat).rotate(tilt, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const meta = await sharp(turned).metadata();
  return { input: turned, width: meta.width, height: meta.height };
}

/** Places a tile so the arch's centre lands on (cx, cy). */
const at = (tile, cx, cy) => ({ input: tile.input, left: Math.round(cx - tile.width / 2), top: Math.round(cy - tile.height / 2) });

const stars = [
  [742, 40, 1.4], [812, 22, 1.1], [905, 58, 1.6], [1012, 30, 1.2], [1110, 64, 1.5], [1170, 24, 1.1],
  [1182, 212, 1.3], [1176, 404, 1.2], [1188, 560, 1.4], [700, 604, 1.1], [1050, 606, 1.3], [880, 612, 1.0],
];
const starSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${stars
  .map(([x, y, r], i) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#ffffff" opacity="${0.55 + (i % 3) * 0.15}"/>`)
  .join("")}</svg>`);

const base = await backdrop();
const toldYouSo = await card(375, 204, "Told-you-so", -5);
const professor = await card(821, 204, "Professor", 4);
const gremlin = await card(242, 176, "Gremlin", -4);
const hype = await card(642, 330, "Hype man", 3);

const out = await sharp(base)
  .composite([
    { input: starSvg },
    at(toldYouSo, 772, 186),
    at(professor, 772, 452),
    at(gremlin, 1092, 522),
    at(hype, 1000, 270),
  ])
  .png({ compressionLevel: 9 })
  .toBuffer();
fs.writeFileSync(OUT, out);
console.log("wrote", path.relative(root, OUT), out.length, "bytes");
