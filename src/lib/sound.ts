import { DEFAULT_ALARM_STYLE, RISE_FROM, RISE_SECONDS, ringtone, VOLUME_GAIN, type AlarmStyle, type RingNote } from "@/lib/ringtones";

let ctx: AudioContext | null = null;
let ringTimer = 0;
let ringNodes: AudioNode[] = [];
// Every ring plays through one gain: "Start soft" ramps it, and stopping the ring cuts it.
let ringOut: GainNode | null = null;
// Counts rings, so a preview's own stop never silences a real ring that has taken over since.
let ringSeq = 0;
let ringEnded: (() => void) | null = null;

function context() {
  if (typeof window === "undefined") return null;
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

export async function unlockAudio() {
  const audio = context();
  if (!audio) return;
  if (audio.state !== "running") await audio.resume();
}

function tone(audio: AudioContext, freq: number, when: number, dur: number, gain = 0.05) {
  const osc = audio.createOscillator();
  const g = audio.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(gain, when + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  osc.connect(g);
  g.connect(audio.destination);
  osc.start(when);
  osc.stop(when + dur + 0.02);
  ringNodes.push(osc, g);
}

/** One note of a ringtone's score, into `out`. The envelope is the one scripts/ringtones.mjs renders for Android. */
function ringNote(audio: AudioContext, out: AudioNode, note: RingNote, when: number, level: number) {
  const osc = audio.createOscillator();
  const g = audio.createGain();
  osc.type = note.wave ?? "sine";
  osc.frequency.value = note.freq;
  if (note.glide) {
    osc.frequency.setValueAtTime(note.freq * (1 - note.glide), when);
    osc.frequency.exponentialRampToValueAtTime(note.freq, when + 0.06);
  }
  const peak = level * (note.gain ?? 1);
  const attack = note.attack ?? 0.03;
  const end = when + note.dur;
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(peak, when + attack);
  if (note.release) {
    g.gain.setValueAtTime(peak, Math.max(when + attack, end - note.release));
    g.gain.linearRampToValueAtTime(0, end);
  } else {
    g.gain.exponentialRampToValueAtTime(0.0001, end);
  }
  osc.connect(g);
  if (note.cutoff && typeof audio.createBiquadFilter === "function") {
    const filter = audio.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = note.cutoff;
    g.connect(filter);
    filter.connect(out);
  } else {
    g.connect(out);
  }
  osc.start(when);
  osc.stop(end + 0.02);
  ringNodes.push(osc);
}

export function playPop() {
  const audio = context();
  if (!audio) return;
  tone(audio, 520, audio.currentTime, 0.09, 0.04);
}

/**
 * Rings the chosen tone until stopped. `strong` is a wake-up (louder, and sooner round again)
 * rather than a reminder. Without a style it rings Chog Classic, as it always did.
 */
export function startRingtone(strong = false, style: AlarmStyle = DEFAULT_ALARM_STYLE): () => void {
  const audio = context();
  if (!audio) return () => undefined;
  stopRingtone();
  const seq = ++ringSeq;
  const score = ringtone(style.tone);
  const out = audio.createGain();
  const start = audio.currentTime;
  if (style.rise) {
    out.gain.setValueAtTime(RISE_FROM, start);
    out.gain.linearRampToValueAtTime(1, start + RISE_SECONDS);
  }
  out.connect(audio.destination);
  ringOut = out;
  const level = (strong ? 0.07 : 0.045) * (VOLUME_GAIN[style.volume] ?? 1);
  const loop = () => {
    if (seq !== ringSeq) return;
    // Played ones are done with: only the notes still to sound are kept to stop.
    ringNodes = ringNodes.slice(-2 * score.notes.length);
    const t = audio.currentTime + 0.02;
    for (const note of score.notes) ringNote(audio, out, note, t + note.at, level);
  };
  loop();
  // A reminder's softer ring comes round less often, as it always has (2.2 s against 1.6 s).
  ringTimer = window.setInterval(loop, Math.round(score.every * (strong ? 1000 : 1375)));
  return stopRingtone;
}

export function stopRingtone() {
  if (ringTimer) window.clearInterval(ringTimer);
  ringTimer = 0;
  ringSeq++;
  stopNodes(ringNodes);
  ringNodes = [];
  try {
    ringOut?.disconnect();
  } catch {
    /* already cut */
  }
  ringOut = null;
  const ended = ringEnded;
  ringEnded = null;
  ended?.();
}

/**
 * Settings' Preview: a loop or two of a tone at its chosen volume, without the slow start, so it is
 * heard as it will ring at full. `onEnd` runs when it stops, by itself or because a real ring took
 * over. Returns the way to stop it, which leaves any later ring alone.
 */
export function previewRingtone(style: AlarmStyle, onEnd: () => void): () => void {
  const audio = context();
  if (!audio) return () => undefined;
  if (audio.state !== "running") void audio.resume().catch(() => undefined);
  startRingtone(true, { ...style, rise: false });
  const seq = ringSeq;
  ringEnded = onEnd;
  const every = ringtone(style.tone).every;
  const timer = window.setTimeout(() => seq === ringSeq && stopRingtone(), (every < 3 ? every * 2 : every) * 1000);
  return () => {
    window.clearTimeout(timer);
    if (seq === ringSeq) stopRingtone();
  };
}

function stopNodes(nodes: AudioNode[]) {
  for (const node of nodes) {
    try {
      if ("stop" in node && typeof node.stop === "function") node.stop();
    } catch {
      /* already stopped */
    }
  }
}

// The ringback is kept apart from the ringtone, so an alarm ringing in never cuts a call being dialled.
let backTimer = 0;
let backNodes: AudioNode[] = [];

/** One flat "brr" of the ringback: two tones together, eased in and out so it never clicks. */
function burr(audio: AudioContext, when: number, dur: number, gain: number) {
  for (const freq of [400, 450]) {
    const osc = audio.createOscillator();
    const g = audio.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(gain, when + 0.03);
    g.gain.setValueAtTime(gain, when + dur - 0.05);
    g.gain.linearRampToValueAtTime(0, when + dur);
    osc.connect(g);
    g.connect(audio.destination);
    osc.start(when);
    osc.stop(when + dur + 0.02);
    backNodes.push(osc, g);
  }
}

/**
 * The sound of a call going out, while a live call to the Chog connects: "brr-brr", then a pause,
 * as a phone line rings at the other end. Returns the way to stop it, called the moment it picks up.
 */
export function startRingback(): () => void {
  const audio = context();
  if (!audio) return () => undefined;
  stopRingback();
  if (audio.state !== "running") void audio.resume().catch(() => undefined);
  const loop = () => {
    // Played ones are done with: only the nodes still to sound are kept to stop.
    backNodes = backNodes.slice(-8);
    const t = audio.currentTime + 0.05;
    burr(audio, t, 0.4, 0.035);
    burr(audio, t + 0.6, 0.4, 0.035);
  };
  loop();
  backTimer = window.setInterval(loop, 3000);
  return stopRingback;
}

export function stopRingback() {
  if (backTimer) window.clearInterval(backTimer);
  backTimer = 0;
  stopNodes(backNodes);
  backNodes = [];
}
