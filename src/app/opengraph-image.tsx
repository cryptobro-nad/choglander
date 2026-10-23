import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import sharp from "sharp";

// The home page's link preview: the Hype Man up front with three more Chogs beside an incoming call,
// and the name set in Fraunces over the night sky (src/app/og-base.png is the picture without its
// title; scripts/build-og.mjs draws it from the real token art).

export const alt = "Choglander: the Hype Man, Chog #642, in front of three more Chogs in their arches, beside an incoming call at 7:30 am. Your Chog wakes you up, knows your day, and makes you laugh.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/jpeg";

/**
 * Sent as a JPEG, as the share cards are (src/app/c/card.tsx): the PNG was 726 KB, and messengers
 * drop a preview that heavy. Its URL carries a hash of this file, so browsers and the CDN keep it for
 * a year. A new og-base.png alone keeps the URL: change this file with it.
 */
export default async function Image() {
  const [base, serif] = await Promise.all([
    readFile(path.join(process.cwd(), "src/app/og-base.png")),
    readFile(path.join(process.cwd(), "public/fonts/card/fraunces-500.woff")),
  ]);
  const png = new ImageResponse(
    (
      <div style={{ width: 1200, height: 630, display: "flex", position: "relative" }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- satori draws plain img elements */}
        <img src={`data:image/png;base64,${base.toString("base64")}`} width={1200} height={630} alt="" style={{ position: "absolute", left: 0, top: 0 }} />
        <div style={{ position: "absolute", left: 76, top: 238, fontFamily: "Fraunces", fontSize: 94, color: "#fffdfb", letterSpacing: -1.5, lineHeight: 1 }}>
          Choglander
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: "Fraunces", data: serif, weight: 500, style: "normal" }] },
  );
  const jpeg = await sharp(Buffer.from(await png.arrayBuffer())).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  return new Response(new Uint8Array(jpeg), {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(jpeg.length),
      "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable",
    },
  });
}
