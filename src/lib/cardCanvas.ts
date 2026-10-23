import { paintOpenMouth, parseColor } from "@/lib/facePaint";
import { faceTraits, rigFor } from "@/lib/faceRig";
import { CARD_FONTS, PHONE_GLYPH, type CardScene } from "@/lib/shareCard";
import type { ChogProfile } from "@/lib/types";

// Draws a share-card scene (src/lib/shareCard.ts) on a canvas, in the browser and the APK. The
// server draws the same scene for X with ImageResponse (src/app/c/card.tsx).

let fonts: Promise<boolean> | null = null;

/** Loads the card's own cuts of Fraunces and Inter once. False when any is missing (system fonts stand in). */
export function loadCardFonts(): Promise<boolean> {
  fonts ??= (async () => {
    if (typeof FontFace === "undefined" || typeof document === "undefined" || !document.fonts) return false;
    const faces = Object.values(CARD_FONTS).map(
      (font) => new FontFace(font.family, `url(/fonts/card/${font.file}) format("woff")`, { weight: String(font.weight), style: "normal" }),
    );
    const loaded = await Promise.all(faces.map((face) => face.load().catch(() => null)));
    for (const face of loaded) if (face) document.fonts.add(face);
    return loaded.every(Boolean);
  })();
  return fonts;
}

/** rgba() for a hex colour at an alpha. */
export function tint(color: string, alpha: number): string {
  const rgb = parseColor(color) ?? [255, 255, 255];
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${Math.round(alpha * 1000) / 1000})`;
}

/**
 * The portrait as it goes on a card: 1000×1000, on the token's own background, with the mouth open
 * when this token's face passes the engine's check. Null only without a 2D context.
 */
export async function portraitPlate(profile: ChogProfile): Promise<HTMLCanvasElement | null> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  await new Promise<void>((resolve) => {
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = profile.image;
  });
  const plate = document.createElement("canvas");
  plate.width = 1000;
  plate.height = 1000;
  const ctx = plate.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = profile.background;
  ctx.fillRect(0, 0, 1000, 1000);
  if (img.naturalWidth) {
    // The demo busts are transparent: they sit on the token's own background, as in the engine.
    ctx.drawImage(img, 0, 0, 1000, 1000);
    const face = rigFor(profile.artId, profile.side, faceTraits(profile.traits));
    if (face.paintMouth) {
      try {
        paintOpenMouth(ctx, face.rig, profile.background);
      } catch {
        /* cross-origin art can't be read back: the face stays as painted, and the card won't export */
      }
    }
  }
  return plate;
}

/** The arch's outline: a half-circle top on a square with rounded bottom corners. */
function archPath(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, corner: number) {
  const r = size / 2;
  ctx.beginPath();
  ctx.moveTo(x, y + r);
  ctx.arc(x + r, y + r, r, Math.PI, 0);
  ctx.lineTo(x + size, y + size - corner);
  ctx.arcTo(x + size, y + size, x + size - corner, y + size, corner);
  ctx.lineTo(x + corner, y + size);
  ctx.arcTo(x, y + size, x, y + size - corner, corner);
  ctx.closePath();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Paints a scene. `plate` is the portrait; without one the arch shows the token's background. */
export function paintScene(ctx: CanvasRenderingContext2D, scene: CardScene, plate: CanvasImageSource | null) {
  const { w, h } = scene;
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  for (const [at, color] of scene.sky) sky.addColorStop(at, color);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  for (const glow of scene.glows) {
    const g = ctx.createRadialGradient(glow.cx, glow.cy, 0, glow.cx, glow.cy, glow.r);
    g.addColorStop(0, tint(glow.color, glow.alpha));
    g.addColorStop(0.45, tint(glow.color, glow.alpha * 0.5));
    g.addColorStop(1, tint(glow.color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(glow.cx - glow.r, glow.cy - glow.r, glow.r * 2, glow.r * 2);
  }

  for (const star of scene.stars) {
    ctx.fillStyle = `rgba(255,255,255,${star.alpha})`;
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
    ctx.fill();
  }

  const { arch } = scene;
  ctx.save();
  ctx.shadowColor = "rgba(6,8,28,0.5)";
  ctx.shadowBlur = arch.size * 0.09;
  ctx.shadowOffsetY = arch.size * 0.035;
  archPath(ctx, arch.x - arch.ring, arch.y - arch.ring, arch.size + 2 * arch.ring, arch.corner + arch.ring);
  ctx.fillStyle = "#fffdfb";
  ctx.fill();
  ctx.restore();
  ctx.save();
  archPath(ctx, arch.x, arch.y, arch.size, arch.corner);
  ctx.clip();
  ctx.fillStyle = arch.background;
  ctx.fillRect(arch.x, arch.y, arch.size, arch.size);
  if (plate) ctx.drawImage(plate, arch.x, arch.y, arch.size, arch.size);
  ctx.restore();

  const { bubble } = scene;
  ctx.save();
  ctx.shadowColor = "rgba(6,8,28,0.38)";
  ctx.shadowBlur = 44;
  ctx.shadowOffsetY = 16;
  roundRect(ctx, bubble.x, bubble.y, bubble.w, bubble.h, bubble.r);
  ctx.fillStyle = "#fffdfb";
  ctx.fill();
  ctx.restore();
  ctx.beginPath();
  bubble.tail.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = "#fffdfb";
  ctx.fill();

  for (const pill of scene.pills) {
    roundRect(ctx, pill.x, pill.y, pill.w, pill.h, pill.h / 2);
    ctx.fillStyle = pill.fill;
    ctx.fill();
    if (pill.stroke) {
      ctx.strokeStyle = pill.stroke;
      ctx.lineWidth = 2;
      roundRect(ctx, pill.x + 1, pill.y + 1, pill.w - 2, pill.h - 2, pill.h / 2 - 1);
      ctx.stroke();
    }
  }

  const glyph = typeof Path2D === "undefined" ? null : new Path2D(PHONE_GLYPH);
  for (const icon of scene.icons) {
    ctx.fillStyle = icon.fill;
    ctx.beginPath();
    ctx.arc(icon.cx, icon.cy, icon.r, 0, Math.PI * 2);
    ctx.fill();
    if (!glyph) continue;
    const s = icon.r * 1.05;
    ctx.save();
    ctx.translate(icon.cx - s / 2, icon.cy - s / 2);
    ctx.scale(s / 24, s / 24);
    ctx.strokeStyle = icon.glyphColor;
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke(glyph);
    ctx.restore();
  }

  const spaced = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  ctx.textBaseline = "alphabetic";
  for (const t of scene.texts) {
    const font = CARD_FONTS[t.font];
    ctx.font = `${font.weight} ${t.size}px ${font.family}, ${font.family === "CardSerif" ? "Georgia, serif" : "system-ui, sans-serif"}`;
    spaced.letterSpacing = `${t.tracking}px`;
    ctx.fillStyle = t.color;
    ctx.textAlign = t.align;
    const x = t.align === "left" ? t.x : t.align === "center" ? t.x + t.w / 2 : t.x + t.w;
    ctx.fillText(t.text, x, t.baseline);
  }
  spaced.letterSpacing = "0px";
}

/** The scene as a PNG. Null when the canvas refuses to export (tainted by cross-origin art). */
export async function renderCard(scene: CardScene, plate: CanvasImageSource | null): Promise<Blob | null> {
  await loadCardFonts();
  const canvas = document.createElement("canvas");
  canvas.width = scene.w;
  canvas.height = scene.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  paintScene(ctx, scene, plate);
  try {
    return await new Promise<Blob | null>((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
  } catch {
    return null;
  }
}
