// Builds the app icons in public/icons from Chog #375's own NFT art (public/chog/375/art.webp), with
// the art's own background: no cut-out, so nothing is clipped from the hat. Run: node scripts/build-icons.mjs
//
//   icon-192.png, icon-512.png    "any": the whole head and beanie
//   icon-maskable-*.png           "maskable": the face sits inside the central 80% circle every launcher keeps
//   apple-touch-icon.png          iOS rounds the corners itself
//   icon-48.png, favicon.ico      the browser tab, cropped to the face so it reads at 16 px
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const ART = path.join(root, "public/chog/375/art.webp");
const OUT = path.join(root, "public/icons");

// Squares of the 1000×1400 art. The face leans right, so the maskable crop sits right of centre.
const HEAD = { left: 50, top: 20, width: 930, height: 930 };
const FACE = { left: 100, top: 50, width: 900, height: 900 };

function png(crop, size) {
  return sharp(ART).extract(crop).resize(size, size, { kernel: "lanczos3" }).png({ compressionLevel: 9, effort: 10 }).toBuffer();
}

/** An .ico holding PNG images (every current browser reads PNG-in-ICO). */
function ico(images) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, i) => {
    const at = 6 + i * 16;
    header.writeUInt8(size >= 256 ? 0 : size, at);
    header.writeUInt8(size >= 256 ? 0 : size, at + 1);
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(data.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map((image) => image.data)]);
}

const files = {
  "icon-192.png": await png(HEAD, 192),
  "icon-512.png": await png(HEAD, 512),
  "icon-maskable-192.png": await png(FACE, 192),
  "icon-maskable-512.png": await png(FACE, 512),
  "apple-touch-icon.png": await png(HEAD, 180),
  "icon-48.png": await png(FACE, 48),
  "favicon.ico": ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(FACE, size) })))),
};
for (const [name, data] of Object.entries(files)) {
  fs.writeFileSync(path.join(OUT, name), data);
  console.log(`${name}: ${data.length} bytes`);
}
