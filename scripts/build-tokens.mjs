// Bundles the metadata of all 1,969 Chogs into src/data/tokens.json, so the app never needs an
// IPFS gateway to learn who a Chog is. The gateways answer 429 under load, and without CORS.
//
//   node scripts/build-tokens.mjs                      build from the chog-alive census
//   node scripts/build-tokens.mjs --src=path/to/tokens.json
//   node scripts/build-tokens.mjs --live=12            ...then compare 12 tokens with live IPFS metadata
//
// The source is chog-alive's census (src/data/tokens.json there): one entry per token with its
// tokenId, metaId (the art number), image "<cid>/<art>.webp" and its traits in metadata order.
// Every entry is checked against this app's ids.ts (art = ((token + 1460) mod 1969) + 1, token ids
// 1..1969, META_CID) and against trait-catalog.json before anything is written.
//
// Output, kept small because it ships to the client as its own lazily loaded chunk:
//   types   trait types, in first-seen order
//   values  per type, its values in first-seen order
//   names   only the names that are not "CHOG #<art>" (the named one-of-ones)
//   arts    index art - 1; each trait is three base-36 characters: type, then value (two digits),
//           in the token's own metadata order. "0a10b2..." -> [types[0], values[0][10]], ...
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outJson = path.join(root, "src/data/tokens.json");
const idsTs = path.join(root, "src/lib/ids.ts");
const catalogJson = path.join(root, "src/data/trait-catalog.json");

const SUPPLY = 1969;
const OFFSET = 1460;
const DESCRIPTION = "CHOG — a 1969-piece collection on Monad.";
const LIVE_GATEWAYS = ["https://ipfs.filebase.io/ipfs", "https://gateway.pinata.cloud/ipfs", "https://ipfs.io/ipfs"];

function option(name) {
  const hit = process.argv.find((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`));
  if (hit === undefined) return undefined;
  const eq = hit.indexOf("=");
  return eq === -1 ? "" : hit.slice(eq + 1);
}

function fail(message) {
  console.error(`build-tokens: ${message}`);
  process.exit(1);
}

function findSource() {
  const given = option("src") || process.env.CHOG_TOKENS_SRC;
  const candidates = given
    ? [path.resolve(given)]
    : [
        path.resolve(root, "../chog-alive/src/data/tokens.json"),
        path.resolve(root, "../../chog-alive/src/data/tokens.json"),
      ];
  const found = candidates.find((file) => fs.existsSync(file));
  if (!found) fail(`no census found. Tried: ${candidates.join(", ")} (pass --src=<tokens.json>)`);
  return found;
}

const artFromToken = (token) => ((token + OFFSET) % SUPPLY) + 1;

function readMetaCid() {
  const match = /export const META_CID = "([^"]+)"/.exec(fs.readFileSync(idsTs, "utf8"));
  if (!match) fail("META_CID not found in src/lib/ids.ts");
  return match[1];
}

function readImageCid() {
  const match = /export const IMAGE_CID = "([^"]+)"/.exec(fs.readFileSync(idsTs, "utf8"));
  if (!match) fail("IMAGE_CID not found in src/lib/ids.ts");
  return match[1];
}

function digits(n, width) {
  const text = n.toString(36);
  if (text.length > width) fail(`index ${n} does not fit in ${width} base-36 digits`);
  return text.padStart(width, "0");
}

export function build(census, { metaCid, imageCid, catalog }) {
  if (census.metadataCid !== metaCid) fail(`census metadataCid ${census.metadataCid} is not ids.ts META_CID ${metaCid}`);
  const tokens = census.tokens;
  if (!Array.isArray(tokens) || tokens.length !== SUPPLY) fail(`expected ${SUPPLY} tokens, found ${tokens?.length}`);

  const byArt = new Array(SUPPLY);
  const seenTokens = new Set();
  for (const entry of tokens) {
    const { tokenId, metaId, image, traits } = entry;
    if (!Number.isInteger(tokenId) || tokenId < 1 || tokenId > SUPPLY) fail(`token id out of range: ${tokenId}`);
    if (seenTokens.has(tokenId)) fail(`duplicate token ${tokenId}`);
    seenTokens.add(tokenId);
    const art = artFromToken(tokenId);
    if (metaId !== art) fail(`token ${tokenId}: census says art ${metaId}, ids.ts formula says ${art}`);
    if (byArt[art - 1]) fail(`art ${art} appears twice`);
    if (image !== `${imageCid}/${art}.webp`) fail(`token ${tokenId}: image ${image} is not ${imageCid}/${art}.webp`);
    if (!traits || typeof traits !== "object" || !Object.keys(traits).length) fail(`token ${tokenId} has no traits`);
    byArt[art - 1] = entry;
  }

  const types = [];
  const values = [];
  const names = {};
  const arts = byArt.map((entry, index) => {
    const art = index + 1;
    if (entry.name !== `CHOG #${art}`) {
      if (!entry.name.startsWith(`CHOG #${art}`)) fail(`art ${art} is named "${entry.name}"`);
      names[art] = entry.name;
    }
    let row = "";
    for (const [type, value] of Object.entries(entry.traits)) {
      if (typeof value !== "string") fail(`art ${art}: ${type} is not a string`);
      if (!catalog.labels?.[type] || !(value in catalog.labels[type])) fail(`art ${art}: ${type} = ${value} is not in trait-catalog.json`);
      let t = types.indexOf(type);
      if (t === -1) {
        t = types.push(type) - 1;
        values.push([]);
      }
      let v = values[t].indexOf(value);
      if (v === -1) v = values[t].push(value) - 1;
      row += digits(t, 1) + digits(v, 2);
    }
    return row;
  });

  return { v: 1, supply: SUPPLY, offset: OFFSET, metaCid, imageCid, block: census.block, description: DESCRIPTION, types, values, names, arts };
}

