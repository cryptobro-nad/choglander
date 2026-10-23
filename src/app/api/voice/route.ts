import { after } from "next/server";
import { handleVoice, voicePreflight } from "@/server/voice";

// The first byte has CHOG_TTS_TIMEOUT_MS (3.5 s); a whole clip is capped at 25 s. This is the backstop.
export const maxDuration = 30;

const keepAlive = (work: Promise<unknown>) => after(() => work);

export function GET(request: Request) {
  return handleVoice(request, process.env, { keepAlive });
}

// Answered from the ticket and the cache alone: a HEAD never spends a clip.
export function HEAD(request: Request) {
  return handleVoice(request, process.env);
}

export function OPTIONS(request: Request) {
  return voicePreflight(request);
}
