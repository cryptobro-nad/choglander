import { describe, expect, it } from "vitest";
import { demoProfile } from "@/lib/chog";
import {
  balancedWrap,
  CARD_FORMATS,
  CARD_SIZE,
  cardHost,
  cardInput,
  cardScene,
  cleanLine,
  decodeLine,
  encodeLine,
  fitLine,
  isPrivateOrigin,
  LINE_MAX,
  sharePagePath,
  shareOrigin,
  textWidth,
  wrapWords,
  type CardScene,
} from "@/lib/shareCard";

const SHORT = "I knew you would snooze. Up.";
const LONG =
  "At half past twelve, lunch. You will order the same thing as last time. That is not loyalty, that is lack of research. DYOR, even on soup. I checked the menu twice and the soup checked me back.";

/** Lines of 5 to 40 words, built from real-looking words. */
function lineOf(words: number) {
  const pool = "Rise and shine superstar the treadmill is nervous and it should be because you are the main character today".split(" ");
  return `${Array.from({ length: words }, (_, i) => pool[i % pool.length]).join(" ")}.`;
}

describe("the line", () => {
  it("drops audio tags, invisible characters and wrapping quotes", () => {
    expect(cleanLine("[sarcastic] “Told you.”")).toBe("Told you.");
    expect(cleanLine("Up\u0000 now‮ please  ok")).toBe("Up now please ok");
    expect(cleanLine("  lots   of\n\nspace ")).toBe("lots of space");
    expect(cleanLine(null)).toBe("");
  });

  it("cuts a long line at a word and ends it with an ellipsis", () => {
    const line = cleanLine(Array.from({ length: 80 }, () => "word").join(" "));
    expect(Array.from(line).length).toBeLessThanOrEqual(LINE_MAX);
    expect(line.endsWith("word…")).toBe(true);
  });

  it("travels in a URL segment and comes back exactly, punctuation and all", () => {
    for (const line of [SHORT, LONG, "Don’t “panic”. Café at 9 — ser, gm! 🐸", "<script>alert(1)</script> & co"]) {
      const segment = encodeLine(line);
      expect(segment).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(decodeLine(segment)).toBe(cleanLine(line));
    }
    expect(sharePagePath(375, "Told you.")).toBe(`/c/375/${encodeLine("Told you.")}`);
  });

  it("refuses a segment the app could not have made", () => {
    expect(decodeLine("")).toBeNull();
    expect(decodeLine("not base64!")).toBeNull();
    expect(decodeLine("A".repeat(401))).toBeNull();
    expect(decodeLine("_-8")).toBeNull(); // not UTF-8
    // Lines the Chog would never say, such as links or advice to buy, never get a card.
    expect(decodeLine(encodeLine("Go to https://scam.example now"))).toBeNull();
    expect(decodeLine(encodeLine("Buy the dip, ser"))).toBeNull();
  });
});

describe("wrapping", () => {
  const measure = (value: string) => value.length * 10;

  it("wraps greedily and breaks a word wider than the line", () => {
    expect(wrapWords("aa bb cc", 50, measure)).toEqual(["aa bb", "cc"]);
    expect(wrapWords("abcdefghij", 40, measure)).toEqual(["abcd", "efgh", "ij"]);
  });

  it("evens the lines out without adding one, and never strands a word alone", () => {
    const text = "I knew you would snooze. Up.";
    const greedy = wrapWords(text, 110, measure);
    const balanced = balancedWrap(text, 110, measure);
    expect(balanced.length).toBe(greedy.length);
    expect(balanced.join(" ")).toBe(text);
    for (const line of balanced) expect(measure(line)).toBeLessThanOrEqual(110);
    if (balanced.length > 2) expect(balanced.slice(0, -1).every((line) => line.includes(" "))).toBe(true);
    // Wide enough for everything on one line: one line.
    expect(balancedWrap(text, 1000, measure)).toEqual([text]);
  });

  it("sets a long line smaller than a short one, and never past its box", () => {
    const opts = { sizes: [80, 70, 60, 50, 40], width: 800, maxHeight: 400, lineHeight: 1.2, font: "serif" as const };
    const short = fitLine(SHORT, opts);
    const long = fitLine(LONG, opts);
    expect(short.size).toBeGreaterThan(long.size);
    for (const fit of [short, long]) {
      expect(fit.fits).toBe(true);
      expect(fit.height).toBeLessThanOrEqual(400);
      for (const line of fit.lines) expect(textWidth(line, "serif", fit.size)).toBeLessThanOrEqual(800);
    }
  });

  it("cuts with an ellipsis only when even the smallest size runs out of room", () => {
    const fit = fitLine(LONG, { sizes: [60], width: 400, maxHeight: 150, lineHeight: 1.2, font: "serif" });
    expect(fit.fits).toBe(false);
    expect(fit.height).toBeLessThanOrEqual(150);
    expect(fit.lines[fit.lines.length - 1].endsWith("…")).toBe(true);
  });

  it("caps the line count when asked", () => {
    const fit = fitLine(LONG, { sizes: [40], width: 900, maxHeight: 2000, lineHeight: 1.2, font: "serif", maxLines: 3 });
    expect(fit.lines.length).toBeLessThanOrEqual(3);
  });
});

