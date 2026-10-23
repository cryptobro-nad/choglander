import metricsJson from "@/lib/cardMetrics.json";
import { faceTraits, rigFor } from "@/lib/faceRig";
import type { ChogProfile } from "@/lib/types";
import { ARCHETYPE_LABEL, lineIsClean, stripAudioTags } from "@/lib/voices";

// The share card: "a Chog calls you". One layout, drawn twice: on a canvas in the app (the story,
// the square post, and the wide card it previews) and by ImageResponse on the server, which renders
// the wide card as the og:image X unfurls. Everything here is pure data, so both renderers place the
// same shapes at the same coordinates and break the line in the same places.

export type CardFormat = "story" | "square" | "wide";

export const CARD_FORMATS: CardFormat[] = ["story", "square", "wide"];

export const CARD_SIZE: Record<CardFormat, { w: number; h: number }> = {
  story: { w: 1080, h: 1920 },
  square: { w: 1080, h: 1080 },
  wide: { w: 1200, h: 630 },
};

export type CardFont = "serif" | "serifBold" | "sans" | "sansBold";

/** Static cuts of the app's Fraunces and Inter (public/fonts/card): canvas and ImageResponse load the same files. */
export const CARD_FONTS: Record<CardFont, { file: string; family: "CardSerif" | "CardSans"; weight: 500 | 600 }> = {
  serif: { file: "fraunces-500.woff", family: "CardSerif", weight: 500 },
  serifBold: { file: "fraunces-600.woff", family: "CardSerif", weight: 600 },
  sans: { file: "inter-500.woff", family: "CardSans", weight: 500 },
  sansBold: { file: "inter-600.woff", family: "CardSans", weight: 600 },
};

type FontMetrics = { ascent: number; descent: number; adv: Record<string, number> };
const METRICS = metricsJson as Record<CardFont, FontMetrics>;
/** An emoji or a character outside the table: about the width of an "n". */
const FALLBACK_ADVANCE = 0.58;
/** Kerning is not in the table; wrapping keeps this much spare width for it. */
const KERN_SLACK = 0.97;

/** Width of a run of text set in a card font, in pixels. */
export function textWidth(text: string, font: CardFont, size: number, tracking = 0): number {
  const adv = METRICS[font].adv;
  let units = 0;
  let count = 0;
  for (const ch of text) {
    units += adv[ch] ?? FALLBACK_ADVANCE;
    count += 1;
  }
  return units * size + tracking * count;
}

// ---------------------------------------------------------------------------------------------
// The line

/** The longest line a card carries; a longer one is cut at a word and ends in an ellipsis. */
export const LINE_MAX = 220;

/**
 * Control, zero-width, line-separator and bidi-override characters never reach a card or a URL.
 * Built from a string: a bundler may print a regex literal's   as the raw character, which
 * ends the line and breaks the literal.
 */
const INVISIBLE = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u206f\\ufeff]", "g");

/** The line as a card shows it: no audio tags, no control characters, no wrapping quotes, at most LINE_MAX. */
export function cleanLine(raw: string | null | undefined): string {
  let text = stripAudioTags(String(raw ?? ""))
    .replace(INVISIBLE, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["“”]+|["“”]+$/g, "")
    .trim();
  const chars = Array.from(text);
  if (chars.length > LINE_MAX) {
    const cut = chars.slice(0, LINE_MAX - 1).join("");
    const space = cut.lastIndexOf(" ");
    text = `${(space > LINE_MAX * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.!?—–-]+$/, "")}…`;
  }
  return text;
}

/** The line as a URL segment: base64url of its UTF-8, so any punctuation survives and nothing needs escaping. */
export function encodeLine(line: string): string {
  const bytes = new TextEncoder().encode(cleanLine(line));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The line a share URL carries, or null when the segment is not one this app could have made. */
export function decodeLine(segment: string): string | null {
  if (!/^[A-Za-z0-9_-]{2,400}$/.test(segment)) return null;
  try {
    const padded = segment.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (segment.length % 4)) % 4);
    const binary = atob(padded);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
    const line = cleanLine(text);
    return line && lineIsClean(line) ? line : null;
  } catch {
    return null;
  }
}

