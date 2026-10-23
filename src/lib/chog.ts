import { archetypeFrom } from "@/lib/archetype";
import { artFromToken, artPath, IMAGE_CID, IPFS_GATEWAYS, isArtId, isTokenId, META_CID, tokenFromArt } from "@/lib/ids";
import { backgroundColor, displayTraits, skinColor, traitLabel } from "@/lib/traits";
import type { ChogMeta, ChogProfile, Side, TokenMemory } from "@/lib/types";
import { VOICES } from "@/lib/voices";

export const DEMO_ART = [375, 642, 821, 242] as const;

/** The main act: the Hype Man (#642) is the Chog setup starts on, as on the judge desk (JUDGE_ART). */
export const FIRST_CALLER = 642;

const LOCAL_BUST: Record<number, string> = {
  375: "/chog/375.webp",
  642: "/chog/642.webp",
  821: "/chog/821.webp",
  242: "/chog/242.webp",
};

export const DEMO_META: Record<number, ChogMeta> = {
  375: {
    name: "CHOG #375",
    image: "ipfs://bafybeihau2egcccbdxymeckmmbrqytbfor5gkt3en6d5fsbueymdbq7g6e/375.webp",
    attributes: [
      { trait_type: "Background", value: "Lime Green" },
      { trait_type: "Base", value: "Origin" },
      { trait_type: "Skin", value: "Origin" },
      { trait_type: "Side", value: "Left" },
      { trait_type: "Body", value: "Blue 143 Jersey" },
      { trait_type: "Mouth", value: "Smile" },
      { trait_type: "Eyes", value: "Base" },
      { trait_type: "Head", value: "Wizard Beanie" },
      { trait_type: "Form", value: "Chog" },
      { trait_type: "Tier", value: "Uncommon" },
      { trait_type: "Naked", value: "No" },
    ],
  },
  642: {
    name: "CHOG #642",
    image: "ipfs://bafybeihau2egcccbdxymeckmmbrqytbfor5gkt3en6d5fsbueymdbq7g6e/642.webp",
    attributes: [
      { trait_type: "Background", value: "Soft Lavender" },
      { trait_type: "Aura", value: "Clean" },
      { trait_type: "Base", value: "Origin" },
      { trait_type: "Skin", value: "Yellow" },
      { trait_type: "Side", value: "Right" },
      { trait_type: "Body", value: "White tuxedo" },
      { trait_type: "Mouth", value: "Smile" },
      { trait_type: "Eyes", value: "Happy" },
      { trait_type: "Head", value: "Peace hat" },
      { trait_type: "Form", value: "Chog" },
      { trait_type: "Tier", value: "Common" },
      { trait_type: "Naked", value: "No" },
    ],
  },
  821: {
    name: "CHOG #821",
    image: "ipfs://bafybeihau2egcccbdxymeckmmbrqytbfor5gkt3en6d5fsbueymdbq7g6e/821.webp",
    attributes: [
      { trait_type: "Background", value: "Mint" },
      { trait_type: "Base", value: "Origin" },
      { trait_type: "Skin", value: "Yellow" },
      { trait_type: "Side", value: "Right" },
      { trait_type: "Body", value: "White tuxedo" },
      { trait_type: "Mouth", value: "Lip Bite" },
      { trait_type: "Eyes", value: "Retro Glass" },
      { trait_type: "Head", value: "Crown" },
      { trait_type: "Form", value: "Chog" },
      { trait_type: "Tier", value: "Common" },
      { trait_type: "Naked", value: "No" },
    ],
  },
  242: {
    name: "CHOG #242",
    image: "ipfs://bafybeihau2egcccbdxymeckmmbrqytbfor5gkt3en6d5fsbueymdbq7g6e/242.webp",
    attributes: [
      { trait_type: "Background", value: "Lemon Yellow" },
      { trait_type: "Base", value: "Origin" },
      { trait_type: "Skin", value: "Origin" },
      { trait_type: "Side", value: "Left" },
      { trait_type: "Body", value: "Toad green Suit" },
      { trait_type: "Mouth", value: "Smile" },
      { trait_type: "Eyes", value: "Smirk" },
      { trait_type: "Form", value: "Chog" },
      { trait_type: "Tier", value: "Uncommon" },
      { trait_type: "Naked", value: "No" },
    ],
  },
};

