import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultSaved, KEY, loadSaved } from "@/lib/persist";
import { cleanAlarmStyle, DEFAULT_ALARM_STYLE, RINGTONES, ringtone, SNOOZE_CHOICES, snoozeEnds, snoozeLabel, snoozeMinutes } from "@/lib/ringtones";
import { ARCHETYPES } from "@/lib/voices";
import { plainSnoozeLine, snoozePick } from "@/lib/writer";

describe("the ringtones", () => {
  it("offers six named tones, Chog Classic first and the default", () => {
    expect(RINGTONES.map((tone) => tone.name)).toEqual(["Chog Classic", "Morning Marimba", "Arcade", "Old Phone", "Gentle Rise", "Hype Horn"]);
    expect(new Set(RINGTONES.map((tone) => tone.id)).size).toBe(RINGTONES.length);
    expect(DEFAULT_ALARM_STYLE.tone).toBe("classic");
    expect(ringtone("nope").id).toBe("classic");
  });

  it("keeps Chog Classic exactly as it rang: three rising sine notes every 1.6 s", () => {
    const classic = ringtone("classic");
    expect(classic.every).toBe(1.6);
    expect(classic.notes.map((note) => [note.at, note.freq, note.dur, note.wave ?? "sine"])).toEqual([
      [0, 392, 0.22, "sine"],
      [0.18, 494, 0.22, "sine"],
      [0.36, 587, 0.34, "sine"],
    ]);
  });

  it("makes every tone its own sound, and fits each note inside its loop", () => {
    const prints = RINGTONES.map((tone) => tone.notes.map((note) => `${note.wave ?? "sine"}:${Math.round(note.freq)}@${note.at}`).join(","));
    expect(new Set(prints).size).toBe(RINGTONES.length);
    expect(ringtone("arcade").notes.every((note) => note.wave === "square")).toBe(true);
    expect(ringtone("hype").notes.every((note) => note.wave === "sawtooth" && note.cutoff)).toBe(true);
    for (const tone of RINGTONES) {
      expect(tone.notes.length, tone.id).toBeGreaterThan(0);
      for (const note of tone.notes) {
        expect(note.at + note.dur, tone.id).toBeLessThanOrEqual(tone.every);
        expect(note.freq, tone.id).toBeGreaterThan(100);
        expect(note.freq, tone.id).toBeLessThan(11_025);
      }
    }
  });
});

describe("the alarm style", () => {
  it("defaults to today's ring: Chog Classic, normal volume, a slow start, a nine-minute snooze", () => {
    expect(DEFAULT_ALARM_STYLE).toEqual({ tone: "classic", volume: "normal", rise: true, snoozeMin: 9, vibrate: true });
    expect(cleanAlarmStyle(undefined)).toEqual(DEFAULT_ALARM_STYLE);
    expect(cleanAlarmStyle("loud")).toEqual(DEFAULT_ALARM_STYLE);
  });

  it("keeps what was picked and replaces only what isn't one of the choices", () => {
    expect(cleanAlarmStyle({ tone: "arcade", volume: "loud", rise: false, snoozeMin: 5, vibrate: false })).toEqual({
      tone: "arcade",
      volume: "loud",
      rise: false,
      snoozeMin: 5,
      vibrate: false,
    });
    expect(cleanAlarmStyle({ tone: "kazoo", volume: 11, rise: "yes", snoozeMin: 7, vibrate: null })).toEqual(DEFAULT_ALARM_STYLE);
    expect(cleanAlarmStyle({ tone: "gentle" })).toEqual({ ...DEFAULT_ALARM_STYLE, tone: "gentle" });
  });

  it("gives an old save, from before these settings, today's ring", () => {
    const data = new Map<string, string>();
    const old: Record<string, unknown> = { ...defaultSaved(), onboarded: true };
    delete old.alarmStyle;
    data.set(KEY, JSON.stringify(old));
    vi.stubGlobal("window", { localStorage: { getItem: (key: string) => data.get(key) ?? null, setItem: vi.fn(), removeItem: vi.fn() } });
    const state = loadSaved(KEY);
    expect(state.onboarded).toBe(true);
    expect(state.alarmStyle).toEqual(DEFAULT_ALARM_STYLE);
    expect(state.alarm).toEqual(defaultSaved().alarm);
  });

  it("brings a picked style back from a save as it was", () => {
    const data = new Map<string, string>();
    const style = { tone: "old-phone", volume: "soft", rise: false, snoozeMin: 15, vibrate: false };
    data.set(KEY, JSON.stringify({ ...defaultSaved(), alarmStyle: style }));
    vi.stubGlobal("window", { localStorage: { getItem: (key: string) => data.get(key) ?? null, setItem: vi.fn(), removeItem: vi.fn() } });
    expect(loadSaved(KEY).alarmStyle).toEqual(style);
  });

  afterEach(() => vi.unstubAllGlobals());
});

describe("the snooze length", () => {
  const at = new Date(2026, 9, 23, 7, 30);

  it("rings again as many minutes later as Settings says, nine when unset", () => {
    expect(SNOOZE_CHOICES).toEqual([5, 9, 10, 15]);
    expect(snoozeMinutes(undefined)).toBe(9);
    expect(snoozeEnds(at, undefined).getTime() - at.getTime()).toBe(9 * 60_000);
    for (const minutes of SNOOZE_CHOICES) {
      expect(snoozeEnds(at, { snoozeMin: minutes }).getTime() - at.getTime()).toBe(minutes * 60_000);
    }
    // Something that isn't a choice (an edited save) snoozes the usual nine.
    expect(snoozeMinutes({ snoozeMin: 600 })).toBe(9);
  });

  it("says its length on the button and in the fallback line", () => {
    expect(snoozeLabel(snoozeMinutes(undefined))).toBe("Snooze 9 min");
    expect(snoozeLabel(snoozeMinutes({ snoozeMin: 5 }))).toBe("Snooze 5 min");
    expect(plainSnoozeLine()).toBe("Nine more minutes.");
    expect(plainSnoozeLine(5)).toBe("Five more minutes.");
    expect(plainSnoozeLine(15)).toBe("Fifteen more minutes.");
  });

  it("never has the Chog promise nine minutes on a shorter or longer snooze", () => {
    for (const archetype of ARCHETYPES) {
      for (const minutes of [5, 10, 15]) {
        for (let turn = 0; turn < 12; turn++) {
          const line = snoozePick(archetype, [], turn, 3, minutes).caption;
          expect(line, `${archetype} ${minutes}`).not.toMatch(/\bnine\b/i);
        }
      }
    }
    // A nine-minute snooze keeps every line it always had.
    const nine = new Set(Array.from({ length: 12 }, (_, turn) => snoozePick("golden", [], turn, 3).caption));
    expect([...nine].some((line) => /\bnine\b/i.test(line))).toBe(true);
  });
});