/** The public page for one card: /c/<art>/<line>. Its og:image is the wide card. */
export function sharePagePath(artId: number, line: string): string {
  return `/c/${artId}/${encodeLine(line)}`;
}

/** A bare http(s) origin, or "" for anything else. */
export function cleanOrigin(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : "";
  } catch {
    return "";
  }
}

/**
 * The public address a shared card links to. On the web it is the site itself. The APK runs at
 * https://localhost, which no one else can open, so it uses the address it was built with
 * (NEXT_PUBLIC_SITE_URL, else NEXT_PUBLIC_CHOG_API_ORIGIN), or "" when there is none.
 */
export function shareOrigin(opts: { site?: string; api?: string; exported?: boolean; native?: boolean; location?: string }): string {
  const configured = cleanOrigin(opts.site) || cleanOrigin(opts.api);
  if (opts.native || opts.exported) return configured;
  return cleanOrigin(opts.location) || configured;
}

/** True for an origin no one else can open (this machine, a LAN address, the APK's own https://localhost). */
export function isPrivateOrigin(origin: string): boolean {
  const clean = cleanOrigin(origin);
  if (!clean) return true;
  const host = new URL(clean).hostname.replace(/^\[|\]$/g, "");
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "::1" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

/** The host a card prints under the brand: only a public one. */
export function cardHost(origin: string): string {
  return isPrivateOrigin(origin) ? "" : new URL(cleanOrigin(origin)).host.replace(/^www\./, "");
}

// ---------------------------------------------------------------------------------------------
// Wrapping

/** Greedy word wrap; a single word wider than the line is broken by characters. */
export function wrapWords(text: string, maxWidth: number, measure: (value: string) => number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const trial = line ? `${line} ${word}` : word;
    if (measure(trial) <= maxWidth) {
      line = trial;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    while (measure(line) > maxWidth && Array.from(line).length > 1) {
      const chars = Array.from(line);
      let take = chars.length - 1;
      while (take > 1 && measure(chars.slice(0, take).join("")) > maxWidth) take -= 1;
      lines.push(chars.slice(0, take).join(""));
      line = chars.slice(take).join("");
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Word wrap with even lines. It keeps the fewest lines the text needs at `maxWidth`, and among the
 * ways to break it into that many it picks the one whose lines are closest to the same width, with
 * a penalty for a line of one lonely word. No "I knew you / would / snooze. Up.".
 */
export function balancedWrap(text: string, maxWidth: number, measure: (value: string) => number): string[] {
  const greedy = wrapWords(text, maxWidth, measure);
  if (greedy.length < 2) return greedy;
  const words = text.split(/\s+/).filter(Boolean);
  // A word wider than the line was broken by characters: there is nothing to balance.
  if (words.some((word) => measure(word) > maxWidth)) return greedy;
  const n = words.length;
  const k = greedy.length;
  // Widths add up (the card's measure has no kerning), so a run of words is a difference of prefixes.
  const space = measure(" ");
  const prefix = [0];
  for (const word of words) prefix.push(prefix[prefix.length - 1] + measure(word));
  const width = (i: number, j: number) => prefix[j] - prefix[i] + (j - i - 1) * space;
  const target = width(0, n) / k;
  const lineCost = (i: number, j: number) => {
    const w = width(i, j);
    if (w > maxWidth) return Infinity;
    const lonely = j - i === 1 && n > k ? (target * 0.6) ** 2 : 0;
    return (w - target) ** 2 + lonely;
  };
  // best[l][j]: the cheapest way to set the first j words on l lines; from[l][j]: where its last line starts.
  const best = Array.from({ length: k + 1 }, () => new Array<number>(n + 1).fill(Infinity));
  const from = Array.from({ length: k + 1 }, () => new Array<number>(n + 1).fill(-1));
  best[0][0] = 0;
  for (let l = 1; l <= k; l++) {
    for (let j = l; j <= n; j++) {
      for (let i = j - 1; i >= l - 1; i--) {
        if (width(i, j) > maxWidth) break;
        if (best[l - 1][i] === Infinity) continue;
        const cost = best[l - 1][i] + lineCost(i, j);
        if (cost < best[l][j]) {
          best[l][j] = cost;
          from[l][j] = i;
        }
      }
    }
  }
  if (best[k][n] === Infinity) return greedy;
  const lines: string[] = [];
  for (let l = k, j = n; l > 0; l--) {
    const i = from[l][j];
    lines.unshift(words.slice(i, j).join(" "));
    j = i;
  }
  return lines;
}

/** `fits` is false when even the smallest size needed cutting. */
export type LineFit = { size: number; lines: string[]; lineHeight: number; height: number; fits: boolean };

/**
 * The biggest size from `sizes` at which the line fits `width` × `maxHeight`, balanced. At the
 * smallest size a line that still does not fit keeps the lines that do and ends in an ellipsis.
 */
export function fitLine(
  text: string,
  opts: { sizes: number[]; width: number; maxHeight: number; lineHeight: number; font: CardFont; maxLines?: number },
): LineFit {
  const { sizes, width, lineHeight, font } = opts;
  const maxLines = opts.maxLines ?? Infinity;
  const maxHeight = (size: number) => Math.min(opts.maxHeight, maxLines * Math.round(size * lineHeight));
  const room = width * KERN_SLACK;
  const at = (size: number) => (value: string) => textWidth(value, font, size);
  for (const size of sizes) {
    const lines = balancedWrap(text, room, at(size));
    const step = Math.round(size * lineHeight);
    if (lines.length * step <= maxHeight(size)) return { size, lines, lineHeight: step, height: lines.length * step, fits: true };
  }
  const size = sizes[sizes.length - 1];
  const step = Math.round(size * lineHeight);
  const all = wrapWords(text, room, at(size));
  const count = Math.max(1, Math.floor(maxHeight(size) / step));
  const lines = all.slice(0, count);
  if (all.length > count) {
    let last = `${lines[count - 1].replace(/[\s,;:.!?—–-]+$/, "")}…`;
    while (Array.from(last).length > 1 && at(size)(last) > room) last = `${Array.from(last).slice(0, -2).join("").trimEnd()}…`;
    lines[count - 1] = last;
  }
  return { size, lines, lineHeight: step, height: lines.length * step, fits: all.length <= count };
}

/** The biggest size at which one line of text fits; at the smallest, it is cut with an ellipsis. */
export function fitSingle(text: string, font: CardFont, sizes: number[], width: number, tracking = 0): { text: string; size: number } {
  for (const size of sizes) if (textWidth(text, font, size, tracking) <= width * KERN_SLACK) return { text, size };
  const size = sizes[sizes.length - 1];
  let cut = text;
  while (Array.from(cut).length > 1 && textWidth(`${cut}…`, font, size, tracking) > width * KERN_SLACK) cut = Array.from(cut).slice(0, -1).join("").trimEnd();
  return { text: `${cut}…`, size };
}

// ---------------------------------------------------------------------------------------------
// The scene

/** What a card says about its Chog. `mouth` is where the mouth sits in the portrait (0..1), for the bubble's tail. */
export type CardInput = {
  artId: number;
  label: string;
  trait: string;
  background: string;
  line: string;
  host?: string;
  owner?: boolean;
  mouth?: { x: number; y: number };
};

/** One line of text. Its box is x..x+w, y..y+h; `baseline` is where the glyphs sit, the way CSS centres a line box. */
export type CardText = {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  size: number;
  font: CardFont;
  color: string;
  align: "left" | "center" | "right";
  tracking: number;
  baseline: number;
};

export type CardPill = { x: number; y: number; w: number; h: number; fill: string; stroke?: string };
/** A filled circle with the phone glyph in it. */
export type CardIcon = { cx: number; cy: number; r: number; fill: string; glyphColor: string };
export type CardGlow = { cx: number; cy: number; r: number; color: string; alpha: number };
export type CardStar = { x: number; y: number; r: number; alpha: number };
/** The portrait's arch: a square whose top is a half circle; `ring` is the white border outside it. */
export type CardArch = { x: number; y: number; size: number; ring: number; corner: number; background: string };
export type CardBubble = { x: number; y: number; w: number; h: number; r: number; tail: [number, number][] };

export type CardScene = {
  format: CardFormat;
  w: number;
  h: number;
  /** Top-to-bottom sky gradient stops. */
  sky: [number, string][];
  glows: CardGlow[];
  stars: CardStar[];
  arch: CardArch;
  bubble: CardBubble;
  pills: CardPill[];
  icons: CardIcon[];
  texts: CardText[];
};

/** Lucide's phone glyph (ISC), on a 24-unit grid, drawn as a 2-unit stroke. */
export const PHONE_GLYPH =
  "M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384";

const SKY: [number, string][] = [
  [0, "#0f1230"],
  [0.55, "#272250"],
  [1, "#4b3566"],
];
const WHITE = "#fffdfb";
const SOFT = "rgba(255,253,251,0.74)";
const FAINT = "rgba(255,253,251,0.52)";
const INK = "#1d2340";
const GREEN = "#2fbf71";
const DAWN = "#ffb27a";
const LILAC = "#7f6cf2";
const PILL_FILL = "rgba(255,255,255,0.11)";
const PILL_STROKE = "rgba(255,255,255,0.2)";

function text(value: string, font: CardFont, size: number, box: { x: number; y: number; w: number; h?: number }, color: string, align: CardText["align"] = "left", tracking = 0): CardText {
  const h = box.h ?? Math.round(size * 1.25);
  const m = METRICS[font];
  const baseline = box.y + (h - (m.ascent + m.descent) * size) / 2 + m.ascent * size;
  return { text: value, x: box.x, y: box.y, w: box.w, h, size, font, color, align, tracking, baseline: Math.round(baseline * 10) / 10 };
}

/** "Incoming call" with the green phone, and "Owner" beside it for a verified owner. */
function pillRow(input: CardInput, x: number, y: number, h: number, size: number, center: number | null, withOwner: boolean) {
  const pad = Math.round(h * 0.09);
  const r = h / 2 - pad;
  const gap = Math.round(h * 0.2);
  const right = Math.round(h * 0.42);
  const label = "Incoming call";
  const tw = textWidth(label, "sansBold", size, 0.2);
  const callW = Math.round(pad + 2 * r + gap + tw + right);
  const ownerLabel = "Owner";
  const ownerW = Math.round(textWidth(ownerLabel, "sansBold", size, 0.2) + h * 0.8);
  const total = callW + (withOwner ? Math.round(h * 0.25) + ownerW : 0);
  const left = center === null ? x : Math.round(center - total / 2);
  const pills: CardPill[] = [{ x: left, y, w: callW, h, fill: PILL_FILL, stroke: PILL_STROKE }];
  const icons: CardIcon[] = [{ cx: left + pad + r, cy: y + h / 2, r, fill: GREEN, glyphColor: WHITE }];
  const texts: CardText[] = [text(label, "sansBold", size, { x: left + pad + 2 * r + gap, y, w: Math.ceil(tw) + 4, h }, WHITE, "left", 0.2)];
  if (withOwner) {
    const ox = left + callW + Math.round(h * 0.25);
    pills.push({ x: ox, y, w: ownerW, h, fill: "#e5f6ea" });
    texts.push(text(ownerLabel, "sansBold", size, { x: ox, y, w: ownerW, h }, "#1a4a30", "center", 0.2));
  }
  return { pills, icons, texts };
}

/** The brand: the green phone and "Choglander" in Fraunces. Returns its pieces and its width. */
function brand(x: number, y: number, h: number, size: number, center: number | null) {
  const r = Math.round(h * 0.36);
  const gap = Math.round(h * 0.24);
  const word = "Choglander";
  const tw = textWidth(word, "serifBold", size);
  const w = Math.round(2 * r + gap + tw);
  const left = center === null ? x : Math.round(center - w / 2);
  return {
    icons: [{ cx: left + r, cy: y + h / 2, r, fill: GREEN, glyphColor: WHITE }] as CardIcon[],
    texts: [text(word, "serifBold", size, { x: left + 2 * r + gap, y, w: Math.ceil(tw) + 4, h }, WHITE)],
  };
}

/** A few faint stars in the sky, placed by the art number so a card is the same every time. */
function stars(seed: number, count: number, area: { x: number; y: number; w: number; h: number }, scale: number): CardStar[] {
  let s = (seed * 2654435761) >>> 0 || 1;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: count }, () => ({
    x: Math.round(area.x + rand() * area.w),
    y: Math.round(area.y + rand() * area.h),
    r: Math.round((1.2 + rand() * 2.2) * scale * 10) / 10,
    alpha: Math.round((0.25 + rand() * 0.55) * 100) / 100,
  }));
}

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

/** The subtitle under the name: "Told-you-so · Blue 143 Jersey", smaller or cut when it would not fit. */
function subtitle(input: CardInput) {
  return input.trait && input.trait !== input.label ? `${input.label} · ${input.trait}` : input.label;
}

/** The tail from the bubble's top edge up to a point under the portrait. */
function tailUp(bubble: { x: number; y: number; w: number; r: number }, apex: [number, number], half: number): [number, number][] {
  const base = clamp(apex[0], bubble.x + bubble.r + half, bubble.x + bubble.w - bubble.r - half);
  return [
    [base - half, bubble.y + 1],
    [apex[0], apex[1]],
    [base + half, bubble.y + 1],
  ];
}

/** The tail from the bubble's left edge out to a point beside the portrait. */
function tailLeft(bubble: { x: number; y: number; h: number; r: number }, apex: [number, number], half: number): [number, number][] {
  const base = clamp(apex[1], bubble.y + bubble.r + half, bubble.y + bubble.h - bubble.r - half);
  return [
    [bubble.x + 1, base - half],
    [apex[0], apex[1]],
    [bubble.x + 1, base + half],
  ];
}

export function cardScene(format: CardFormat, input: CardInput): CardScene {
  const scene = format === "story" ? storyScene(input) : format === "square" ? squareScene(input) : wideScene(input);
  return { ...scene, stars: clearStars(scene) };
}

/** Stars stay in the open sky: none behind words, pills, the portrait or the bubble. */
function clearStars(scene: CardScene): CardStar[] {
  const m = 16;
  const { arch, bubble } = scene;
  const boxes = [
    ...scene.texts.map((t) => {
      const w = textWidth(t.text, t.font, t.size, t.tracking);
      const x = t.align === "left" ? t.x : t.align === "center" ? t.x + (t.w - w) / 2 : t.x + t.w - w;
      return { x, y: t.y, w, h: t.h };
    }),
    ...scene.pills,
    ...scene.icons.map((icon) => ({ x: icon.cx - icon.r, y: icon.cy - icon.r, w: icon.r * 2, h: icon.r * 2 })),
    { x: arch.x - arch.ring, y: arch.y - arch.ring, w: arch.size + 2 * arch.ring, h: arch.size + 2 * arch.ring },
    { x: bubble.x, y: Math.min(bubble.y, ...bubble.tail.map(([, y]) => y)), w: bubble.w, h: bubble.h + bubble.y - Math.min(bubble.y, ...bubble.tail.map(([, y]) => y)) },
  ];
  return scene.stars.filter((star) => !boxes.some((b) => star.x > b.x - m && star.x < b.x + b.w + m && star.y > b.y - m && star.y < b.y + b.h + m));
}

function storyScene(input: CardInput): CardScene {
  const { w: W, h: H } = CARD_SIZE.story;
  const P = 80;
  const row = pillRow(input, P, 108, 80, 31, W / 2, Boolean(input.owner));
  const name = text(`Chog #${input.artId}`, "serifBold", 118, { x: P, y: 218, w: W - 2 * P, h: 132 }, WHITE, "center");
  const sub = fitSingle(subtitle(input), "sans", [36, 33, 30, 28], W - 2 * P);
  const subText = text(sub.text, "sans", sub.size, { x: P, y: 352, w: W - 2 * P, h: 48 }, SOFT, "center");

  // Arch and bubble share the space between the subtitle and the footer.
  const zoneTop = 448;
  const zoneBottom = 1696;
  const tail = 46;
  const gap = 18;
  const archMin = 560;
  const archMax = 740;
  const padX = 64;
  const padY = 54;
  const bubbleW = W - 2 * P;
  const fit = fitLine(input.line, {
    sizes: [86, 78, 72, 66, 60, 55, 50, 46],
    width: bubbleW - 2 * padX,
    maxHeight: zoneBottom - zoneTop - archMin - gap - tail - 2 * padY,
    lineHeight: 1.22,
    font: "serif",
  });
  const bubbleH = fit.height + 2 * padY;
  const size = clamp(zoneBottom - zoneTop - gap - tail - bubbleH - 40, archMin, archMax);
  const group = size + gap + tail + bubbleH;
  const top = Math.round(zoneTop + (zoneBottom - zoneTop - group) / 2);
  const arch: CardArch = { x: Math.round((W - size) / 2), y: top, size, ring: 14, corner: Math.round(size * 0.1), background: input.background };
  const bubbleBox = { x: P, y: top + size + gap + tail, w: bubbleW, h: bubbleH, r: 56 };
  const mouthX = arch.x + size * (input.mouth?.x ?? 0.5);
  const bubble: CardBubble = { ...bubbleBox, tail: tailUp(bubbleBox, [Math.round(mouthX), arch.y + size + gap], 38) };
  const lines = fit.lines.map((value, i) =>
    text(value, "serif", fit.size, { x: bubbleBox.x + padX, y: bubbleBox.y + padY + i * fit.lineHeight, w: bubbleW - 2 * padX, h: fit.lineHeight }, INK, "center"),
  );

  const footY = H - P - 84;
  const mark = brand(P, footY, 84, 46, null);
  const footer: CardText[] = input.host
    ? [
        text("Get your Chog to call you", "sans", 29, { x: W / 2, y: footY + 2, w: W / 2 - P, h: 42 }, SOFT, "right"),
        text(input.host, "sans", 26, { x: W / 2, y: footY + 44, w: W / 2 - P, h: 38 }, FAINT, "right"),
      ]
    : [text("Get your Chog to call you", "sans", 29, { x: W / 2, y: footY, w: W / 2 - P, h: 84 }, SOFT, "right")];

  return {
    format: "story",
    w: W,
    h: H,
    sky: SKY,
    glows: [
      { cx: W * 0.85, cy: 120, r: 520, color: LILAC, alpha: 0.28 },
      { cx: W / 2, cy: H * 1.04, r: W * 0.95, color: DAWN, alpha: 0.5 },
      { cx: arch.x + size / 2, cy: arch.y + size / 2, r: size * 0.82, color: input.background, alpha: 0.5 },
    ],
    stars: stars(input.artId, 26, { x: 30, y: 20, w: W - 60, h: 900 }, 1.4),
    arch,
    bubble,
    pills: row.pills,
    icons: [...row.icons, ...mark.icons],
    texts: [...row.texts, name, subText, ...lines, ...mark.texts, ...footer],
  };
}

/** The square post: the portrait and its name on top, the line across the card under them. */
function squareScene(input: CardInput): CardScene {
  const { w: W, h: H } = CARD_SIZE.square;
  const P = 72;
  const row = pillRow(input, P, P, 68, 27, null, Boolean(input.owner));

  const footY = H - P - 64;
  const mark = brand(P, footY, 64, 38, null);
  const footer: CardText[] = input.host
    ? [
        text("Get your Chog to call you", "sans", 25, { x: W / 2, y: footY - 2, w: W / 2 - P, h: 36 }, SOFT, "right"),
        text(input.host, "sans", 22, { x: W / 2, y: footY + 34, w: W / 2 - P, h: 32 }, FAINT, "right"),
      ]
    : [text("Get your Chog to call you", "sans", 25, { x: W / 2, y: footY, w: W / 2 - P, h: 64 }, SOFT, "right")];
  const zoneTop = P + 68 + 34;
  const zoneBottom = footY - 34;

  const frame = (arch: CardArch, bubble: CardBubble, texts: CardText[]): CardScene => ({
    format: "square",
    w: W,
    h: H,
    sky: SKY,
    glows: [
      { cx: W * 0.9, cy: 60, r: 460, color: LILAC, alpha: 0.26 },
      { cx: W * 0.55, cy: H * 1.08, r: W * 0.8, color: DAWN, alpha: 0.46 },
      { cx: arch.x + arch.size / 2, cy: arch.y + arch.size / 2, r: arch.size * 0.86, color: input.background, alpha: 0.5 },
    ],
    stars: stars(input.artId, 22, { x: 20, y: 16, w: W - 40, h: 640 }, 1.2),
    arch,
    bubble,
    pills: row.pills,
    icons: [...row.icons, ...mark.icons],
    texts: [...row.texts, ...texts, ...mark.texts, ...footer],
  });

  // The portrait with its name beside it, and the bubble across the card under it.
  const tail = 40;
  const gap = 16;
  const archMin = 300;
  const archMax = 440;
  const padX = 52;
  const padY = 44;
  const bw = W - 2 * P;
  const fit = fitLine(input.line, {
    sizes: [70, 64, 58, 53, 49, 45, 42, 39, 36, 33],
    width: bw - 2 * padX,
    maxHeight: zoneBottom - zoneTop - archMin - gap - tail - 2 * padY,
    lineHeight: 1.24,
    font: "serif",
  });
  const bh = fit.height + 2 * padY;
  const size = clamp(zoneBottom - zoneTop - gap - tail - bh, archMin, archMax);
  const group = size + gap + tail + bh;
  const top = Math.round(zoneTop + (zoneBottom - zoneTop - group) / 2);
  const arch: CardArch = { x: P, y: top, size, ring: 12, corner: Math.round(size * 0.1), background: input.background };
  const nx = P + size + 44;
  const nw = W - P - nx;
  const nameFit = fitSingle(`Chog #${input.artId}`, "serifBold", [84, 76, 68, 60], nw);
  const sub = fitSingle(subtitle(input), "sans", [30, 28, 26, 24, 22], nw);
  const nameH = Math.round(nameFit.size * 1.12);
  const subH = Math.round(sub.size * 1.4);
  const ny = Math.round(top + size * 0.56 - (nameH + subH) / 2);
  const name = text(nameFit.text, "serifBold", nameFit.size, { x: nx, y: ny, w: nw, h: nameH }, WHITE, "left");
  const subText = text(sub.text, "sans", sub.size, { x: nx, y: ny + nameH, w: nw, h: subH }, SOFT, "left");
  const box = { x: P, y: top + size + gap + tail, w: bw, h: bh, r: 48 };
  const mouthX = arch.x + size * (input.mouth?.x ?? 0.5);
  const bubble: CardBubble = { ...box, tail: tailUp(box, [Math.round(mouthX), arch.y + size + gap], 32) };
  const lines = fit.lines.map((value, i) => text(value, "serif", fit.size, { x: P + padX, y: box.y + padY + i * fit.lineHeight, w: bw - 2 * padX, h: fit.lineHeight }, INK, "left"));
  return frame(arch, bubble, [name, subText, ...lines]);
}

/** The wide card (X's summary_large_image). A long line takes room from the portrait so it stays readable small. */
function wideScene(input: CardInput): CardScene {
  const { w: W, h: H } = CARD_SIZE.wide;
  const zoneTop = 256;
  const zoneBottom = H - 52;
  const padX = 34;
  const padY = 28;
  const layout = (size: number) => {
    const cx = 68 + size + 64;
    const cw = W - cx - 60;
    const fit = fitLine(input.line, { sizes: [56, 50, 46, 42, 38, 35, 32, 30, 28, 26], width: cw - 2 * padX, maxHeight: zoneBottom - zoneTop - 2 * padY, lineHeight: 1.24, font: "serif" });
    return { size, cx, cw, fit };
  };
  const options = [436, 396, 360].map(layout);
  const { size, cx, cw, fit } = options.find((option) => option.fit.size >= 34) ?? options[options.length - 1];
  const arch: CardArch = { x: 68, y: Math.round(58 + (436 - size) / 2), size, ring: 12, corner: Math.round(size * 0.1), background: input.background };
  const mark = brand(arch.x, 58 + 436 + 26, 52, 32, arch.x + size / 2);

  // The X card is public and its owner is not in the link, so it never says "Owner".
  const row = pillRow(input, cx, 60, 52, 21, null, false);
  const name = text(`Chog #${input.artId}`, "serifBold", 58, { x: cx, y: 128, w: cw, h: 68 }, WHITE, "left");
  const sub = fitSingle(subtitle(input), "sans", [24, 22, 20, 19], cw);
  const subText = text(sub.text, "sans", sub.size, { x: cx, y: 196, w: cw, h: 34 }, SOFT, "left");

  const bh = fit.height + 2 * padY;
  const mouthY = arch.y + size * (input.mouth?.y ?? 0.66);
  const by = Math.round(clamp(mouthY - bh * 0.5, zoneTop, zoneBottom - bh));
  const bubbleBox = { x: cx, y: by, w: cw, h: bh, r: 34 };
  const bubble: CardBubble = { ...bubbleBox, tail: tailLeft(bubbleBox, [arch.x + size + 14, Math.round(mouthY)], 24) };
  const lines = fit.lines.map((value, i) => text(value, "serif", fit.size, { x: cx + padX, y: by + padY + i * fit.lineHeight, w: cw - 2 * padX, h: fit.lineHeight }, INK, "left"));

  return {
    format: "wide",
    w: W,
    h: H,
    sky: SKY,
    glows: [
      { cx: W * 0.92, cy: 40, r: 420, color: LILAC, alpha: 0.26 },
      { cx: W * 0.7, cy: H * 1.22, r: 620, color: DAWN, alpha: 0.46 },
      { cx: arch.x + size / 2, cy: arch.y + size / 2, r: size * 0.84, color: input.background, alpha: 0.5 },
    ],
    stars: stars(input.artId, 16, { x: 16, y: 12, w: W - 32, h: 330 }, 1),
    arch,
    bubble,
    pills: row.pills,
    icons: [...row.icons, ...mark.icons],
    texts: [...row.texts, name, subText, ...lines, ...mark.texts],
  };
}

/** What a card needs from a profile: its labels, colour, and where its mouth is. */
export function cardInput(profile: ChogProfile, line: string, opts: { host?: string; owner?: boolean } = {}): CardInput {
  const { rig } = rigFor(profile.artId, profile.side, faceTraits(profile.traits));
  const mouth = rig.mouth ? { x: (rig.mouth.x + rig.mouth.w / 2) / 1000, y: (rig.mouth.y + rig.mouth.h / 2) / 1000 } : undefined;
  return {
    artId: profile.artId,
    label: ARCHETYPE_LABEL[profile.archetype],
    trait: profile.headlineTrait,
    background: profile.background,
    line: cleanLine(line),
    host: opts.host ?? "",
    owner: opts.owner ?? false,
    mouth,
  };
}
