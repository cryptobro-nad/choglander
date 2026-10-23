import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import { readSharedCard } from "@/app/c/share";
import { isDemoArt } from "@/lib/chog";
import { OPEN_SHAPE, openMouth, parseColor, sampleSkin, skinSwatch, traceViseme, type Pixels, type Viseme } from "@/lib/facePaint";
import { faceTraits, rigFor, type Box } from "@/lib/faceRig";
import { portrait } from "@/lib/portraitSource";
import { CARD_FONTS, CARD_SIZE, PHONE_GLYPH, cardInput, cardScene, type CardFormat, type CardScene } from "@/lib/shareCard";
import type { ChogProfile } from "@/lib/types";

// The share card drawn on the server, for X and every other link preview: the same scene the app
// paints on its canvas (src/lib/cardCanvas.ts), set with the same fonts and the same line breaks.

const PLATE = 1000;

/** The open mouth (facePaint.paintViseme) as SVG, over a 1000×1000 plate. */
export function visemeSvg(box: Box, shape: Viseme = OPEN_SHAPE): string {
  const { points, place, w, hd, hu, yc } = traceViseme(box, shape);
  const d = `${points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("")}Z`;
  const teeth =
    shape.t > 0
      ? `<rect x="${(place.cx - w).toFixed(1)}" y="${(yc - hu - 4).toFixed(1)}" width="${(w * 2).toFixed(1)}" height="${(hu + Math.min(14, hd * 0.4) + 4).toFixed(1)}" fill="#f4efe6" fill-opacity="${shape.t}"/>`
      : "";
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PLATE}" height="${PLATE}" viewBox="0 0 ${PLATE} ${PLATE}">`,
    `<defs><clipPath id="m"><path d="${d}"/></clipPath></defs>`,
    `<path d="${d}" fill="#5b1730"/>`,
    `<g clip-path="url(#m)"><ellipse cx="${(place.cx + 3).toFixed(1)}" cy="${(yc + hd * 0.95).toFixed(1)}" rx="${(w * 0.62).toFixed(1)}" ry="${Math.max(2, hd * 0.5).toFixed(1)}" fill="#e0577f" fill-opacity="${1 - shape.t * 0.85}"/>${teeth}</g>`,
    `<path d="${d}" fill="none" stroke="#121212" stroke-width="10" stroke-linejoin="round"/>`,
    `</svg>`,
  ].join("");
}

async function portraitBytes(artId: number): Promise<Uint8Array | null> {
  if (isDemoArt(artId)) return readFile(path.join(process.cwd(), "public/chog", `${artId}.webp`));
  return portrait(artId);
}

/**
 * The portrait for a card as a JPEG data URL, `px` square: on its background, the mouth open when the
 * face allows. It is opaque, and a JPEG is a tenth of the PNG's size, which the renderer decodes faster.
 */
