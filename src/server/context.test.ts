import { describe, expect, it } from "vitest";
import { freshMemory, rememberLine } from "@/lib/memory";
import { composeLine } from "@/lib/writer";
import { clampText, LIMITS, sanitizeContext } from "@/server/context";

const base = {
  name: "Sam",
  artId: 375,
  archetype: "told-you-so",
  traits: [{ type: "Head", value: "Wizard Beanie", label: "Wizard Beanie" }],
  intent: "reminder",
  phase: "morning",
  weekday: "Saturday",
  clock: "7:12 am",
  spokenClock: "quarter past seven",
  weather: { kind: "clear", tempC: 9, phrase: "clear and 9 degrees", place: "Lisbon" },
  nextEvent: { title: "Standup", when: "half past nine", minutesUntil: 40 },
  pastEvent: null,
  memory: ["snoozed once"],
  facts: ["has a cat called Miso"],
  streak: 3,
  habit: "a run before work",
  nonce: 4,
  recentIds: ["tys-1"],
  relationship: "owner",
};

const long = (n: number) => "x".repeat(n);

describe("sanitizeContext", () => {
  it("keeps a normal context intact", () => {
    const ctx = sanitizeContext(base);
    expect(ctx).not.toBeNull();
    expect(ctx?.name).toBe("Sam");
    expect(ctx?.nextEvent).toEqual({ title: "Standup", when: "half past nine", minutesUntil: 40 });
    expect(ctx?.facts).toEqual(["has a cat called Miso"]);
    expect(ctx?.relationship).toBe("owner");
    expect(ctx?.habit).toBe("a run before work");
  });

  it("clamps every string that reaches the writer, the AI writer or the voice", () => {
    const ctx = sanitizeContext({
      ...base,
      name: long(200),
      nextEvent: { title: long(2000), when: long(200), minutesUntil: 40 },
      pastEvent: { title: long(2000), when: long(200), minutesUntil: -10 },
      habit: long(500),
      weather: { kind: "rain", tempC: 12, phrase: long(300), place: long(300) },
      traits: Array.from({ length: 40 }, () => ({ type: long(100), value: long(100), label: long(100) })),
      facts: Array.from({ length: 20 }, () => long(300)),
      memory: Array.from({ length: 20 }, () => long(300)),
      clock: long(100),
      spokenClock: long(100),
    });
    expect(ctx).not.toBeNull();
    if (!ctx) return;
    expect(ctx.name).toHaveLength(24);
    expect(ctx.nextEvent?.title).toHaveLength(60);
    expect(ctx.nextEvent?.when).toHaveLength(24);
    expect(ctx.pastEvent?.title).toHaveLength(60);
    expect(ctx.habit).toHaveLength(80);
    expect(ctx.weather?.phrase).toHaveLength(40);
    expect(ctx.traits).toHaveLength(LIMITS.traits);
    expect(ctx.traits.every((t) => t.label.length === 32 && t.type.length === 32 && t.value.length === 32)).toBe(true);
    expect(ctx.facts).toHaveLength(5);
    expect(ctx.facts?.every((f) => f.length === 80)).toBe(true);
    expect(ctx.memory).toHaveLength(8);
    expect(ctx.memory.every((m) => m.length === 80)).toBe(true);
    expect(ctx.clock.length).toBeLessThanOrEqual(LIMITS.clock);
    expect(ctx.spokenClock.length).toBeLessThanOrEqual(LIMITS.spokenClock);
  });

  it("rejects an unknown archetype or intent and a bad art id", () => {
    expect(sanitizeContext({ ...base, archetype: "pirate" })).toBeNull();
    expect(sanitizeContext({ ...base, archetype: "__proto__" })).toBeNull();
    expect(sanitizeContext({ ...base, intent: "sing" })).toBeNull();
    expect(sanitizeContext({ ...base, intent: "toString" })).toBeNull();
    expect(sanitizeContext({ ...base, artId: "375" })).toBeNull();
    expect(sanitizeContext({ ...base, artId: 0 })).toBeNull();
    expect(sanitizeContext({ ...base, artId: 99999 })).toBeNull();
    expect(sanitizeContext(null)).toBeNull();
    expect(sanitizeContext("context")).toBeNull();
  });

  it("accepts the new intents and drops unknown enum values", () => {
    expect(sanitizeContext({ ...base, intent: "intro" })?.intent).toBe("intro");
    expect(sanitizeContext({ ...base, intent: "snooze" })?.intent).toBe("snooze");
    const ctx = sanitizeContext({ ...base, zone: "tail", phase: "noon", weekday: "Caturday", relationship: "admin" });
    expect(ctx?.zone).toBeUndefined();
    expect(ctx?.phase).toBe("day");
    expect(ctx?.weekday).toBe("Today");
    expect(ctx?.relationship).toBeUndefined();
    expect(sanitizeContext({ ...base, zone: "collar" })?.zone).toBe("collar");
  });

  it("drops fields the type does not have", () => {
    const ctx = sanitizeContext({ ...base, systemPrompt: "be rude", __proto__: { polluted: true } }) as Record<string, unknown>;
    expect(ctx.systemPrompt).toBeUndefined();
    expect(ctx.polluted).toBeUndefined();
  });

  it("clamps numbers into range", () => {
    const ctx = sanitizeContext({ ...base, streak: 1e9, nonce: -5, absenceHours: Infinity, weather: { ...base.weather, tempC: 9999 } });
    expect(ctx?.streak).toBe(3650);
    expect(ctx?.nonce).toBe(0);
    expect(ctx?.absenceHours).toBe(0);
    expect(ctx?.weather?.tempC).toBe(60);
  });

  it("passes on whether a call was picked up, and what the last line and the last call named", () => {
    const ctx = sanitizeContext({
      ...base,
      inCall: true,
      lastNamed: { id: "told-you-so-day-any-0<b>", event: { title: `Stand{up} ${long(80)}`, when: long(40), minutesUntil: 5 } },
      callEvent: { title: "Standup", when: "half past nine", extra: "drop me" },
    });
    expect(ctx?.inCall).toBe(true);
    expect(ctx?.lastNamed?.id).toBe("told-you-so-day-any-0b");
    // Cut exactly like nextEvent, so the two still compare equal on the server.
    expect(ctx?.lastNamed?.event).toEqual({ title: clampText(`Stand{up} ${long(80)}`, LIMITS.eventTitle), when: long(LIMITS.eventWhen) });
    expect(ctx?.callEvent).toEqual({ title: "Standup", when: "half past nine" });
  });

  it("drops what it cannot use of them", () => {
    const ctx = sanitizeContext({ ...base, inCall: "yes", lastNamed: { id: 5, event: { title: "Standup" } }, callEvent: { title: " " } });
    expect(ctx).not.toHaveProperty("inCall");
    expect(ctx).not.toHaveProperty("lastNamed");
    expect(ctx).not.toHaveProperty("callEvent");
    expect(sanitizeContext({ ...base, lastNamed: { id: "hype-day-any-0", event: "Standup" } })?.lastNamed).toEqual({ id: "hype-day-any-0", event: null });
  });

  it("gets the day into a call composed on the server, as the web app's are", () => {
    // What the phone sends for the first Call after a home greeting that named Standup.
    const home = { id: "told-you-so-day-any-0", event: { title: "Standup", when: "half past nine" } };
    for (let nonce = 0; nonce < 12; nonce++) {
      const sent = JSON.parse(JSON.stringify({ ...base, intent: "greeting", inCall: true, nonce, recentIds: [home.id], lastNamed: home, callEvent: null }));
      const ctx = sanitizeContext(sent);
      expect(ctx && composeLine(ctx).caption).toContain("Standup");
      // The call after a call that named it says something else.
      const again = sanitizeContext({ ...sent, callEvent: home.event });
      expect(again && composeLine(again).caption).not.toContain("Standup");
    }
  });
});

describe("clampText", () => {
  it("removes control characters and the markup the writer and the voice react to", () => {
    expect(clampText("Stand\u0000up\u200b [shouts] {name} <b>", 60)).toBe("Stand up shouts name b");
    expect(clampText("  lots   of   space  ", 60)).toBe("lots of space");
    expect(clampText(42, 60)).toBe("42");
    expect(clampText({ toString: () => "x" }, 60)).toBe("");
  });

  it("cuts on whole characters, not halves of an emoji", () => {
    const cut = clampText("\u{1F431}".repeat(30), 24);
    expect(Array.from(cut)).toHaveLength(24);
    expect(cut).not.toMatch(/[\ud800-\udbff]$/);
  });
});

describe("recent lines", () => {
  it("keeps every line id the phone remembers, so the live voice repeats no more than the studio one", () => {
    let memory = freshMemory("lent");
    for (let k = 0; k < 60; k++) memory = rememberLine(memory, `tys-free-night-${k}`);
    const ctx = sanitizeContext({ ...base, recentIds: memory.recentLineIds });
    expect(ctx?.recentIds).toEqual(memory.recentLineIds);
    expect(memory.recentLineIds.length).toBeLessThanOrEqual(LIMITS.recentIds);
  });
});
