import type { Archetype } from "@/lib/types";

/**
 * The ElevenLabs voice agents that answer when someone calls their Chog back: one per archetype, in
 * that Chog's designed voice, with its character and the house rules (short turns, no financial
 * advice, never says it is an AI) in its prompt, and a slot for each detail liveCallVariables sends
 * (your name, your day, its last line): a call that leaves one out is refused. Calls end by themselves
 * after 75 seconds.
 *
 * While the agents are public, the app connects with the id alone, so no key ships in it, and anyone
 * can reuse these ids. Their own settings in ElevenLabs guard little: a host allowlist
 * (choglander.vercel.app and localhost) that only the websocket path checks, and no bursting past the
 * plan's concurrency at double rate. There is no daily or concurrent call limit of their own. What
 * closes the door is auth: once ELEVENLABS_API_KEY (with TALK_PASS_SECRET) is set, /api/talk hands a
 * one-call credential only to someone holding an invite (src/server/talkLine.ts), and the agents can
 * be made private, after which an id alone gets nowhere. The app's own limits (a few live calls a
 * day per device, a hang-up at 78 s: liveCall.ts) only keep an honest device to its share.
 */
export const AGENTS: Record<Archetype, string> = {
  "told-you-so": "agent_9401m5f2jfqrfdw9m76d7kr6hhdv",
  hype: "agent_7401m5f2jj27fbjr9spnxxx021ye",
  professor: "agent_9201m5f2jkwvfggahfcpq5ds250d",
  gremlin: "agent_6601m5f2jp14e9fv8ghkz0eyhnyj",
  "soap-star": "agent_4901m5f2jqk4ewb9mdjkt0thcj2k",
  "night-shift": "agent_7101m5f2js89fxdbdax0s9g0gs71",
  golden: "agent_4401m5f2jva4f5rrrdjwcpjzkhd8",
  roommate: "agent_4901m5f2jwznextawvcedxnn6q65",
  legend: "agent_7201m5f2jyn7f6n8dmmm2e0ehebc",
};