export async function portraitDataUrl(profile: ChogProfile, px: number): Promise<string | null> {
  const bytes = await portraitBytes(profile.artId);
  if (!bytes) return null;
  const { data } = await sharp(bytes)
    .resize(PLATE, PLATE, { fit: "fill" })
    .flatten({ background: profile.background })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const plate: Pixels = { width: PLATE, height: PLATE, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
  const overlays: { input: Buffer }[] = [];
  const face = rigFor(profile.artId, profile.side, faceTraits(profile.traits));
  if (face.paintMouth) {
    const skin = sampleSkin(plate, face.rig.skin, parseColor(profile.background));
    const open = openMouth(plate, face.rig, skin, skinSwatch(plate, face.rig.skin, skin));
    if (open) {
      if (open.patch) {
        const { image, x, y } = open.patch;
        for (let row = 0; row < image.height; row++) {
          const from = row * image.width * 4;
          plate.data.set(image.data.subarray(from, from + image.width * 4), ((y + row) * PLATE + x) * 4);
        }
      }
      overlays.push({ input: Buffer.from(visemeSvg(open.box)) });
    }
  }
  const painted = await sharp(Buffer.from(plate.data.buffer, plate.data.byteOffset, plate.data.length), { raw: { width: PLATE, height: PLATE, channels: 4 } })
    .composite(overlays)
    .png()
    .toBuffer();
  const jpeg = await sharp(painted).resize(px, px).jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}

type FontOption = { name: string; data: Buffer; weight: 500 | 600; style: "normal" };
let fonts: Promise<FontOption[]> | null = null;

function cardFonts(): Promise<FontOption[]> {
  fonts ??= Promise.all(
    Object.values(CARD_FONTS).map(async (font) => ({
      name: font.family,
      data: await readFile(path.join(process.cwd(), "public/fonts/card", font.file)),
      weight: font.weight,
      style: "normal" as const,
    })),
  ).catch((error) => {
    fonts = null;
    throw error;
  });
  return fonts;
}

function rgba(color: string, alpha: number) {
  const rgb = parseColor(color) ?? [255, 255, 255];
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${Math.round(alpha * 1000) / 1000})`;
}

/** The scene as ImageResponse markup: every piece absolutely placed where the canvas puts it. */
export function SceneView({ scene, plate }: { scene: CardScene; plate: string | null }) {
  const { w, h, arch, bubble } = scene;
  const ring = arch.size + 2 * arch.ring;
  return (
    <div style={{ display: "flex", position: "relative", width: w, height: h, backgroundColor: scene.sky[0][1], overflow: "hidden" }}>
      {/* The sky, its glows and stars as one SVG: CSS radial gradients on boxes that run off the card leave seams. */}
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ position: "absolute", left: 0, top: 0 }}>
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            {scene.sky.map(([at, color], i) => (
              <stop key={i} offset={at} stopColor={color} />
            ))}
          </linearGradient>
          {scene.glows.map((glow, i) => (
            <radialGradient key={i} id={`glow${i}`} cx={glow.cx} cy={glow.cy} r={glow.r} gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor={rgba(glow.color, 1)} stopOpacity={glow.alpha} />
              <stop offset="0.45" stopColor={rgba(glow.color, 1)} stopOpacity={glow.alpha * 0.5} />
              <stop offset="1" stopColor={rgba(glow.color, 1)} stopOpacity={0} />
            </radialGradient>
          ))}
        </defs>
        <rect width={w} height={h} fill="url(#sky)" />
        {scene.glows.map((_, i) => (
          <rect key={i} width={w} height={h} fill={`url(#glow${i})`} />
        ))}
        {scene.stars.map((star, i) => (
          <circle key={i} cx={star.x} cy={star.y} r={star.r} fill="#ffffff" fillOpacity={star.alpha} />
        ))}
      </svg>
      <div
        style={{
          position: "absolute",
          left: arch.x - arch.ring,
          top: arch.y - arch.ring,
          width: ring,
          height: ring,
          borderRadius: `${ring / 2}px ${ring / 2}px ${arch.corner + arch.ring}px ${arch.corner + arch.ring}px`,
          backgroundColor: "#fffdfb",
          boxShadow: `0 ${Math.round(arch.size * 0.035)}px ${Math.round(arch.size * 0.09)}px rgba(6,8,28,0.5)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          display: "flex",
          left: arch.x,
          top: arch.y,
          width: arch.size,
          height: arch.size,
          overflow: "hidden",
          borderRadius: `${arch.size / 2}px ${arch.size / 2}px ${arch.corner}px ${arch.corner}px`,
          backgroundColor: arch.background,
        }}
      >
        {plate && (
          // eslint-disable-next-line @next/next/no-img-element -- ImageResponse markup, not a page
          <img src={plate} width={arch.size} height={arch.size} alt="" style={{ width: arch.size, height: arch.size }} />
        )}
      </div>
      <div
        style={{
          position: "absolute",
          left: bubble.x,
          top: bubble.y,
          width: bubble.w,
          height: bubble.h,
          borderRadius: bubble.r,
          backgroundColor: "#fffdfb",
          boxShadow: "0 16px 44px rgba(6,8,28,0.38)",
        }}
      />
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ position: "absolute", left: 0, top: 0 }}>
        <path d={`M${bubble.tail.map(([x, y]) => `${x} ${y}`).join(" L")} Z`} fill="#fffdfb" />
      </svg>
      {scene.pills.map((pill, i) => (
        <div
          key={`p${i}`}
          style={{
            position: "absolute",
            left: pill.x,
            top: pill.y,
            width: pill.w,
            height: pill.h,
            borderRadius: pill.h / 2,
            backgroundColor: pill.fill,
            border: pill.stroke ? `2px solid ${pill.stroke}` : "none",
          }}
        />
      ))}
      {scene.icons.map((icon, i) => {
        const s = icon.r * 1.05;
        return (
          <div key={`i${i}`} style={{ position: "absolute", display: "flex", left: icon.cx - icon.r, top: icon.cy - icon.r, width: icon.r * 2, height: icon.r * 2 }}>
            <div style={{ position: "absolute", left: 0, top: 0, width: icon.r * 2, height: icon.r * 2, borderRadius: icon.r, backgroundColor: icon.fill }} />
            <svg width={s} height={s} viewBox="0 0 24 24" style={{ position: "absolute", left: icon.r - s / 2, top: icon.r - s / 2 }}>
              <path d={PHONE_GLYPH} fill="none" stroke={icon.glyphColor} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        );
      })}
      {scene.texts.map((t, i) => {
        const font = CARD_FONTS[t.font];
        return (
          <div
            key={`t${i}`}
            style={{
              position: "absolute",
              display: "flex",
              left: t.x,
              top: t.y,
              width: t.w,
              height: t.h,
              justifyContent: t.align === "left" ? "flex-start" : t.align === "center" ? "center" : "flex-end",
              fontFamily: font.family,
              fontWeight: font.weight,
              fontSize: t.size,
              lineHeight: `${t.h}px`,
              letterSpacing: t.tracking,
              color: t.color,
              whiteSpace: "pre",
            }}
          >
            {t.text}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The image for /c/<art>/<line>: the wide card by default (1200×630, X's summary_large_image), as a
 * JPEG. The PNG was half a megabyte, and messengers (WhatsApp among them) drop a preview that heavy.
 */
export async function cardImage(art: string, segment: string, format: CardFormat = "wide"): Promise<Response> {
  const card = await readSharedCard(art, segment);
  if (!card) return new Response("Not a Chog card.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const scene = cardScene(format, cardInput(card.profile, card.line));
  const plate = await portraitDataUrl(card.profile, Math.ceil(scene.arch.size * 1.5)).catch(() => null);
  const png = new ImageResponse(<SceneView scene={scene} plate={plate} />, {
    width: CARD_SIZE[format].w,
    height: CARD_SIZE[format].h,
    fonts: await cardFonts(),
  });
  const jpeg = await sharp(Buffer.from(await png.arrayBuffer())).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  return new Response(new Uint8Array(jpeg), {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(jpeg.length),
      // The link names the card exactly (the art and the line), so browsers and the CDN keep it for a
      // year (a new deploy starts a new CDN cache). Without the portrait (every gateway busy) it is not
      // kept, and the next ask tries again.
      "Cache-Control": plate ? "public, max-age=31536000, s-maxage=31536000, immutable" : "no-store",
    },
  });
}
