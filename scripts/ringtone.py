"""Write the Android alarm ringtone: android/app/src/main/res/raw/chog_ring.wav.

A phone ring played on a soft mallet: two quick shimmering arpeggios (ring-ring), then the
Chog's own two-note "bo-ing", then a breath of silence. One loop is 3.2 s; RingService loops it on
the alarm stream and brings the volume up over 25 s, so the first ring is gentle and the tenth is
not. Standard library only, deterministic, mono 16-bit 44.1 kHz.

    python scripts/ringtone.py
"""
import math
import struct
import wave
from pathlib import Path

RATE = 44100
LOOP_SECONDS = 3.2

G4, D5, G5, B5, D6, G6 = 392.00, 587.33, 783.99, 987.77, 1174.66, 1567.98

# (start seconds, frequency, velocity, glide) - glide bends the note up into pitch.
NOTES = []
for burst in (0.00, 0.55):
    for step, (freq, vel) in enumerate(((G5, 0.62), (B5, 0.56), (D6, 0.52), (G6, 0.40))):
        NOTES.append((burst + step * 0.07, freq, vel, 0.0))
NOTES.append((1.28, D5, 0.78, 0.035))  # "bo-"
NOTES.append((1.43, G5, 0.70, 0.0))    # "-ing"
NOTES.append((1.43, G4, 0.22, 0.0))    # a little body under it

# Mallet partials: (ratio to the fundamental, level, decay per second). The 3.93 partial is the
# wooden "knock" of a marimba bar; it dies fast so the tone stays round.
PARTIALS = ((1.0, 1.0, 3.6), (2.0, 0.22, 7.5), (3.93, 0.10, 16.0))


def note_samples(freq, velocity, glide):
    length = int(RATE * 1.4)
    out = [0.0] * length
    phases = [0.0] * len(PARTIALS)
    for i in range(length):
        t = i / RATE
        attack = min(1.0, t / 0.004)
        bend = 1.0 - glide * math.exp(-t / 0.04) if glide else 1.0
        sample = 0.0
        for k, (ratio, level, decay) in enumerate(PARTIALS):
            phases[k] += 2 * math.pi * freq * ratio * bend / RATE
            sample += level * math.exp(-decay * t) * math.sin(phases[k])
        out[i] = velocity * attack * sample
    return out


def room(dry):
    """A small, soft room: a few decaying early reflections, so the mallet doesn't sound clinical."""
    wet = dry[:]
    for delay_ms, gain in ((23, 0.22), (41, 0.16), (67, 0.12), (97, 0.08), (131, 0.05)):
        d = int(RATE * delay_ms / 1000)
        for i in range(d, len(dry)):
            wet[i] += gain * dry[i - d]
    return wet


def render():
    total = int(RATE * LOOP_SECONDS)
    mix = [0.0] * total
    for start, freq, velocity, glide in NOTES:
        offset = int(RATE * start)
        for i, value in enumerate(note_samples(freq, velocity, glide)):
            if offset + i < total:
                mix[offset + i] += value
    mix = room(mix)
    # Fade the last 150 ms to silence so the loop point is clean.
    fade = int(RATE * 0.15)
    for i in range(fade):
        mix[total - fade + i] *= 1.0 - (i + 1) / fade
    peak = max(abs(v) for v in mix) or 1.0
    scale = 10 ** (-1.0 / 20) / peak  # normalise to -1 dBFS
    return [v * scale for v in mix]


def main():
    path = Path(__file__).resolve().parents[1] / "android" / "app" / "src" / "main" / "res" / "raw" / "chog_ring.wav"
    path.parent.mkdir(parents=True, exist_ok=True)
    frames = render()
    with wave.open(str(path), "w") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(RATE)
        handle.writeframes(b"".join(struct.pack("<h", int(max(-1.0, min(1.0, v)) * 32767)) for v in frames))
    print(f"{path} ({len(frames) / RATE:.1f} s loop)")


if __name__ == "__main__":
    main()
