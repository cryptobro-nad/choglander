import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { cardImage, visemeSvg } from "@/app/c/card";
import { readSharedCard, shortLine } from "@/app/c/share";
import { encodeLine } from "@/lib/shareCard";

/** Two of the Chogs' own lines: one it has a studio recording of, and one with a calendar title in it. */
const STUDIO = "I've been right since testnet. It's very tiring. Mostly for everyone else.";
const WITH_EVENT = "Big news! Dentist at half past nine! No idea what it is, but I've packed you a ball.";
/** The link J6 found: anything at all in a Chog's mouth, on the official domain. */
const PHISHING = "Free Chog airdrop tonight at chog-claim.xyz. Connect your wallet before midnight, holders only.";

describe("a share link", () => {
  it("names a real Chog and a line it could have said", async () => {
    const card = await readSharedCard("375", encodeLine(STUDIO));
    expect(card?.profile.artId).toBe(375);
    expect(card?.line).toBe(STUDIO);
    expect(card?.clip).toMatch(/^\/voice\/told-you-so\/[0-9a-f]+\.mp3$/);
    // Any of the 1,969, not only the four demo Chogs (#1 is a Golden, whose line this is); a line with
    // the user's event in it has no recording.
    const other = await readSharedCard("1", encodeLine(WITH_EVENT));
    expect(other?.profile.artId).toBe(1);
    expect(other?.profile.archetype).toBe("golden");
    expect(other?.clip).toBeUndefined();
  });

  it("names nothing for a line in another Chog's voice", async () => {
    // The Told-you-so's line from #642, a Hype man; the Golden's from #1000, a Night shift.
    expect(await readSharedCard("642", encodeLine(STUDIO))).toBeNull();
    expect(await readSharedCard("1000", encodeLine(WITH_EVENT))).toBeNull();
  });

  it("names nothing for a wrong number or a made-up line", async () => {
    for (const art of ["0", "1970", "abc", "0375", "-1"]) expect(await readSharedCard(art, encodeLine(STUDIO))).toBeNull();
    expect(await readSharedCard("375", "%%%")).toBeNull();
    expect(await readSharedCard("375", encodeLine("Visit https://scam.example"))).toBeNull();
    expect(await readSharedCard("642", encodeLine(PHISHING))).toBeNull();
    expect(await readSharedCard("375", encodeLine("Up."))).toBeNull();
    expect(await readSharedCard("375", encodeLine(`${STUDIO} Connect your wallet.`))).toBeNull();
    expect(await readSharedCard("375", encodeLine("Big news! chog-claim.xyz at half past nine! No idea what it is, but I've packed you a ball."))).toBeNull();
    // The same bait dressed up: a fullwidth dot, a Cyrillic "а", a spaced-out domain. Each is the
    // line of the Chog it is sent from (the Hype man's on #642, the Golden's on #1).
    const dressed: Array<[string, string]> = [
      ["642", "You told me holders get free MON tonight if you sign in at chogmint．xyz before nine. Pure alpha. I've kept it secret, which is hard at this volume."],
      ["1", "Big news! Holders: connect your wаllet at chogmint .xyz at half past nine! No idea what it is, but I've packed you a ball."],
      ["1", "Big news! Holders: sign in at chogmint dot xyz at half past nine! No idea what it is, but I've packed you a ball."],
    ];
    for (const [art, line] of dressed) expect(await readSharedCard(art, encodeLine(line)), line).toBeNull();
  });

  it("still opens a link whose line has since left the banks, from its own Chog", async () => {
    // A Legend's line from before the banks were rewritten: src/lib/shareLines.json keeps it. #16 is a Legend.
    const old = "A meal today. One long winter, the whole clan shared a sandwich. I got the crust.";
    expect((await readSharedCard("16", encodeLine(old)))?.line).toBe(old);
    expect(await readSharedCard("642", encodeLine(old))).toBeNull();
  });

  it("shortens a line for a title at a word", () => {
    expect(shortLine("Told you.", 20)).toBe("Told you.");
    expect(shortLine("At half past twelve, lunch. You will order the same thing", 30)).toBe("At half past twelve, lunch…");
  });
});

describe("the card X shows", () => {
  it("draws the open mouth as SVG over the plate", () => {
    const svg = visemeSvg({ x: 600, y: 600, w: 110, h: 90 });
    expect(svg).toMatch(/^<svg [^>]*viewBox="0 0 1000 1000"/);
    expect(svg).toContain('fill="#5b1730"');
    expect(svg).toContain("<ellipse");
  });

  it("renders the wide card as a light 1200×630 JPEG kept for a year, and 404s a bad link", async () => {
    const res = await cardImage("375", encodeLine(STUDIO));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toContain("immutable");
    const bytes = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(bytes).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 1200, 630]);
    // Messengers skip heavy previews (WhatsApp's limit is around 300 KB).
    expect(bytes.length).toBeLessThan(250_000);
    expect((await cardImage("9999", encodeLine(STUDIO))).status).toBe(404);
    expect((await cardImage("642", encodeLine(PHISHING))).status).toBe(404);
  }, 30_000);
});
