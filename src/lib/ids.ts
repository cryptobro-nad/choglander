export const CHOG_SUPPLY = 1969;
export const CHOG_OFFSET = 1460;
export const CHOG_CONTRACT = "0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763";
export const CHOG_CHAIN_ID = 143;
export const CHOG_RPC = "https://rpc.monad.xyz";
export const META_CID = "bafybeid4ybujnscdipkno7ps5utqelp5ry5ryreqhay3zhgk3a6x4jruqu";
/** Every portrait lives at IMAGE_CID/<art>.webp (checked for all 1,969 by scripts/build-tokens.mjs). */
export const IMAGE_CID = "bafybeihau2egcccbdxymeckmmbrqytbfor5gkt3en6d5fsbueymdbq7g6e";
export const PINATA_GATEWAY = "https://gateway.pinata.cloud/ipfs";

/**
 * Public IPFS gateways, best first. Filebase answered in about 0.4 s and Pinata in about 5 s when
 * measured; the Protocol Labs family (ipfs.io, w3s.link) shares one rate limit and answers 429
 * under load. All of them send CORS headers on a 200, none on a 429. dweb.link is left out: wallet
 * scanners (MetaMask's, from Blockaid) list it as drainer infrastructure, and a page that calls it
 * gets flagged with it.
 */
export const IPFS_GATEWAYS = [
  "https://ipfs.filebase.io/ipfs",
  PINATA_GATEWAY,
  "https://ipfs.io/ipfs",
  "https://w3s.link/ipfs",
] as const;

function mod(n: number, m: number) {
  return ((n % m) + m) % m;
}

/** Art file number is not the token id. file = ((tokenId + 1460) mod 1969) + 1 */
export function artFromToken(tokenId: number): number {
  return mod(tokenId + CHOG_OFFSET, CHOG_SUPPLY) + 1;
}

/**
 * The on-chain token behind an art number. Tokens run 1..1969: there is no token 0 (ownerOf(0)
 * reverts), and art #1461 belongs to token 1969, its tokenURI says so.
 */
export function tokenFromArt(artId: number): number {
  return mod(artId - 1 - CHOG_OFFSET, CHOG_SUPPLY) || CHOG_SUPPLY;
}

export function isArtId(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= CHOG_SUPPLY;
}

export function isTokenId(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= CHOG_SUPPLY;
}

/** "<cid>/<art>.webp": the official portrait, relative to any gateway's /ipfs. */
export function artPath(artId: number): string {
  return `${IMAGE_CID}/${artId}.webp`;
}

export function pinataUrl(cidPath: string): string {
  return `${PINATA_GATEWAY}/${cidPath.replace(/^\/+/, "")}`;
}

export function ipfsToPinata(uri: string | undefined | null): string | null {
  if (!uri) return null;
  if (uri.startsWith("ipfs://")) return pinataUrl(uri.slice("ipfs://".length));
  return uri;
}

/** ownerOf(uint256) call data for a token. */
export function ownerOfData(tokenId: number): string {
  return `0x6352211e${tokenId.toString(16).padStart(64, "0")}`;
}

/**
 * The owner address from an ownerOf result, lowercased. Null when the chain gave nothing usable
 * ("0x" from a chain without the contract, a short word, or the zero address), which means
 * "could not check", never "not yours".
 */
export function parseOwnerResult(result: unknown): string | null {
  if (typeof result !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(result)) return null;
  const owner = `0x${result.slice(-40)}`.toLowerCase();
  return /^0x0{40}$/.test(owner) ? null : owner;
}

export function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

/**
 * Reads ownerOf straight from the Monad RPC (chain 143), whatever network a wallet is on.
 * Throws on a timeout, a revert or an unusable answer.
 */
export async function rpcOwnerOf(tokenId: number, options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}): Promise<string> {
  if (!isTokenId(tokenId)) throw new Error("Not a Chog token.");
  const run = options.fetchImpl ?? fetch;
  const res = await run(CHOG_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: CHOG_CONTRACT, data: ownerOfData(tokenId) }, "latest"] }),
    signal: AbortSignal.timeout(options.timeoutMs ?? 4000),
  });
  if (!res.ok) throw new Error(`Monad RPC answered ${res.status}.`);
  const body = (await res.json()) as { result?: unknown; error?: { message?: string } };
  const owner = parseOwnerResult(body.result);
  if (!owner) throw new Error(body.error?.message || "Monad gave no owner.");
  return owner;
}
