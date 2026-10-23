import { isTokenId, rpcOwnerOf } from "@/lib/ids";

// GET /api/owner?token=<tokenId> -> { owner }
// ownerOf is read on Monad (chain 143) through the public RPC, so the answer never depends on
// which network the visitor's wallet happens to be on.

const FRESH_MS = 30_000;
const cache = new Map<number, { owner: string; at: number }>();

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("token") ?? "";
  const token = /^\d{1,4}$/.test(raw) ? Number(raw) : NaN;
  if (!isTokenId(token)) {
    return Response.json({ error: "token must be a Chog token id from 1 to 1969" }, { status: 400 });
  }
  const hit = cache.get(token);
  if (hit && Date.now() - hit.at < FRESH_MS) {
    return Response.json({ owner: hit.owner, cached: true }, { headers: { "cache-control": "private, max-age=15" } });
  }
  try {
    const owner = await rpcOwnerOf(token, { timeoutMs: 4000 });
    cache.set(token, { owner, at: Date.now() });
    if (cache.size > 500) cache.delete(cache.keys().next().value as number);
    return Response.json({ owner }, { headers: { "cache-control": "private, max-age=15" } });
  } catch {
    return Response.json({ owner: null, error: "Could not read Monad right now." }, { status: 502 });
  }
}
