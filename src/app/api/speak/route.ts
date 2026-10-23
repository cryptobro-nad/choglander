import { clientId } from "@/lib/limits";
import { stripAudioTags } from "@/lib/voices";
import { composeLine } from "@/lib/writer";
import { sanitizeContext } from "@/server/context";
import { corsHeaders, preflight } from "@/server/cors";
import { createSpeech, type SpeechResult } from "@/server/speech";

// Only the AI writer runs here (its own 2.5 s timeout); the voice streams separately from /api/voice.
// This is the backstop.
export const maxDuration = 15;

/** A real line context is under 4 KB. Anything far bigger is not from the app. */
const MAX_BODY = 16_000;

export function OPTIONS(request: Request) {
  return preflight(request);
}

export async function POST(request: Request) {
  const cors = corsHeaders(request.headers.get("origin"));
  const fail = (error: string, status: number) => Response.json({ error }, { status, headers: cors });
  // Only JSON. A text/plain or form POST is a CORS "simple" request: it skips the preflight, so
  // any site could make its visitors spend lines. Requiring JSON forces the preflight, which
  // refuses unknown origins. The app always sends application/json.
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
  const ctx = sanitizeContext((body as { context?: unknown } | null)?.context);
  if (!ctx) return fail("Missing context", 400);
  let result: SpeechResult;
  try {
    const voice = (body as { voice?: unknown }).voice !== false;
    result = await createSpeech(ctx, clientId(request.headers), process.env, { voice });
  } catch {
    // Never a 500 for a line: the hand-written bank always has one.
    const line = composeLine(ctx);
    result = { caption: stripAudioTags(line.text), text: line.text, id: line.id, engine: "mock", audioUrl: null, remaining: null };
  }
  return Response.json(result, { headers: { ...cors, "Cache-Control": "no-store" } });
}
