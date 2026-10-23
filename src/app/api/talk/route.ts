import { clientIp } from "@/lib/limits";
import { corsHeaders, preflight } from "@/server/cors";
import { answerTalk, readTalkRequest } from "@/server/talkLine";

// The door to a live call (src/server/talkLine.ts): "public" until invites are switched on, then a
// one-call credential for someone holding a pass. Every answer is for one caller at one moment, so
// none is cached.

// ElevenLabs gets 8 s to hand over a credential. This is the backstop.
export const maxDuration = 15;

/** A real request is under 2 KB (the pass is most of it). */
const MAX_BODY = 4_000;

export function OPTIONS(request: Request) {
  return preflight(request);
}

export async function POST(request: Request) {
  const headers = { ...corsHeaders(request.headers.get("origin")), "Cache-Control": "no-store" };
  const fail = (error: string, status: number) => Response.json({ error }, { status, headers });
  // Only JSON, as on /api/speak: a text/plain or form POST skips the CORS preflight, so any site
  // could ask for lines on its visitors' behalf. Requiring JSON forces the preflight.
  const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") return fail("Send JSON", 415);
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_BODY) return fail("Too large", 413);
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return fail("Bad request", 400);
  }
  if (raw.length > MAX_BODY) return fail("Too large", 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail("Bad request", 400);
  }
  const ask = readTalkRequest(body);
  if (!ask) return fail("Bad request", 400);
  const answer = await answerTalk(ask, { env: process.env, ip: clientIp(request.headers) });
  return Response.json(answer.body, { status: answer.status, headers });
}
