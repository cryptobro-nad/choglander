// The ringtones, and how the wake-up rings (Settings > Wake-up call). Every tone is a short score
// of notes: the page plays it with WebAudio (src/lib/sound.ts), and scripts/ringtones.mjs renders
// the same score to a WAV for the Android ring service, so a tone sounds alike on both. This file
// has no imports, so that script can load it as it is.

export type Wave = "sine" | "triangle" | "square" | "sawtooth";

/** One note of a tone. Times are seconds from the start of the loop; `gain` is relative (1 = a plain sine). */
export type RingNote = {
  at: number;
  freq: number;
  dur: number;
  wave?: Wave;
  gain?: number;
  /** Seconds to reach full level. Short for a mallet, long for a pad. */
  attack?: number;
  /** Holds, then fades out over this many seconds. Without it the note dies away like a struck one. */
  release?: number;
  /** Starts this fraction flat and bends up into pitch, like a horn player lipping up. */
  glide?: number;
  /** A low-pass cutoff in Hz: takes the buzz off a sawtooth. */
  cutoff?: number;
};

export type RingToneId = "classic" | "marimba" | "arcade" | "old-phone" | "gentle" | "hype";

export type RingTone = {
  id: RingToneId;
  name: string;
  /** A few words under the name in Settings. */
  blurb: string;
  /** Seconds between loops for a wake-up; a reminder's softer ring waits a little longer. */
  every: number;
  notes: RingNote[];
};

export type RingVolume = "soft" | "normal" | "loud";

export type AlarmStyle = {
  tone: RingToneId;
  volume: RingVolume;
  /** Start soft and get louder over RISE_SECONDS. */
  rise: boolean;
  snoozeMin: number;
  /** The phone vibrates as it rings (the Android app only). */
  vibrate: boolean;
};

export const SNOOZE_CHOICES: readonly number[] = [5, 9, 10, 15];
export const VOLUMES: readonly RingVolume[] = ["soft", "normal", "loud"];
/** How much louder or softer than "normal" each volume plays on the page. */
export const VOLUME_GAIN: Record<RingVolume, number> = { soft: 0.5, normal: 1, loud: 1.8 };
/** "Start soft and get louder": how long the ring takes to reach full volume, and where it starts. */
export const RISE_SECONDS = 25;
export const RISE_FROM = 0.25;

/** Today's ring for everyone who never opened these settings. */
export const DEFAULT_ALARM_STYLE: AlarmStyle = { tone: "classic", volume: "normal", rise: true, snoozeMin: 9, vibrate: true };

/** A chord: the same note shape on several pitches at once. */
function chord(freqs: number[], note: Omit<RingNote, "freq">): RingNote[] {
  return freqs.map((freq) => ({ ...note, freq }));
}

/** A marimba bar: a round fundamental and the quick wooden knock of its fourth partial (3.93x). */
function mallet(at: number, freq: number, gain = 1): RingNote[] {
  return [
    { at, freq, dur: 0.55, gain, attack: 0.005 },
    { at, freq: freq * 3.93, dur: 0.09, gain: gain * 0.14, attack: 0.002 },
  ];
}

/**
 * One ring of an old telephone: the hammer chattering between two bells about twenty-five times a
 * second. Each strike is a bell tone with its clangy, inharmonic overtone (2.76x).
 */
function bellRing(start: number, seconds: number): RingNote[] {
  const notes: RingNote[] = [];
  for (let i = 0; i * 0.04 < seconds; i++) {
    const freq = i % 2 ? 1397 : 1175;
    notes.push({ at: start + i * 0.04, freq, dur: 0.16, gain: 0.55, attack: 0.002 });
    notes.push({ at: start + i * 0.04, freq: freq * 2.76, dur: 0.06, gain: 0.12, attack: 0.002 });
  }
  return notes;
}

const G4 = 392;
const B4 = 493.88;
const C5 = 523.25;
const D5 = 587.33;
const E5 = 659.25;
const G5 = 783.99;
const B5 = 987.77;
const C6 = 1046.5;
const E6 = 1318.51;

