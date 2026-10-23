import { corsHeaders, preflight } from "@/server/cors";
import { liveEnabled } from "@/server/speech";

// Whether this server can say a line it writes in the Chog's own ElevenLabs voice. The app asks once:
// when it can, personal lines (your name, your event) are spoken live instead of by the phone.

export function GET(request: Request) {
  const voice = liveEnabled(process.env) && Boolean(process.env.ELEVENLABS_API_KEY?.trim());
  return Response.json(
    { voice },
    { headers: { ...corsHeaders(request.headers.get("origin"), process.env, "GET"), "Cache-Control": "public, max-age=60" } },
  );
}

export function OPTIONS(request: Request) {
  return preflight(request, process.env, "GET");
}
