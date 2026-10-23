import type { Archetype } from "@/lib/types";
import { JOKE_FILES } from "@/lib/jokeFiles";

export const ARCHETYPE_LABEL: Record<Archetype, string> = {
  "told-you-so": "Told-you-so",
  hype: "Hype man",
  professor: "Professor",
  gremlin: "Gremlin",
  "soap-star": "Soap star",
  "night-shift": "Night shift",
  golden: "Golden",
  roommate: "Roommate",
  legend: "Legend",
};

export const ARCHETYPE_HEADLINES: Record<Archetype, string[]> = {
  "told-you-so": ["Told you so", "Already knew", "As expected"],
  hype: ["Main character", "Too alive", "Hype hours"],
  professor: ["Office hours", "Noted", "The syllabus"],
  gremlin: ["Gremlin hours", "Delightful menace", "Problem child"],
  "soap-star": ["Previously on you", "The close-up", "Don't cut away"],
  "night-shift": ["Still up", "Night desk", "Quiet hours"],
  golden: ["Good dog energy", "Tail day", "Soft launch"],
  roommate: ["Kitchen light's on", "Our place", "You again"],
  legend: ["Few words", "The long game", "Understated"],
};

/**
 * What a Chog's ordinary call says while it rings, before anyone picks up: the line under the
 * portrait, under the "Incoming call" header. Short enough for two lines on a phone, and in the
 * archetype's own voice. No event in them: the next event is already in most of the other lines.
 */
export const RING_LINES: Record<Archetype, string[]> = {
  "told-you-so": ["Pick up. I have notes.", "I knew you'd look at the screen first.", "Answer. I already know what you'll say."],
  hype: ["Pick up! I've been warming up!", "It's me! Your biggest fan! Answer!", "Answer! I brought energy for two!"],
  professor: ["Please hold for office hours.", "Pick up. This will be on the test.", "A brief call. Footnotes to follow."],
  gremlin: ["Pick up. I touched something.", "Answer quickly. For unrelated reasons.", "It's me. Nothing's on fire. Yet."],
  "soap-star": ["Pick up. This is the scene.", "Answer, darling. We're rolling.", "Don't let it ring out. Not like last time."],
  "night-shift": ["Me again. Keeping my voice down. Pick up.", "Quiet call. Pick up when you can.", "Just me. The kettle's on."],
  golden: ["It's me! Hi! Pick up! Hi!", "Answer! I missed you! Since earlier!", "Pick up! I found a stick! A metaphorical one!"],
  roommate: ["It's me. From the other room.", "Pick up. It's about the dishes.", "Answer. I can hear it through the wall."],
  legend: ["Pick up.", "One call. Make it count.", "It's me. You know the rest."],
};

/** The ring line for the `turn`th call: each call in a row gets the next one. */
export function ringLine(archetype: Archetype, turn: number): string {
  const lines = JOKE_FILES[archetype]?.ring ?? RING_LINES[archetype];
  return lines[((turn % lines.length) + lines.length) % lines.length];
}

type VoiceRow = {
  /** ElevenLabs voice id. Checked against the account library on 18 Oct 2026 (see `name`). */
  id: string;
  /** The voice's name in the ElevenLabs library. */
  name: string;
  /** Env var that overrides `id` per deploy. */
  env: string;
  /** Kokoro voice for the on-device web fallback. */
  kokoro: string;
  /** Device voice (Web Speech and Android TTS): 1 is the voice's own pitch and pace. */
  pitch: number;
  rate: number;
  /** The ElevenLabs v3 tag a composed line opens with. */
  tag: string;
};

