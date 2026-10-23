import { describe, expect, it, vi } from "vitest";
import type { LineContext } from "@/lib/types";
import { clipKey, clipUrl, recordable, spokenText } from "@/lib/clips";
import { JOKE_FILES } from "@/lib/jokeFiles";
import { VOICES, ARCHETYPES } from "@/lib/voices";
import { CAST, voicedLines } from "../../scripts/voice-studio.mjs";

// Pretend every voiced line of every Chog is recorded, so the studio voice can be tested without audio.
vi.mock("@/data/voice-clips.json", async () => {
  const { JOKE_FILES: files } = await import("@/lib/jokeFiles");
  const { clipKey: key } = await import("@/lib/clips");
  const { voicedLines: voiced } = await import("../../scripts/voice-studio.mjs");
  return { default: Object.fromEntries(Object.entries(files).map(([archetype, bank]) => [archetype, voiced(bank).map((text: string) => key(archetype, text))])) };
});

const { clipForCaption, composeLine, snoozePick } = await import("@/lib/writer");

function ctx(over: Partial<LineContext> = {}): LineContext {
  return {
    name: "Sam",
    artId: 375,
    archetype: "told-you-so",
    traits: [],
    intent: "morning",
    phase: "morning",
    weekday: "Monday",
    clock: "7:30 am",
    spokenClock: "half past seven",
    weather: { kind: "clear", tempC: 12, phrase: "clear and 12 degrees", place: "here" },
    nextEvent: { title: "Standup", when: "half past nine", minutesUntil: 120 },
    pastEvent: null,
    memory: [],
    facts: [],
    streak: 0,
    nonce: 0,
    recentIds: [],
    ...over,
  };
}

describe("studio clips", () => {
  it("records a line only when it has no slot but {Name}, and says it without the name", () => {
    expect(recordable("{Name}gm. The bins are not a governance vote.")).toBe(true);
    expect(recordable("{event} at {when}. Bring snacks.")).toBe(false);
    expect(recordable("Mind the {hat}.")).toBe(false);
    expect(spokenText("{Name}gm.  Up only.")).toBe("gm. Up only.");
  });

  it("keys a clip by its Chog and its words, so a changed line gets a new clip", () => {
    const a = clipKey("legend", "In my day, we minted on dial-up.");
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(clipKey("legend", "In my day, we minted on dial-up.")).toBe(a);
    expect(clipKey("legend", "{Name}In my day, we minted on dial-up.")).toBe(a);
    expect(clipKey("golden", "In my day, we minted on dial-up.")).not.toBe(a);
    expect(clipKey("legend", "In my day, we minted on dial up.")).not.toBe(a);
    expect(clipUrl("legend", a)).toBe(`/voice/legend/${a}.mp3`);
  });

  it("gives every Chog plenty to say in the studio voice, and no two lines one clip", () => {
    for (const archetype of ARCHETYPES) {
      const bank = JOKE_FILES[archetype];
      expect(bank, archetype).toBeTruthy();
      const lines = voicedLines(bank);
      expect(lines.length, archetype).toBeGreaterThan(120);
      expect(new Set(lines.map((text: string) => clipKey(archetype, text))).size, archetype).toBe(lines.length);
    }
  });

  it("records with the same cast the live voice uses", () => {
    for (const archetype of ARCHETYPES) expect(CAST[archetype as keyof typeof CAST].id, archetype).toBe(VOICES[archetype].id);
  });
});

describe("the studio voice", () => {
  it("says a recorded line for every kind of moment, and the caption is exactly what the clip says", () => {
    const moments: Array<Partial<LineContext>> = [
      { intent: "morning" },
      { intent: "morning", nextEvent: null },
      { intent: "greeting", phase: "night", nextEvent: null },
      { intent: "reminder", nextEvent: { title: "Dentist", when: "two", minutesUntil: 10 } },
      { intent: "voicemail" },
      { intent: "absence" },
      { intent: "poke", zone: "hat" },
      { intent: "poke", zone: "face" },
      { intent: "poke", zone: "collar" },
      { intent: "idle", weather: { kind: "rain", tempC: 9, phrase: "rain", place: "here" } },
    ];
    for (const archetype of ARCHETYPES) {
      for (const [i, moment] of moments.entries()) {
        const line = composeLine(ctx({ archetype, nonce: i, ...moment, studio: true }));
        expect(line.clip, `${archetype} ${JSON.stringify(moment)}`).toMatch(new RegExp(`^/voice/${archetype}/[0-9a-f]{16}\\.mp3$`));
        // Recorded without the user's name, and never with a slot left in.
        expect(line.caption).not.toMatch(/\bSam\b|[{}]/);
      }
    }
  });

  it("says the event's name only in the live voice", () => {
    const live = Array.from({ length: 12 }, (_, nonce) => composeLine(ctx({ nonce, studio: false })));
    expect(live.some((line) => line.caption.includes("Standup"))).toBe(true);
    for (const line of live) expect(line.clip).toBeUndefined();
  });

  it("gives a snooze its recorded take", () => {
    for (const archetype of ARCHETYPES) expect(snoozePick(archetype).clip, archetype).toMatch(/\.mp3$/);
  });
});

describe("a shared line", () => {
  it("finds its recording from the caption alone, so the share page can ring with it", () => {
    for (const archetype of ARCHETYPES) {
      const line = composeLine(ctx({ archetype, intent: "poke", zone: "face", studio: true }));
      expect(line.clip, archetype).toBeTruthy();
      expect(clipForCaption(archetype, line.caption), archetype).toBe(line.clip);
      // Case and punctuation don't matter; other words, or another Chog, do.
      expect(clipForCaption(archetype, line.caption.toUpperCase().replace(/[.!?]+$/, ""))).toBe(line.clip);
      expect(clipForCaption(archetype, `${line.caption} Extra words.`)).toBeUndefined();
    }
    expect(clipForCaption("legend", "A line nobody recorded.")).toBeUndefined();
  });
});