export const RINGTONES: readonly RingTone[] = [
  {
    id: "classic",
    name: "Chog Classic",
    blurb: "Three notes, up and bright.",
    every: 1.6,
    notes: [
      { at: 0, freq: 392, dur: 0.22 },
      { at: 0.18, freq: 494, dur: 0.22 },
      { at: 0.36, freq: 587, dur: 0.34, gain: 0.9 },
    ],
  },
  {
    id: "marimba",
    name: "Morning Marimba",
    blurb: "A soft wooden roll.",
    every: 2,
    notes: [...mallet(0, G4), ...mallet(0.13, B4, 0.9), ...mallet(0.26, D5, 0.85), ...mallet(0.39, G5, 0.75), ...mallet(0.7, D5, 0.8), ...mallet(0.83, G5, 0.7)],
  },
  {
    id: "arcade",
    name: "Arcade",
    blurb: "A coin-up riff in 8-bit.",
    every: 1.6,
    notes: [
      ...[C5, E5, G5].map((freq, i) => ({ at: i * 0.1, freq, dur: 0.09, wave: "square" as const, gain: 0.32, attack: 0.004 })),
      { at: 0.3, freq: C6, dur: 0.18, wave: "square", gain: 0.32, attack: 0.004 },
      { at: 0.55, freq: B5, dur: 0.07, wave: "square", gain: 0.3, attack: 0.004 },
      { at: 0.62, freq: E6, dur: 0.32, wave: "square", gain: 0.3, attack: 0.004 },
    ],
  },
  {
    id: "old-phone",
    name: "Old Phone",
    blurb: "A real bell, ring-ring.",
    every: 2.6,
    notes: [...bellRing(0, 0.44), ...bellRing(0.64, 0.44)],
  },
  {
    id: "gentle",
    name: "Gentle Rise",
    blurb: "A warm pad that swells.",
    every: 6,
    notes: [
      ...chord([261.63, 329.63, 392, B4], { at: 0, dur: 2.8, wave: "triangle", gain: 0.55, attack: 1.1, release: 1 }),
      ...chord([220, 261.63, 329.63, 392], { at: 3, dur: 2.8, wave: "triangle", gain: 0.55, attack: 1.1, release: 1 }),
      { at: 0.4, freq: 1046.5, dur: 2.2, gain: 0.18, attack: 0.9, release: 1 },
      { at: 3.4, freq: 880, dur: 2.2, gain: 0.18, attack: 0.9, release: 1 },
    ],
  },
  {
    id: "hype",
    name: "Hype Horn",
    blurb: "Brass stabs. Up you get.",
    every: 1.8,
    notes: [
      ...chord([G4, B4, D5], { at: 0, dur: 0.13, wave: "sawtooth", gain: 0.24, attack: 0.012, release: 0.04, cutoff: 1900 }),
      ...chord([G4, B4, D5], { at: 0.18, dur: 0.13, wave: "sawtooth", gain: 0.24, attack: 0.012, release: 0.04, cutoff: 1900 }),
      ...chord([C5, E5, G5], { at: 0.4, dur: 0.62, wave: "sawtooth", gain: 0.24, attack: 0.02, release: 0.22, glide: 0.04, cutoff: 2400 }),
    ],
  },
];

export function ringtone(id: string | undefined): RingTone {
  return RINGTONES.find((tone) => tone.id === id) ?? RINGTONES[0];
}

/**
 * A saved style, cleaned: anything missing or not one of the choices gets today's default, so a
 * save from before these settings (or a hand-edited one) rings exactly as it always did.
 */
export function cleanAlarmStyle(raw: unknown): AlarmStyle {
  const style = raw && typeof raw === "object" ? (raw as Partial<Record<keyof AlarmStyle, unknown>>) : {};
  const base = DEFAULT_ALARM_STYLE;
  return {
    tone: RINGTONES.some((tone) => tone.id === style.tone) ? (style.tone as RingToneId) : base.tone,
    volume: VOLUMES.includes(style.volume as RingVolume) ? (style.volume as RingVolume) : base.volume,
    rise: typeof style.rise === "boolean" ? style.rise : base.rise,
    snoozeMin: SNOOZE_CHOICES.includes(style.snoozeMin as number) ? (style.snoozeMin as number) : base.snoozeMin,
    vibrate: typeof style.vibrate === "boolean" ? style.vibrate : base.vibrate,
  };
}

/** How long a snooze lasts, in minutes. */
export function snoozeMinutes(style: unknown): number {
  return cleanAlarmStyle(style).snoozeMin;
}

/** When a snooze taken at `now` rings again. */
export function snoozeEnds(now: Date, style: unknown): Date {
  return new Date(now.getTime() + snoozeMinutes(style) * 60_000);
}

/** The call screen's button: "Snooze 9 min". */
export function snoozeLabel(minutes: number): string {
  return `Snooze ${minutes} min`;
}

