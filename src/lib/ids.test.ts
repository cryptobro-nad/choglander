import { describe, expect, it } from "vitest";
import { artFromToken, artPath, IMAGE_CID, isArtId, isTokenId, tokenFromArt, CHOG_SUPPLY } from "@/lib/ids";

describe("token and art numbers", () => {
  it("maps the approved demo cast", () => {
    expect(artFromToken(883)).toBe(375);
    expect(artFromToken(1150)).toBe(642);
    expect(artFromToken(1329)).toBe(821);
    expect(artFromToken(750)).toBe(242);
    expect(tokenFromArt(375)).toBe(883);
    expect(tokenFromArt(642)).toBe(1150);
    expect(tokenFromArt(821)).toBe(1329);
    expect(tokenFromArt(242)).toBe(750);
  });

  it("round-trips every token, 1 to 1969 as on chain", () => {
    const arts = new Set<number>();
    for (let token = 1; token <= CHOG_SUPPLY; token++) {
      const art = artFromToken(token);
      expect(isArtId(art)).toBe(true);
      expect(isTokenId(token)).toBe(true);
      expect(tokenFromArt(art)).toBe(token);
      arts.add(art);
    }
    expect(arts.size).toBe(CHOG_SUPPLY);
  });

  it("gives art #1461 to token 1969, because there is no token 0", () => {
    // tokenURI(1969) on Monad is ipfs://<META_CID>/1461.json; ownerOf(0) reverts.
    expect(tokenFromArt(1461)).toBe(1969);
    expect(artFromToken(1969)).toBe(1461);
    expect(tokenFromArt(1462)).toBe(1);
    expect(isTokenId(0)).toBe(false);
    expect(isTokenId(1970)).toBe(false);
    expect(isTokenId(1.5)).toBe(false);
  });

  it("names every portrait by its art number under one CID", () => {
    expect(artPath(1000)).toBe(`${IMAGE_CID}/1000.webp`);
  });
});