/** The same decoding chog.ts does, so the written file is proven to round-trip. */
export function decode(book, art) {
  const row = book.arts[art - 1];
  const attributes = [];
  for (let i = 0; i < row.length; i += 3) {
    const t = parseInt(row[i], 36);
    attributes.push({ trait_type: book.types[t], value: book.values[t][parseInt(row.slice(i + 1, i + 3), 36)] });
  }
  return { name: book.names[art] ?? `CHOG #${art}`, description: book.description, image: `ipfs://${book.imageCid}/${art}.webp`, attributes };
}

/** Writes the arts one per line: small, and a re-run shows exactly which Chogs changed. */
function serialize(book) {
  const { arts, ...head } = book;
  const top = JSON.stringify(head).slice(0, -1);
  return `${top},"arts":[\n${arts.map((row) => JSON.stringify(row)).join(",\n")}\n]}\n`;
}

async function fetchLive(art, metaCid) {
  for (const gateway of LIVE_GATEWAYS) {
    try {
      const res = await fetch(`${gateway}/${metaCid}/${art}.json`, { signal: AbortSignal.timeout(10_000) });
      if (res.ok) return await res.json();
    } catch {
      /* next gateway */
    }
  }
  return null;
}

async function main() {
  const source = findSource();
  const census = JSON.parse(fs.readFileSync(source, "utf8"));
  const catalog = JSON.parse(fs.readFileSync(catalogJson, "utf8"));
  const book = build(census, { metaCid: readMetaCid(), imageCid: readImageCid(), catalog });

  for (const entry of census.tokens) {
    const art = artFromToken(entry.tokenId);
    const decoded = decode(book, art);
    const expected = Object.entries(entry.traits).map(([trait_type, value]) => ({ trait_type, value }));
    if (decoded.name !== entry.name || JSON.stringify(decoded.attributes) !== JSON.stringify(expected)) fail(`art ${art} does not round-trip`);
  }

  const text = serialize(book);
  JSON.parse(text);
  fs.writeFileSync(outJson, text);
  console.log(`Wrote ${path.relative(root, outJson)}: ${SUPPLY} Chogs, ${book.types.length} trait types, ${Object.keys(book.names).length} named, ${text.length} bytes (from ${source})`);

  const live = option("live");
  if (live !== undefined) {
    const count = Math.max(1, Number(live) || 8);
    const picks = new Set([1, 53, 1461, SUPPLY]);
    while (picks.size < count) picks.add(1 + Math.floor(Math.random() * SUPPLY));
    let checked = 0;
    for (const art of picks) {
      const meta = await fetchLive(art, book.metaCid);
      if (!meta) {
        console.warn(`  art ${art}: no gateway answered, skipped`);
        continue;
      }
      const ours = decode(book, art);
      const same =
        meta.name === ours.name &&
        meta.image === ours.image &&
        meta.description === ours.description &&
        JSON.stringify(meta.attributes) === JSON.stringify(ours.attributes);
      if (!same) fail(`art ${art} differs from live IPFS metadata`);
      checked += 1;
      console.log(`  art ${art}: matches live IPFS metadata`);
    }
    console.log(`Live check: ${checked}/${picks.size} matched`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
