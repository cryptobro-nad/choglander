// Studio clips: every voiced joke line is recorded once in its Chog's ElevenLabs voice and ships with
// the app under public/voice/<archetype>/<key>.mp3. scripts/voice-studio.ts records them and writes the
// list of recorded keys (src/data/voice-clips.json). No imports here: the script loads this file directly.

/** Slots a recorded line can't hold. {Name} is fine: the clip is recorded without it. */
const UNRECORDABLE = /\{(?!Name\})[A-Za-z]+\}/;

/** Whether a bank line can be recorded once and played as is: no slot but {Name}. */
export function recordable(raw: string): boolean {
  return !UNRECORDABLE.test(raw);
}

/** What the clip says (and the caption shows) for a recordable line: the line without {Name}. */
export function spokenText(raw: string): string {
  return raw.replaceAll("{Name}", "").replace(/\s+/g, " ").trim();
}

/** A stable key for one archetype's line: two 32-bit FNV-1a hashes, so a changed line gets a new clip. */
export function clipKey(archetype: string, raw: string): string {
  const input = `${archetype}|${spokenText(raw)}`;
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ ((code * 31 + i) & 0xffff), 0x5bd1e995) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/** Where the app finds a clip: a path on its own origin, in the web build and in the APK alike. */
export function clipUrl(archetype: string, key: string): string {
  return `/voice/${archetype}/${key}.mp3`;
}
