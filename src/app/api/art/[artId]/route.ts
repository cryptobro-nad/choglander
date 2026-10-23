import { isArtId } from "@/lib/ids";
import { portrait } from "@/lib/portraitSource";

// GET /api/art/<art> -> the official portrait (the original webp), from this origin, for any Chog.
// Public gateways answer 429 without CORS under load, which leaves a WebGL texture blank. This asks
// them in turn, starting the next one when one fails or is slow, keeps only an answer that really is
// a webp, and serves it with CORS and a year of immutable caching: the art is content-addressed.

// A slow but working gateway (Pinata takes about 5 s) still gets its full budget while the next one
// starts, so the worst case is about 14 s and the usual one well under a second.
export const maxDuration = 20;

const IMMUTABLE = "public, max-age=31536000, s-maxage=31536000, immutable";
const BASE_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Cross-Origin-Resource-Policy": "cross-origin",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(_request: Request, context: { params: Promise<{ artId: string }> }) {
  const { artId: raw } = await context.params;
  const artId = /^[1-9]\d{0,3}$/.test(raw) ? Number(raw) : NaN;
  if (!isArtId(artId)) {
    return new Response("Not a Chog. Art numbers run from 1 to 1969.", {
      status: 404,
      headers: { ...BASE_HEADERS, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=86400" },
    });
  }
  const bytes = await portrait(artId);
  if (!bytes) {
    return new Response("Every IPFS gateway is busy. Try again in a moment.", {
      status: 502,
      headers: { ...BASE_HEADERS, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "2" },
    });
  }
  return new Response(bytes, {
    headers: {
      ...BASE_HEADERS,
      "Content-Type": "image/webp",
      "Content-Length": String(bytes.length),
      "Cache-Control": IMMUTABLE,
    },
  });
}
