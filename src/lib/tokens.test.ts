import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import bookJson from "@/data/tokens.json";
import catalog from "@/data/trait-catalog.json";
import { artUrl, bundledMeta, DEMO_ART, DEMO_META, loadChog, metaFromBook, metaFromProfile, profileFromMeta, type TokenBook } from "@/lib/chog";
import { artFromToken, CHOG_SUPPLY, IMAGE_CID, IPFS_GATEWAYS, META_CID, tokenFromArt } from "@/lib/ids";

const book = bookJson as TokenBook;
const labels = catalog.labels as Record<string, Record<string, string>>;

// chog-alive's census, when it sits beside this checkout: then every token is compared with it.
const CENSUS = [
  process.env.CHOG_TOKENS_SRC,
  path.resolve(__dirname, "../../../chog-alive/src/data/tokens.json"),
  path.resolve(__dirname, "../../../../chog-alive/src/data/tokens.json"),
].find((file): file is string => !!file && fs.existsSync(file));

type CensusEntry = { tokenId: number; metaId: number; name: string; image: string; traits: Record<string, string> };

describe("bundled metadata for all 1,969 Chogs", () => {
  it("covers every art number with the collection's CIDs", () => {
    expect(book.supply).toBe(CHOG_SUPPLY);
    expect(book.arts).toHaveLength(CHOG_SUPPLY);
    expect(book.imageCid).toBe(IMAGE_CID);
    expect((bookJson as { metaCid: string }).metaCid).toBe(META_CID);
  });

  it("decodes every Chog to traits the catalog can label", () => {
    for (let art = 1; art <= CHOG_SUPPLY; art++) {
      const meta = metaFromBook(book, art);
      expect(meta, `art ${art}`).not.toBeNull();
      expect(meta!.attributes.length).toBeGreaterThan(0);
      expect(meta!.image).toBe(`ipfs://${IMAGE_CID}/${art}.webp`);
      for (const { trait_type, value } of meta!.attributes) {
        expect(labels[trait_type]?.[value], `art ${art} ${trait_type}=${value}`).toBeDefined();
      }
    }
  });

  it("matches the hand-checked demo metadata exactly", () => {
    for (const art of DEMO_ART) {
      const meta = metaFromBook(book, art)!;
      expect(meta.name).toBe(DEMO_META[art].name);
      expect(meta.image).toBe(DEMO_META[art].image);
      expect(meta.attributes).toEqual(DEMO_META[art].attributes);
    }
  });

  it("knows the edge Chogs: the first token, the last token and a named one-of-one", () => {
    expect(metaFromBook(book, artFromToken(1))).toMatchObject({
      name: "CHOG #1462",
      attributes: [
        { trait_type: "Background", value: "Deep Aqua" },
        { trait_type: "Base", value: "Origin" },
        { trait_type: "Skin", value: "Pink" },
        { trait_type: "Side", value: "Left" },
        { trait_type: "Body", value: "Yellow 143 Jersey" },
        { trait_type: "Mouth", value: "Flat" },
        { trait_type: "Eyes", value: "BTC Glass" },
        { trait_type: "Head", value: "MCGA" },
        { trait_type: "Accessory", value: "Fwog" },
        { trait_type: "Form", value: "Chog" },
        { trait_type: "Tier", value: "Uncommon" },
        { trait_type: "Naked", value: "No" },
      ],
    });
    const last = metaFromBook(book, 1461)!;
    expect(tokenFromArt(1461)).toBe(1969);
    expect(last.attributes.find((trait) => trait.trait_type === "Accessory")?.value).toBe("Coin");
    expect(metaFromBook(book, 53)).toMatchObject({
      name: "CHOG #53 — Blaze",
      attributes: [
        { trait_type: "Base", value: "1:1" },
        { trait_type: "Tier", value: "Legendary" },
      ],
    });
  });

  it("has nothing for numbers outside the collection, or a damaged row", () => {
    for (const art of [0, CHOG_SUPPLY + 1, -1, 1.5, Number.NaN]) expect(metaFromBook(book, art)).toBeNull();
    expect(metaFromBook({ ...book, arts: ["00"] }, 1)).toBeNull();
    expect(metaFromBook({ ...book, arts: ["z00"] }, 1)).toBeNull();
  });

  it.skipIf(!CENSUS)("agrees with chog-alive's census on every token", () => {
    const census = JSON.parse(fs.readFileSync(CENSUS!, "utf8")) as { metadataCid: string; tokens: CensusEntry[] };
    expect(census.metadataCid).toBe(META_CID);
    expect(census.tokens).toHaveLength(CHOG_SUPPLY);
    for (const token of census.tokens) {
      expect(artFromToken(token.tokenId)).toBe(token.metaId);
      expect(tokenFromArt(token.metaId)).toBe(token.tokenId);
      expect(token.image).toBe(`${IMAGE_CID}/${token.metaId}.webp`);
      const meta = metaFromBook(book, token.metaId)!;
      expect(meta.name).toBe(token.name);
      expect(meta.attributes).toEqual(Object.entries(token.traits).map(([trait_type, value]) => ({ trait_type, value })));
    }
  });
});

describe("loading a Chog someone types in", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("needs no gateway for any of the 1,969", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error("no network in this test");
    });
    vi.stubGlobal("fetch", fetchSpy);
    for (const input of ["1000", "#1", "1969", "t1969", "53"]) {
      const profile = await loadChog(input);
      expect(profile.traits.length).toBeGreaterThan(0);
    }
    const typed = await loadChog("1000");
    expect(typed.artId).toBe(1000);
    expect(typed.tokenId).toBe(tokenFromArt(1000));
    expect(typed.traits).toEqual(metaFromBook(book, 1000)!.attributes);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("serves a non-demo portrait through /api/art, and the demo four from their bundled busts", async () => {
    const profile = await loadChog("1000");
    expect(profile.image).toBe("/api/art/1000");
    expect(profile.texture).toBe("/api/art/1000");
    expect(profile.mode).toBe("photo");
    const demo = await loadChog("375");
    expect(demo.image).toBe("/chog/375.webp");
    expect(demo.texture).toBe("/chog/375.webp");
    expect(demo.mode).toBe("bust");
  });

  it("points the art at the deployed server when one is built in, and at a CORS gateway in an APK without one", () => {
    vi.stubEnv("NEXT_PUBLIC_CHOG_API_ORIGIN", "https://chog.example/");
    expect(artUrl(1000)).toBe("https://chog.example/api/art/1000");
    expect(artUrl(642)).toBe("/chog/642.webp");
    vi.stubEnv("NEXT_PUBLIC_CHOG_API_ORIGIN", "");
    vi.stubEnv("NEXT_PUBLIC_CHOG_EXPORT", "1");
    expect(artUrl(1000)).toBe(`${IPFS_GATEWAYS[0]}/${IMAGE_CID}/1000.webp`);
  });

  it("moves a remembered Chog with an old gateway image onto /api/art", () => {
    const old = { name: "CHOG #1000", image: "https://gateway.pinata.cloud/ipfs/x/1000.webp", attributes: metaFromBook(book, 1000)!.attributes };
    const profile = profileFromMeta(1000, old);
    expect(profile.image).toBe("/api/art/1000");
    expect(metaFromProfile(profile).image).toBe(`ipfs://${IMAGE_CID}/1000.webp`);
  });

  it("falls back to a gateway only when the bundled chunk has nothing", async () => {
    await expect(bundledMeta(1000)).resolves.not.toBeNull();
    await expect(bundledMeta(5000)).resolves.toBeNull();
  });
});
