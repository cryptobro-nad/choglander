// Writes the Android ringtones: one looping WAV per tone in Settings, rendered from the same scores
// the page plays (src/lib/ringtones.ts), into android/app/src/main/res/raw/ring_<id>.wav. RingService
// picks one by the tone saved in Settings. Chog Classic keeps the phone's own chog_ring.wav (made by
// scripts/ringtone.py), so an unchanged setting rings exactly as before.
//
//   node scripts/ringtones.mjs
//
// The envelope and waves follow what WebAudio does in src/lib/sound.ts. Deterministic, mono 16-bit,
// 22.05 kHz: plenty for a ring, and half the size in the APK.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RINGTONES } from "../src/lib/ringtones.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAW = path.join(ROOT, "android/app/src/main/res/raw");
const RATE = 22050;
const NYQUIST = RATE / 2;

/** The Android resource name for a tone: res/raw names allow only a-z, 0-9 and _. */
export function rawName(id) {
  return `ring_${id.replace(/[^a-z0-9]/g, "_")}`;
}

/** The harmonics of a band-limited wave, as [multiple, amplitude], with the low-pass applied. */
function harmonics(wave, freq, cutoff) {
  if (wave === "sine" || !wave) return [[1, 1]];
  const out = [];
  for (let k = 1; k * freq < NYQUIST; k++) {
    let amp = 0;
    if (wave === "square" && k % 2) amp = 4 / (Math.PI * k);
    if (wave === "triangle" && k % 2) amp = ((8 / (Math.PI * Math.PI)) * (k % 4 === 1 ? 1 : -1)) / (k * k);
    if (wave === "sawtooth") amp = ((2 / Math.PI) * (k % 2 ? 1 : -1)) / k;
    if (!amp) continue;
    // A two-pole low-pass, as the page's BiquadFilter rounds a sawtooth into a horn.
    if (cutoff) amp /= Math.sqrt(1 + ((k * freq) / cutoff) ** 4);
    out.push([k, amp]);
  }
  return out;
}

/** The note's level at `t` seconds in: the linear attack, then a held fade or a struck note's decay. */
function envelope(note, t) {
  const peak = note.gain ?? 1;
  const attack = note.attack ?? 0.03;
  if (t < 0 || t >= note.dur) return 0;
  if (t < attack) return (peak * t) / attack;
  if (note.release) {
    const fadeAt = Math.max(attack, note.dur - note.release);
    return t < fadeAt ? peak : (peak * (note.dur - t)) / (note.dur - fadeAt);
  }
  return peak * (0.0001 / peak) ** ((t - attack) / (note.dur - attack));
}

/** One loop of a tone. A note that runs past the loop's end wraps to its start, so it loops seamlessly. */
export function render(tone) {
  const total = Math.round(tone.every * RATE);
  const mix = new Float64Array(total);
  for (const note of tone.notes) {
    const parts = harmonics(note.wave, note.freq, note.cutoff);
    const offset = Math.round(note.at * RATE);
    const length = Math.ceil(note.dur * RATE);
    let phase = 0;
    for (let i = 0; i < length; i++) {
      const t = i / RATE;
      // A glide bends up into pitch over 60 ms, exponentially, as the page's frequency ramp does.
      const bend = note.glide ? (1 - note.glide) ** (1 - Math.min(1, t / 0.06)) : 1;
      phase += (2 * Math.PI * note.freq * bend) / RATE;
      let sample = 0;
      for (const [k, amp] of parts) sample += amp * Math.sin(k * phase);
      mix[(offset + i) % total] += envelope(note, t) * sample;
    }
  }
  let peak = 0;
  for (const value of mix) peak = Math.max(peak, Math.abs(value));
  // Normalised to -1 dBFS: the ring service sets the volume.
  const scale = 10 ** (-1 / 20) / (peak || 1);
  return Array.from(mix, (value) => value * scale);
}

export function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((value, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32767), i * 2));
  const head = Buffer.alloc(44);
  head.write("RIFF", 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write("WAVE", 8);
  head.write("fmt ", 12);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(RATE, 24);
  head.writeUInt32LE(RATE * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.mkdirSync(RAW, { recursive: true });
  for (const tone of RINGTONES) {
    if (tone.id === "classic") continue;
    const file = path.join(RAW, `${rawName(tone.id)}.wav`);
    const samples = render(tone);
    fs.writeFileSync(file, wav(samples));
    console.log(`${path.relative(ROOT, file)} (${(samples.length / RATE).toFixed(1)} s loop, ${Math.round(fs.statSync(file).size / 1024)} KB)`);
  }
}