/**
 * Where a portrait comes from. The four demo Chogs ship their art; every other one comes through
 * this app's /api/art, which serves the official webp with CORS so it works as a WebGL texture:
 * same origin on the web, the deployed server in an APK built with NEXT_PUBLIC_CHOG_API_ORIGIN.
 * An APK built without a server has no /api, so it asks a public gateway directly.
 */
export function artUrl(artId: number): string {
  const local = LOCAL_BUST[artId];
  if (local) return local;
  const origin = (process.env.NEXT_PUBLIC_CHOG_API_ORIGIN ?? "").replace(/\/+$/, "");
  if (!origin && process.env.NEXT_PUBLIC_CHOG_EXPORT === "1") return `${IPFS_GATEWAYS[0]}/${artPath(artId)}`;
  return `${origin}/api/art/${artId}`;
}

export function profileFromMeta(artId: number, meta: ChogMeta): ChogProfile {
  const display = displayTraits(meta.attributes);
  const backgroundName = meta.attributes.find((trait) => trait.trait_type === "Background")?.value ?? "";
  const skinName = meta.attributes.find((trait) => trait.trait_type === "Skin")?.value ?? "Origin";
  const side: Side = meta.attributes.find((trait) => trait.trait_type === "Side")?.value === "Right" ? "Right" : "Left";
  const archetype = archetypeFrom(artId, display);
  const voice = VOICES[archetype];
  const local = LOCAL_BUST[artId];
  const art = artUrl(artId);
  return {
    artId,
    tokenId: tokenFromArt(artId),
    name: meta.name || `CHOG #${artId}`,
    traits: meta.attributes,
    display,
    image: art,
    texture: art,
    mode: local ? "bust" : "photo",
    background: backgroundColor(backgroundName),
    backgroundName,
    skin: skinColor(skinName),
    skinName,
    side,
    archetype,
    voiceId: voice.id,
    voiceName: voice.name,
    // A 1-of-1 has no outfit traits: its own name ("CHOG #53 — Blaze") stands in for them.
    headlineTrait: traitLabel(display, "Body") || traitLabel(display, "Head") || oneOfOneName(meta.name) || "Chog",
  };
}

/** The name a 1-of-1 Chog carries after the dash in its metadata name ("CHOG #53 — Blaze" gives "Blaze"). */
function oneOfOneName(name: string | undefined): string {
  const match = /[—–-]\s*(.+)$/.exec(name ?? "");
  return match ? match[1].trim() : "";
}

export function demoProfile(artId: number): ChogProfile | null {
  const meta = DEMO_META[artId];
  if (!meta) return null;
  return profileFromMeta(artId, meta);
}

export function isDemoArt(artId: number): boolean {
  return (DEMO_ART as readonly number[]).includes(artId);
}

/**
 * Who this person is to a Chog before any wallet says otherwise: the four demo Chogs are lent
 * to everyone; any other Chog is a stranger until its owner connects the wallet that holds it.
 */
export function defaultRelationship(artId: number): TokenMemory["relationship"] {
  return isDemoArt(artId) ? "lent" : "stranger";
}

/** The relationship to use: a verified owner stays an owner; anything else falls back to the default. */
export function relationshipFor(artId: number, stored: TokenMemory["relationship"] | undefined): TokenMemory["relationship"] {
  return stored === "owner" ? "owner" : defaultRelationship(artId);
}

/** Enough of a profile to rebuild it offline with profileFromMeta. The image is the token's own URI. */
export function metaFromProfile(profile: ChogProfile): ChogMeta {
  return { name: profile.name, image: `ipfs://${IMAGE_CID}/${profile.artId}.webp`, attributes: profile.traits };
}