function inside(scene: CardScene, box: { x: number; y: number; w: number; h: number }) {
  return box.x >= 0 && box.y >= 0 && box.x + box.w <= scene.w && box.y + box.h <= scene.h;
}

function overlaps(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

describe("the card", () => {
  const profiles = [375, 642, 821, 242].map((art) => demoProfile(art)!);

  it("comes in the three sizes", () => {
    expect(CARD_SIZE).toEqual({ story: { w: 1080, h: 1920 }, square: { w: 1080, h: 1080 }, wide: { w: 1200, h: 630 } });
  });

  it("keeps every piece on the card and every line inside the bubble, from 5 to 40 words", () => {
    for (const profile of profiles) {
      for (const words of [5, 8, 12, 18, 25, 35, 40]) {
        for (const format of CARD_FORMATS) {
          const scene = cardScene(format, cardInput(profile, lineOf(words), { host: "choglander.vercel.app", owner: true }));
          const { arch, bubble } = scene;
          expect(inside(scene, { x: arch.x - arch.ring, y: arch.y - arch.ring, w: arch.size + 2 * arch.ring, h: arch.size + 2 * arch.ring })).toBe(true);
          expect(inside(scene, bubble)).toBe(true);
          expect(overlaps(bubble, { x: arch.x - arch.ring, y: arch.y - arch.ring, w: arch.size + 2 * arch.ring, h: arch.size + 2 * arch.ring })).toBe(false);
          for (const t of scene.texts) {
            expect(inside(scene, t)).toBe(true);
            expect(textWidth(t.text, t.font, t.size, t.tracking)).toBeLessThanOrEqual(t.w + 1);
          }
          const said = scene.texts.filter((t) => t.color === "#1d2340");
          expect(said.length).toBeGreaterThan(0);
          for (const t of said) {
            expect(t.x).toBeGreaterThanOrEqual(bubble.x);
            expect(t.x + t.w).toBeLessThanOrEqual(bubble.x + bubble.w);
            expect(t.y).toBeGreaterThanOrEqual(bubble.y);
            expect(t.y + t.h).toBeLessThanOrEqual(bubble.y + bubble.h);
          }
          // The whole line is on the card, unless it was over 35 words and had to be cut.
          if (words <= 35) expect(said.map((t) => t.text).join(" ")).toBe(lineOf(words));
          // The line is the biggest text after the name.
          expect(said[0].size).toBeGreaterThanOrEqual(format === "wide" ? 26 : 32);
        }
      }
    }
  });

  it("shows the name, the archetype and the brand", () => {
    for (const format of CARD_FORMATS) {
      const words = cardScene(format, cardInput(profiles[0], SHORT)).texts.map((t) => t.text);
      expect(words).toContain("Chog #375");
      expect(words).toContain("Told-you-so · Blue 143 Jersey");
      expect(words).toContain("Choglander");
      expect(words).toContain("Incoming call");
    }
  });

  it("marks an owner's story and post, never the public X card", () => {
    const input = cardInput(profiles[0], SHORT, { owner: true });
    expect(cardScene("story", input).texts.map((t) => t.text)).toContain("Owner");
    expect(cardScene("square", input).texts.map((t) => t.text)).toContain("Owner");
    expect(cardScene("wide", input).texts.map((t) => t.text)).not.toContain("Owner");
  });

  it("is the same card every time for the same Chog and line", () => {
    const a = cardScene("wide", cardInput(profiles[1], LONG));
    const b = cardScene("wide", cardInput(profiles[1], LONG));
    expect(a).toEqual(b);
  });

  it("keeps the stars out of the words", () => {
    for (const format of CARD_FORMATS) {
      const scene = cardScene(format, cardInput(profiles[2], LONG));
      for (const star of scene.stars) {
        for (const t of scene.texts) {
          const w = textWidth(t.text, t.font, t.size, t.tracking);
          const x = t.align === "left" ? t.x : t.align === "center" ? t.x + (t.w - w) / 2 : t.x + t.w - w;
          expect(star.x > x && star.x < x + w && star.y > t.y && star.y < t.y + t.h).toBe(false);
        }
      }
    }
  });
});

describe("where a shared card links", () => {
  it("links the web app to itself", () => {
    expect(shareOrigin({ location: "https://choglander.vercel.app", site: "https://other.example" })).toBe("https://choglander.vercel.app");
  });

  it("links the APK to the address it was built with, or to nothing", () => {
    expect(shareOrigin({ native: true, location: "https://localhost", site: "https://chog.example/x" })).toBe("https://chog.example");
    expect(shareOrigin({ exported: true, location: "https://localhost", api: "https://api.example" })).toBe("https://api.example");
    expect(shareOrigin({ native: true, location: "https://localhost" })).toBe("");
  });

  it("prints only a public host on the card", () => {
    expect(isPrivateOrigin("http://localhost:43392")).toBe(true);
    expect(isPrivateOrigin("https://localhost")).toBe(true);
    expect(isPrivateOrigin("http://192.168.1.20:43123")).toBe(true);
    expect(isPrivateOrigin("")).toBe(true);
    expect(isPrivateOrigin("https://choglander.vercel.app")).toBe(false);
    expect(cardHost("https://www.chogcalls.xyz")).toBe("chogcalls.xyz");
    expect(cardHost("http://localhost:43392")).toBe("");
  });
});
