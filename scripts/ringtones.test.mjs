import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RINGTONES } from "../src/lib/ringtones.ts";
import { rawName, render } from "./ringtones.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("the Android ringtones", () => {
  it("renders each tone as one loop of its own length, at full level without clipping", () => {
    for (const tone of RINGTONES) {
      const samples = render(tone);
      expect(samples.length, tone.id).toBe(Math.round(tone.every * 22050));
      const peak = samples.reduce((top, value) => Math.max(top, Math.abs(value)), 0);
      expect(peak, tone.id).toBeCloseTo(10 ** (-1 / 20), 3);
    }
  });

  it("has a WAV in res/raw for every tone but Classic, and the ring service plays each one", () => {
    const service = fs.readFileSync(path.join(ROOT, "android/app/src/main/java/com/chog/calls/RingService.java"), "utf8");
    for (const tone of RINGTONES) {
      if (tone.id === "classic") continue;
      expect(fs.existsSync(path.join(ROOT, `android/app/src/main/res/raw/${rawName(tone.id)}.wav`)), tone.id).toBe(true);
      expect(service, tone.id).toContain(`"${tone.id}".equals(tone)) return R.raw.${rawName(tone.id)};`);
    }
    expect(rawName("old-phone")).toBe("ring_old_phone");
  });
});