/** The bundled metadata of all 1,969 Chogs (src/data/tokens.json, made by scripts/build-tokens.mjs). */
export type TokenBook = {
  supply: number;
  imageCid: string;
  description: string;
  types: string[];
  values: string[][];
  names: Record<string, string>;
  /** Index art - 1. Each trait is three base-36 characters: its type, then its value (two digits). */
  arts: string[];
};

/** One Chog's metadata, exactly as its IPFS JSON has it, or null when the book has no such Chog. */
export function metaFromBook(book: TokenBook, artId: number): ChogMeta | null {
  if (!isArtId(artId)) return null;
  const row = book.arts[artId - 1];
  if (!row || row.length % 3 !== 0) return null;
  const attributes: ChogMeta["attributes"] = [];
  for (let i = 0; i < row.length; i += 3) {
    const t = parseInt(row[i], 36);
    const trait_type = book.types[t];
    const value = book.values[t]?.[parseInt(row.slice(i + 1, i + 3), 36)];
    if (trait_type === undefined || value === undefined) return null;
    attributes.push({ trait_type, value });
  }
  return {
    name: book.names[String(artId)] ?? `CHOG #${artId}`,
    description: book.description,
    image: `ipfs://${book.imageCid}/${artId}.webp`,
    attributes,
  };
}

let book: Promise<TokenBook> | null = null;

/** Loaded on first use as its own chunk (about 18 KB gzipped), so the first screen never waits on it. */
function loadBook(): Promise<TokenBook> {
  book ??= import("@/data/tokens.json").then((mod) => mod.default as TokenBook);
  return book;
}

/** The bundled metadata for a Chog, or null if the chunk could not load (then a gateway is asked). */
export async function bundledMeta(artId: number): Promise<ChogMeta | null> {
  try {
    return metaFromBook(await loadBook(), artId);
  } catch {
    book = null;
    return null;
  }
}

/**
 * Metadata from the first public gateway that answers. Shared gateways rate-limit in bursts (429),
 * so after a full round of refusals it waits a moment and tries the round once more.
 */
export async function fetchMeta(artId: number, options: { retryDelayMs?: number } = {}): Promise<ChogMeta> {
  let lastError: Error = new Error("The chain blinked. Try that Chog again.");
  for (let round = 0; round < 2; round++) {
    let limited = false;
    for (const gateway of IPFS_GATEWAYS) {
      try {
        const res = await fetch(`${gateway}/${META_CID}/${artId}.json`, { signal: AbortSignal.timeout(6000) });
        if (!res.ok) {
          if (res.status === 429) limited = true;
          continue;
        }
        const meta = (await res.json()) as ChogMeta;
        if (!Array.isArray(meta.attributes)) {
          lastError = new Error("That token came back without a face.");
          continue;
        }
        return meta;
      } catch {
        /* next gateway */
      }
    }
    if (!limited) break;
    await new Promise((resolve) => setTimeout(resolve, options.retryDelayMs ?? 1500));
  }
  throw lastError;
}

/** Parses "375", "#375" (a Chog #, as in its name) or "t883" (a token id). */
export function parseChogInput(input: string): number {
  const trimmed = input.trim().replace(/^#/, "");
  const token = /^t(\d+)$/i.exec(trimmed);
  if (token) {
    const id = Number(token[1]);
    if (!isTokenId(id)) throw new Error("Token ids run from 1 to 1969.");
    return artFromToken(id);
  }
  const asNumber = Number(trimmed);
  if (!trimmed || !Number.isInteger(asNumber)) throw new Error("Enter a Chog number from 1 to 1969.");
  if (isArtId(asNumber)) return asNumber;
  if (isTokenId(asNumber)) return artFromToken(asNumber);
  throw new Error("That number is outside the 1,969.");
}

/**
 * Any Chog by number. Its metadata is bundled, so this needs no network; a gateway is asked only
 * if the bundled chunk could not load.
 */
export async function loadChog(input: string): Promise<ChogProfile> {
  const artId = parseChogInput(input);
  const meta = DEMO_META[artId] ?? (await bundledMeta(artId)) ?? (await fetchMeta(artId));
  return profileFromMeta(artId, meta);
}