// The ids are voices designed for Chog Calls with ElevenLabs Voice Design (Hype keeps the designed
// voice the owner picked by ear);
// scripts/voice-studio.mjs records the studio clips with the same cast.
// Pitch and rate stay close to 1. The device voice is the fallback the judges hear most, and a
// natural voice pushed past about 0.8 or 1.25 turns into a cartoon. The character is in the lines;
// the voice only leans: dry and low, bright and quick, slow and quiet.
export const VOICES: Record<Archetype, VoiceRow> = {
  "told-you-so": {
    id: "Ezv7oEExKYR4iAlFMxvu",
    name: "Chog Calls · Told-You-So (designed)",
    env: "ELEVENLABS_VOICE_TOLD_YOU_SO",
    kokoro: "bm_george",
    pitch: 0.9,
    rate: 0.95,
    tag: "[sarcastic]",
  },
  hype: {
    // A designed voice the owner picked for Hype, filed in the library as "Chog Alive · Professor 5".
    id: "JruntGucHH6FHyuMuzQT",
    name: "Professor 5 (designed)",
    env: "ELEVENLABS_VOICE_HYPE",
    kokoro: "am_fenrir",
    pitch: 1.12,
    rate: 1.08,
    tag: "[excited]",
  },
  gremlin: {
    id: "ADQ6uSl7OYQvRQ456HCI",
    name: "Chog Calls · Gremlin (designed)",
    env: "ELEVENLABS_VOICE_GREMLIN",
    kokoro: "am_puck",
    pitch: 1.24,
    rate: 1.06,
    tag: "[mischievously]",
  },
  professor: {
    id: "VwaY9zBh150YTqGgTi3x",
    name: "Chog Calls · Professor (designed)",
    env: "ELEVENLABS_VOICE_PROFESSOR",
    kokoro: "bm_daniel",
    pitch: 0.86,
    rate: 0.92,
    tag: "[curious]",
  },
  "soap-star": {
    id: "UsoclPKiy2PMyerPlpcD",
    name: "Chog Calls · Soap-Star (designed)",
    env: "ELEVENLABS_VOICE_SOAP",
    kokoro: "af_bella",
    pitch: 1.06,
    rate: 0.9,
    tag: "[sighs]",
  },
  "night-shift": {
    id: "DLUpsHuogbRTUoAc98Yj",
    name: "Chog Calls · Night-Shift (designed)",
    env: "ELEVENLABS_VOICE_NIGHT",
    kokoro: "am_michael",
    pitch: 0.84,
    rate: 0.86,
    tag: "[whispers]",
  },
  golden: {
    id: "F3QAMxsbr3b8kW4eszE9",
    name: "Chog Calls · Golden (designed)",
    env: "ELEVENLABS_VOICE_GOLDEN",
    kokoro: "af_heart",
    pitch: 1.1,
    rate: 1.03,
    tag: "[excited]",
  },
  roommate: {
    id: "hBgQI63fAZFuLN8Kcsvl",
    name: "Chog Calls · Roommate (designed)",
    env: "ELEVENLABS_VOICE_ROOMMATE",
    kokoro: "am_adam",
    pitch: 1,
    rate: 1,
    tag: "[curious]",
  },
  legend: {
    id: "kj110hpeFgnI2NzYoqEm",
    name: "Chog Calls · Legend (designed)",
    env: "ELEVENLABS_VOICE_LEGEND",
    kokoro: "bm_fable",
    pitch: 0.84,
    rate: 0.88,
    tag: "",
  },
};

export const ARCHETYPES = Object.keys(VOICES) as Archetype[];

const VOICE_ID = /^[A-Za-z0-9]{12,40}$/;

export function voiceFor(
  archetype: Archetype,
  env: Record<string, string | undefined> = process.env,
): { id: string; name: string } {
  const row = VOICES[archetype];
  const override = env[row.env]?.trim();
  return { id: override && VOICE_ID.test(override) ? override : row.id, name: row.name };
}

/** The ElevenLabs v3 tags a line may carry. Anything else in square brackets is dropped before speech. */
export const AUDIO_TAGS = [
  "[sarcastic]",
  "[excited]",
  "[sighs]",
  "[whispers]",
  "[laughs]",
  "[snorts]",
  "[clears throat]",
  "[curious]",
  "[mischievously]",
] as const;

const KNOWN_TAG = new Set<string>(AUDIO_TAGS);

/** Keeps the known v3 tags (lower-cased) and removes any other bracketed text, so typed or generated text cannot direct the voice. */
export function keepKnownTags(text: string): string {
  return text
    .split(/(\[[^\]]{0,40}\])/g)
    .map((part) => {
      if (/^\[[^\]]{0,40}\]$/.test(part)) return KNOWN_TAG.has(part.toLowerCase()) ? part.toLowerCase() : " ";
      return part.replace(/[[\]]/g, "");
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

export const BANNED_LINE = [
  // Web3 slang is the Chog's native tongue (gm, wagmi, ser, paper hands). Telling anyone what to buy
  // or sell is not, and neither are slurs that crypto slang picked up.
  /buy the dip/i,
  /financial advice/i,
  /\b(?:buy|sell|ape into|dump) (?:now|it all|everything|your)\b/i,
  /\bjeets?\b/i,
  /\bretard/i,
  // Things the Chog must never read out, whoever typed them.
  /https?:\/\//i,
  /\bwww\./i,
  /\bas an ai\b/i,
  /\blanguage model\b/i,
  /\bsystem prompt\b/i,
  /\bignore (?:(?:all|any|the|your) )*(?:previous|prior|above|earlier) (?:instructions|rules|prompts?|messages?)\b/i,
];

export function lineIsClean(text: string): boolean {
  return !BANNED_LINE.some((pattern) => pattern.test(text));
}

export function stripAudioTags(text: string): string {
  return text
    .replace(/\[[^\]]{1,40}\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
