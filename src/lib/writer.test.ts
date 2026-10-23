import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { archetypeFrom, archetypeReason } from "@/lib/archetype";
import { displayTraits, traitCatalog, traitLabel } from "@/lib/traits";
import { headKind } from "@/lib/kinds";
import { JOKE_FILES } from "@/lib/jokeFiles";
import { DEMO_META, profileFromMeta } from "@/lib/chog";
import type { Archetype, DisplayTrait, LineContext, LineIntent, Occurrence, PokeZone, TokenMemory } from "@/lib/types";
import { AUDIO_TAGS, lineIsClean, RING_LINES } from "@/lib/voices";
import { deviceNonce, freshMemory, rememberCall, rememberLine } from "@/lib/memory";
import { formatClock, skyPhase, spokenClock, spokenWhen, WEEKDAYS } from "@/lib/time";
import { seedEvents } from "@/lib/persist";
import { mostRecent, nextStarting, upcoming } from "@/lib/calendar";
import { bankFor, bareWear, callFollowUps, clipForCaption, composeLine, dayReaction, factClause, jokesFor, lineNamesEvent, snoozeLine, snoozePick, SYSTEM_PROMPT } from "@/lib/writer";

const intents: LineIntent[] = ["intro", "greeting", "morning", "reminder", "poke", "voicemail", "idle", "absence", "snooze"];
const archetypes: Archetype[] = ["told-you-so", "hype", "professor", "gremlin", "soap-star", "night-shift", "golden", "roommate", "legend"];
const zones: PokeZone[] = ["hat", "face", "collar"];

/** Web3 slang is welcome; advice, prices and slurs are not. */
const BANNED = /\b(buy the dip|financial advice|price target|jeets?|retard\w*)\b/i;

const TRAITS: Record<string, DisplayTrait[]> = {
  told: displayTraits(DEMO_META[375].attributes),
  hype: displayTraits(DEMO_META[642].attributes),
  prof: displayTraits(DEMO_META[821].attributes),
  hatless: displayTraits(DEMO_META[242].attributes),
  bare: displayTraits([{ trait_type: "Eyes", value: "Happy" }]),
  slogan: displayTraits([
    { trait_type: "Head", value: "WAGMI Cap" },
    { trait_type: "Body", value: "Mon Hoodie" },
  ]),
};

function ctx(over: Partial<LineContext> = {}): LineContext {
  return {
    name: "",
    artId: 375,
    archetype: "told-you-so",
    traits: TRAITS.told,
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

const VARIANTS: Array<Partial<LineContext>> = [
  {},
  { nextEvent: null, pastEvent: { title: "Lunch", when: "half past twelve", minutesUntil: -200 } },
  { nextEvent: { title: "Design review", when: "three", minutesUntil: -10 } },
  { clock: "11:00 pm", spokenClock: "eleven", phase: "night", nextEvent: { title: "Standup", when: "half past nine", minutesUntil: 630 } },
  { traits: TRAITS.hatless, weather: null },
  { traits: TRAITS.bare, name: "Sam" },
  { traits: TRAITS.slogan },
  { facts: ["I hate Mondays"], memory: ["I hate Mondays", "skipped Gym", "showed up for Standup", "snoozed 3 times"], streak: 4, habit: "usually up around seven" },
  { relationship: "owner" },
  { relationship: "stranger", nextEvent: null },
];

function everyLine(fn: (line: { id: string; text: string; caption: string }, c: LineContext) => void) {
  for (const archetype of archetypes) {
    for (const intent of intents) {
      for (const variant of VARIANTS) {
        for (let nonce = 0; nonce < 6; nonce++) {
          const c = ctx({ ...variant, archetype, intent, nonce, zone: intent === "poke" ? zones[nonce % 3] : undefined });
          fn(composeLine(c), c);
        }
      }
    }
  }
}

describe("cast", () => {
  it("derives the demo cast's archetypes from their traits, with no pinned ids", () => {
    expect(archetypeFrom(375, TRAITS.told)).toBe("told-you-so");
    expect(archetypeFrom(642, TRAITS.hype)).toBe("hype");
    expect(archetypeFrom(821, TRAITS.prof)).toBe("professor");
    expect(archetypeFrom(242, TRAITS.hatless)).toBe("gremlin");
    // The id decides nothing: the same traits under any id give the same Chog.
    expect(archetypeFrom(1, TRAITS.told)).toBe("told-you-so");
    expect(archetypeFrom(1969, TRAITS.prof)).toBe("professor");
  });

  it("explains which traits decided the archetype", () => {
    expect(archetypeReason(375, TRAITS.told)).toEqual(["Wizard Beanie", "Base eyes"]);
    expect(archetypeReason(642, TRAITS.hype).slice(0, 2)).toEqual(["Peace Hat", "Happy eyes"]);
    expect(archetypeReason(821, TRAITS.prof)[0]).toBe("Retro Glass");
    expect(archetypeReason(242, TRAITS.hatless)).toEqual(["Smirk eyes", "Toad Green Suit"]);
    for (const traits of Object.values(TRAITS)) {
      const reason = archetypeReason(0, traits);
      expect(reason.length).toBeLessThanOrEqual(3);
    }
  });

  // The full token snapshot lives in the sibling chog-alive project; the test skips without it.
  const snapshot = process.env.CHOG_TOKENS_SNAPSHOT ?? "../chog-alive/src/data/tokens.json";
  it.skipIf(!existsSync(snapshot))("spreads the 1,969 tokens across all nine archetypes", () => {
    const data = JSON.parse(readFileSync(snapshot, "utf8")) as { tokens: Array<{ metaId: number; traits: Record<string, string> }> };
    const counts = Object.fromEntries(archetypes.map((a) => [a, 0])) as Record<Archetype, number>;
    for (const token of data.tokens) {
      const traits = displayTraits(Object.entries(token.traits).map(([trait_type, value]) => ({ trait_type, value })));
      counts[archetypeFrom(token.metaId, traits)] += 1;
      expect(archetypeReason(token.metaId, traits).length).toBeGreaterThan(0);
    }
    expect(data.tokens.length).toBe(1969);
    for (const archetype of archetypes) {
      expect(counts[archetype] / 1969, archetype).toBeGreaterThan(0.05);
      expect(counts[archetype] / 1969, archetype).toBeLessThan(0.17);
    }
  });
});

describe("the bank", () => {
  it("has enough lines in every family for every archetype", () => {
    for (const archetype of archetypes) {
      const bank = bankFor(archetype);
      expect(bank.intro.length, archetype).toBeGreaterThanOrEqual(4);
      expect(bank.free.length, archetype).toBeGreaterThanOrEqual(6);
      expect(bank.day.length, archetype).toBeGreaterThanOrEqual(12);
      for (const zone of zones) expect(bank[zone].length, `${archetype} ${zone}`).toBeGreaterThanOrEqual(4);
      for (const family of ["snooze", "voicemail", "reminder", "absence"] as const) {
        expect(bank[family].length, `${archetype} ${family}`).toBeGreaterThanOrEqual(6);
      }
      expect(bank.owner.length).toBeGreaterThanOrEqual(3);
      expect(bank.stranger.length).toBeGreaterThanOrEqual(3);
      // Voicemail and absence still work on an empty day.
      expect(bank.voicemail.filter((t) => !/\{(event|when|soon)\}/.test(t)).length).toBeGreaterThanOrEqual(3);
      expect(bank.absence.filter((t) => !/\{(event|when|soon)\}/.test(t)).length).toBeGreaterThanOrEqual(3);
    }
  });

  it("gives every line its own id", () => {
    const ids = archetypes.flatMap((a) => jokesFor(a).map((joke) => joke.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps the first meeting free of calendar events", () => {
    for (const archetype of archetypes) {
      for (const text of bankFor(archetype).intro) expect(text).not.toMatch(/\{(event|when|soon|fact|habit)\}/);
      for (let nonce = 0; nonce < 8; nonce++) {
        const line = composeLine(ctx({ archetype, intent: "intro", nonce }));
        expect(line.id).toContain("-intro-");
        expect(line.caption).not.toMatch(/Standup|half past nine/);
      }
    }
  });

  it("drops the broken families the audit named", () => {
    const problems: string[] = [];
    for (const archetype of archetypes) {
      for (const joke of jokesFor(archetype)) {
        const text = joke.text;
        const broken =
          /\bplus\b.*\bplus\b/i.test(text) ||
          /is not a personality/i.test(text) ||
          /\{when\}[.!?]?$/.test(text) ||
          /a seat at \{event\}|You and \{event\}|\{event\} deserve/i.test(text) ||
          (joke.family === "poke" && /torso|ankle|toe bean|belly|feet|foot\b|tummy|paw/i.test(text));
        if (broken) problems.push(`${joke.id}: ${text}`);
      }
    }
    expect(problems).toEqual([]);
  });
});

describe("composeLine", () => {
  it("renders a clean line for every archetype, intent and zone, with no leftover slots", () => {
    const problems: string[] = [];
    let count = 0;
    everyLine((line) => {
      count += 1;
      const c = line.caption;
      const bad =
        c.length <= 8 ||
        c.length >= 220 ||
        /[{}\u0001]/.test(c) ||
        /\[[^\]]+\]/.test(c) ||
        /\s[,.!?]|\s{2}|\.\./.test(c) ||
        /\b[Aa] [AEIOU][a-z]/.test(c) ||
        /[a-z,] (Toad|Green|Suit|Wizard|Beanie|Cap|Hoodie)\b/.test(c) ||
        !lineIsClean(c) ||
        BANNED.test(c) ||
        /\bAlex\b/.test(c) ||
        line.id === "safe" ||
        (c[0] !== c[0].toUpperCase() && !/^g[mn]\b/.test(c));
      if (bad) problems.push(`${line.id}: ${c}`);
    });
    expect(count).toBe(9 * 9 * 10 * 6);
    expect(problems).toEqual([]);
  });

  it("renders every poke zone with physical comedy for the zone tapped", () => {
    for (const archetype of archetypes) {
      for (const zone of zones) {
        const seen = new Set<string>();
        for (let nonce = 0; nonce < 5; nonce++) {
          const line = composeLine(ctx({ archetype, intent: "poke", zone, nonce, recentIds: [...seen] }));
          expect(line.id).toContain(`-poke-${zone}-`);
          seen.add(line.id);
        }
        expect(seen.size).toBe(5);
      }
    }
  });

  it("never uses an event line when there is no event", () => {
    everyLine((line, c) => {
      if (c.nextEvent) return;
      const joke = jokesFor(c.archetype).find((j) => j.id === line.id);
      expect(joke?.needs.event, line.id).toBe(false);
      expect(line.caption).not.toMatch(/\btoday booked|Lunch is|Lunch at/);
    });
  });

  it("treats an event that has started as happening now, never as upcoming", () => {
    everyLine((line, c) => {
      if (!c.nextEvent || c.nextEvent.minutesUntil > 0) return;
      const joke = jokesFor(c.archetype).find((j) => j.id === line.id);
      expect(joke?.needs.upcoming, line.id).toBe(false);
      expect(line.caption).not.toMatch(/at three|in a few minutes|any minute|half an hour|already over/);
    });
    for (const archetype of archetypes) {
      const now = composeLine(ctx({ archetype, intent: "idle", nonce: 0, nextEvent: { title: "Design review", when: "three", minutesUntil: -10 } }));
      expect(now.caption).toMatch(/Design review/);
      const reminder = composeLine(ctx({ archetype, intent: "reminder", nonce: 0, nextEvent: { title: "Design review", when: "three", minutesUntil: -2 } }));
      expect(reminder.caption).not.toMatch(/in a few minutes|already over/);
    }
  });

  it("says tomorrow when the next event is tomorrow", () => {
    for (const archetype of archetypes) {
      for (let nonce = 0; nonce < 12; nonce++) {
        const line = composeLine(
          ctx({ archetype, intent: "greeting", nonce, clock: "11:00 pm", spokenClock: "eleven", phase: "night", nextEvent: { title: "Standup", when: "half past nine", minutesUntil: 630 } }),
        );
        if (/half past nine/.test(line.caption)) expect(line.caption).toMatch(/tomorrow/i);
        expect(line.caption).not.toMatch(/Good morning/);
        // A line about today ("this Monday", "today's lecture") can't be about tomorrow's event.
        expect(jokesFor(archetype).find((joke) => joke.id === line.id)?.needs.sameDay, line.id).toBe(false);
      }
    }
  });

  it("builds reminders on the triggering event", () => {
    for (const archetype of archetypes) {
      for (let nonce = 0; nonce < 6; nonce++) {
        const line = composeLine(ctx({ archetype, intent: "reminder", nonce, nextEvent: { title: "Dentist", when: "half past four", minutesUntil: 10 } }));
        expect(line.id).toContain("-reminder-");
        expect(line.caption).toMatch(/Dentist/);
        expect(line.caption).not.toMatch(/Standup/);
      }
    }
  });

  it("picks an owner line for a verified owner and a visitor line for a stranger", () => {
    for (const archetype of archetypes) {
      const owner = composeLine(ctx({ archetype, intent: "greeting", relationship: "owner", nonce: 1 }));
      expect(owner.id).toContain("-owner-");
      // The wake-up says whose Chog this is, on a day with nothing in it and on a day with something,
      // where it names the day in the same breath.
      const morning = composeLine(ctx({ archetype, intent: "morning", relationship: "owner", nonce: 0, nextEvent: null }));
      expect(morning.id).toContain("-owner-");
      const booked = composeLine(ctx({ archetype, intent: "morning", relationship: "owner", nonce: 0 }));
      expect(booked.id).toContain("-owner-");
      expect(booked.caption).toContain("Standup");
      const visited = composeLine(ctx({ archetype, intent: "greeting", inCall: true, relationship: "stranger", nonce: 0 }));
      expect(visited.id).toContain("-stranger-");
      expect(visited.caption).toContain("Standup");
      // Right after an owner line, the wake-up still names the day, in someone else's words.
      const next = composeLine(ctx({ archetype, intent: "morning", relationship: "owner", nonce: 3, recentIds: [booked.id] }));
      expect(next.id).not.toContain("-owner-");
      expect(next.caption).toContain("Standup");
      const stranger = composeLine(ctx({ archetype, intent: "greeting", relationship: "stranger", nonce: 2 }));
      expect(stranger.id).toContain("-stranger-");
      const lent = composeLine(ctx({ archetype, intent: "greeting", relationship: "lent", nonce: 1 }));
      expect(lent.id).not.toMatch(/-(owner|stranger)-/);
      // Once an owner line has been said, the rest of the bank comes back.
      const later = composeLine(ctx({ archetype, intent: "greeting", relationship: "owner", nonce: 1, recentIds: [owner.id] }));
      expect(later.id).not.toContain("-owner-");
    }
  });

  it("fills {fact} only from what the user said, and says it back as theirs", () => {
    for (const archetype of archetypes) {
      for (let nonce = 0; nonce < 12; nonce++) {
        const noFacts = composeLine(ctx({ archetype, nonce, memory: ["snoozed once", "usually up around seven"], facts: [] }));
        expect(noFacts.id).not.toContain("-fact-");
      }
      const told = composeLine(ctx({ archetype, intent: "greeting", nonce: 1, facts: ["I hate Mondays"], memory: ["I hate Mondays", "snoozed once"] }));
      expect(told.id).toContain("-fact-");
      expect(told.caption).toMatch(/you hate Mondays/i);
      expect(told.caption).not.toMatch(/\bI hate Mondays/);
    }
    expect(factClause("I hate Mondays")).toBe("you hate Mondays");
    expect(factClause("I'm allergic to mornings.")).toBe("you're allergic to mornings");
    expect(factClause("My cat is called Biscuit")).toBe("your cat is called Biscuit");
    expect(factClause("hates early meetings")).toBe("you hate early meetings");
    expect(factClause("dentist at 3")).toBe('"dentist at 3"');
  });

  it("calls back to what the user did", () => {
    const memory = ["skipped Gym", "showed up for Standup", "snoozed 3 times"];
    for (const archetype of archetypes) {
      const seen = new Set<string>();
      const recent: string[] = [];
      for (let nonce = 1; nonce < 40; nonce += 4) {
        const line = composeLine(ctx({ archetype, intent: "idle", nonce, memory, streak: 5, recentIds: [...recent] }));
        recent.unshift(line.id);
        if (line.id.includes("-recall-")) seen.add(line.caption);
      }
      expect(seen.size).toBeGreaterThanOrEqual(2);
      expect([...seen].join(" ")).toMatch(/Gym|Standup|three times|Five mornings/);
    }
  });

  it("rotates through the bank instead of repeating", () => {
    for (const archetype of archetypes) {
      for (const intent of ["morning", "voicemail", "absence", "reminder", "snooze"] as LineIntent[]) {
        const recent: string[] = [];
        // As many as the moment has lines for (a reminder for a meeting has its own few), six at most.
        const pool = new Set(Array.from({ length: 60 }, (_, nonce) => composeLine(ctx({ archetype, intent, nonce })).id));
        for (let nonce = 0; nonce < Math.min(6, pool.size); nonce++) {
          const line = composeLine(ctx({ archetype, intent, nonce, recentIds: [...recent] }));
          expect(recent, `${archetype} ${intent}`).not.toContain(line.id);
          recent.unshift(line.id);
        }
      }
      // With every poke line said recently, the one said longest ago comes back first (of the lines
      // that fit this Chog's hat).
      const hat = headKind(traitLabel(TRAITS.told, "Head"));
      const all = jokesFor(archetype)
        .filter((joke) => joke.zone === "hat" && (!joke.tag?.trait || joke.tag.trait === hat))
        .map((joke) => joke.id);
      const line = composeLine(ctx({ archetype, intent: "poke", zone: "hat", nonce: 3, recentIds: all }));
      expect(line.id).toBe(all[all.length - 1]);
    }
  });

  it("keeps a wide spread of mornings with and without an event", () => {
    for (const archetype of archetypes) {
      const withEvent = new Set<string>();
      const studioWithEvent = new Set<string>();
      const without = new Set<string>();
      for (let nonce = 0; nonce < 80; nonce++) {
        withEvent.add(composeLine(ctx({ archetype, intent: "morning", nonce })).caption);
        studioWithEvent.add(composeLine(ctx({ archetype, intent: "morning", nonce, studio: true })).caption);
        without.add(composeLine(ctx({ archetype, intent: "greeting", nonce, nextEvent: null })).caption);
      }
      // The live wake-up names the day inside the joke, never in front of it. The live voice writes
      // most of its lines itself, so the bank only needs a few of these.
      expect(withEvent.size, archetype).toBeGreaterThanOrEqual(3);
      // The studio voice has its recordings about the kind of event, so its wake-ups vary more.
      expect(studioWithEvent.size, archetype).toBeGreaterThanOrEqual(5);
      expect(without.size, archetype).toBeGreaterThanOrEqual(6);
    }
  });

  it("uses a name only when one is set", () => {
    for (const archetype of archetypes) {
      for (let nonce = 0; nonce < 40; nonce++) {
        const line = composeLine(ctx({ name: "", archetype, nonce, intent: "morning" }));
        expect(line.caption).not.toMatch(/\bAlex\b|^,/);
      }
      const named = composeLine(ctx({ name: "Sam", archetype, nonce: 0, intent: "morning" }));
      expect(named.caption).not.toMatch(/\bAlex\b/);
    }
  });

  it("names what the Chog wears in words, so every poke can be recorded", () => {
    // A trait slot ({hat}, {body}, {wear}) can't be recorded once for 1,969 Chogs; a poke line is
    // written for a kind of hat or outfit and only runs on a Chog wearing one.
    const slotted = archetypes.flatMap((a) => jokesFor(a)).filter((joke) => /\{(wear|hat|body)\}/.test(joke.text));
    expect(slotted.map((joke) => joke.id)).toEqual([]);
    const crown = displayTraits([{ trait_type: "Head", value: "Gold Crown" }]);
    for (const archetype of archetypes) {
      const line = composeLine(ctx({ archetype, traits: crown, intent: "poke", zone: "hat", nonce: 0 }));
      expect(line.id, archetype).toMatch(/-poke-hat-crown-/);
    }
  });

  it("never says a slur, a religion or a politician from a trait label", () => {
    const heads = Object.keys(traitCatalog().labels.Head ?? {});
    const bodies = Object.keys(traitCatalog().labels.Body ?? {});
    for (let i = 0; i < Math.max(heads.length, bodies.length); i++) {
      const traits = displayTraits([
        { trait_type: "Head", value: heads[i % heads.length] },
        { trait_type: "Body", value: bodies[i % bodies.length] },
      ]);
      for (const zone of zones) {
        for (let nonce = 0; nonce < 5; nonce++) {
          const line = composeLine(ctx({ archetype: archetypes[i % 9], traits, intent: "poke", zone, nonce }));
          expect(line.caption, `${heads[i % heads.length]} / ${bodies[i % bodies.length]}`).not.toMatch(BANNED);
          // Web3 trait words are said ("WAGMI cap"); religion, ethnicity, politics and slurs are not.
          expect(line.caption).not.toMatch(/\b(Jesus|Chinese|NEET|MCGA|MMGA|JEET)\b/i);
          expect(line.id).not.toBe("safe");
        }
      }
    }
  });
});

/** The seeded demo week, read the way ChogApp reads it, on Monday 19 October 2026 at h:m. */
const demoDays = new Map<string, Partial<LineContext>>();

function demoDay(h: number, m: number, over: Partial<LineContext> = {}): LineContext {
  const key = `${h}:${m}`;
  let day = demoDays.get(key);
  if (!day) {
    const at = new Date(2026, 9, 19, h, m);
    const events = seedEvents(at);
    const toLine = (item: Occurrence | null) =>
      item ? { title: item.event.title, when: spokenWhen(item.start), minutesUntil: Math.round((item.start.getTime() - at.getTime()) / 60000) } : null;
    day = {
      phase: skyPhase(at),
      weekday: WEEKDAYS[at.getDay()],
      clock: formatClock(at),
      spokenClock: spokenClock(at),
      nextEvent: toLine(nextStarting(events, at, 2)),
      pastEvent: toLine(mostRecent(events, at)),
    };
    demoDays.set(key, day);
  }
  return ctx({ ...day, ...over });
}

/** Dawn, the morning rush, lunch, the afternoon, the evening, night, and late night. */
const DEMO_TIMES: Array<[number, number]> = [[6, 40], [8, 15], [11, 50], [15, 10], [17, 20], [21, 0], [23, 30]];

/** Lines that say the day has nothing in it. */
const EMPTY_DAY = /empty calendar|nothing booked|no plans|nothing on the calendar|on the calendar today|\ban empty\b|^empty\b|no appointments|nothing in it|is blank|busy being home/i;

describe("the demo day", () => {
  it("never says the day is empty when the calendar has something in it today", () => {
    const problems: string[] = [];
    const days: Array<Partial<LineContext>> = [
      {},
      { nextEvent: { title: "Dentist", when: "half past four", minutesUntil: 20 }, clock: "4:10 pm", spokenClock: "ten past four", phase: "day" },
      { nextEvent: { title: "Design review", when: "three", minutesUntil: -10 }, clock: "3:10 pm", spokenClock: "ten past three", phase: "day" },
      // Nothing left today, but Gym was this evening: the day was not empty either.
      { nextEvent: { title: "Standup", when: "half past nine", minutesUntil: 600 }, pastEvent: { title: "Gym", when: "six", minutesUntil: -330 }, clock: "11:30 pm", spokenClock: "half past eleven", phase: "night" },
      // Three things under way and nothing else today: the next one to start is tomorrow's.
      {
        nextEvent: { title: "Standup", when: "half past nine", minutesUntil: 655 },
        nowEvent: { title: "Offsite", when: "quarter past ten", minutesUntil: -21, minutesLeft: 39 },
        clock: "10:35 pm",
        spokenClock: "twenty-five to eleven",
        phase: "night",
        weekday: "Wednesday",
      },
      // The calendar's day is over and its last block ended at seven: that day was not empty.
      { nextEvent: { title: "Gym", when: "six", minutesUntil: -285, minutesLeft: -225 }, clock: "10:45 pm", spokenClock: "quarter to eleven", phase: "night" },
    ];
    for (const archetype of archetypes) {
      for (const intent of ["greeting", "idle", "morning"] as LineIntent[]) {
        for (const [index, day] of days.entries()) {
          for (const relationship of ["lent", "owner", "stranger"] as const) {
            let memory = freshMemory(relationship);
            for (let nonce = 0; nonce <= 40; nonce++) {
              const line = composeLine(ctx({ ...day, archetype, intent, relationship, nonce, recentIds: memory.recentLineIds }));
              if (EMPTY_DAY.test(line.caption) || line.id.includes("-free-empty-")) problems.push(`${archetype} ${intent} day ${index}: ${line.id}: ${line.caption}`);
              memory = rememberLine(memory, line.id);
            }
          }
        }
      }
      for (const [h, m] of DEMO_TIMES) {
        let memory = freshMemory("lent");
        for (let nonce = 0; nonce <= 40; nonce++) {
          const c = demoDay(h, m, { archetype, intent: "greeting", nonce, recentIds: memory.recentLineIds });
          const line = composeLine(c);
          if (EMPTY_DAY.test(line.caption)) problems.push(`${archetype} demo ${h}:${m}: ${line.id}: ${line.caption}`);
          memory = rememberLine(memory, line.id);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("still says an empty day is empty", () => {
    for (const archetype of archetypes) {
      let memory = freshMemory("lent");
      const said: string[] = [];
      for (let nonce = 0; nonce <= 40; nonce++) {
        const line = composeLine(ctx({ archetype, intent: "greeting", nextEvent: null, pastEvent: null, nonce, recentIds: memory.recentLineIds }));
        // In its own words ("Monday is free") or the usual ones: the calendar's empty-day lines say so.
        said.push(line.id.includes("-free-empty-") ? "an empty day" : line.caption);
        memory = rememberLine(memory, line.id);
      }
      expect(said.some((caption) => EMPTY_DAY.test(caption)), archetype).toBe(true);
    }
  });

  it("gives the next event a rest: at most half of ten lines in a row name it, and never two in a row", () => {
    const problems: string[] = [];
    for (const archetype of archetypes) {
      for (const relationship of ["lent", "owner", "stranger"] as const) {
        for (const [h, m] of DEMO_TIMES) {
          for (let start = 0; start < 4; start++) {
            for (const pokes of [false, true]) {
              let memory = { ...freshMemory(relationship), lineCount: start * 7 };
              const named: boolean[] = [];
              for (let k = 0; k < 10; k++) {
                if (pokes && k % 3 === 2) {
                  const poke = composeLine(demoDay(h, m, { archetype, relationship, intent: "poke", zone: zones[k % 3], nonce: memory.lineCount, recentIds: memory.recentLineIds }));
                  memory = rememberLine(memory, poke.id);
                }
                const c = demoDay(h, m, { archetype, relationship, intent: "greeting", nonce: memory.lineCount, recentIds: memory.recentLineIds });
                const line = composeLine(c);
                named.push(Boolean(c.nextEvent && line.caption.includes(c.nextEvent.title)));
                memory = rememberLine(memory, line.id);
              }
              const count = named.filter(Boolean).length;
              const twice = named.some((said, k) => said && named[k + 1]);
              if (count > 5 || twice) problems.push(`${archetype} ${relationship} ${h}:${m} start ${start}${pokes ? " with pokes" : ""}: ${count}/10${twice ? ", twice in a row" : ""}`);
            }
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("fills the rest with the hour, the sky, the outfit or what it remembers, without repeating itself", () => {
    // Day one has fewer true lines (nothing "as yesterday" yet), so it gets one repeat more.
    for (const [known, least] of [[{ streak: 3 }, 7], [{}, 6]] as const) {
      for (const archetype of archetypes) {
        for (const [h, m] of DEMO_TIMES) {
          let memory = freshMemory("lent");
          const captions: string[] = [];
          let specific = 0;
          for (let k = 0; k < 10; k++) {
            const c = demoDay(h, m, { ...known, archetype, intent: "greeting", nonce: memory.lineCount, recentIds: memory.recentLineIds });
            const line = composeLine(c);
            const joke = jokesFor(archetype).find((j) => j.id === line.id);
            // Written for this hour, weekday or weather (joke files tag them), or naming one of those.
            const tagged = Boolean(joke?.tag?.phase || joke?.tag?.weekday || joke?.tag?.weather);
            const timely = tagged || joke?.needs.am || joke?.needs.pm || /\{(clock|sky|wear|day|streak|habit|fact|skipped|attended|snoozes)\}/.test(joke?.text ?? "");
            if (joke && !joke.needs.event && timely) specific++;
            captions.push(line.caption);
            memory = rememberLine(memory, line.id);
          }
          expect(new Set(captions).size, `${archetype} ${h}:${m}`).toBeGreaterThanOrEqual(least);
          expect(specific, `${archetype} ${h}:${m}`).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });

  it("says who they are to the Chog, and what they told it, without harping on either", () => {
    const problems: string[] = [];
    for (const archetype of archetypes) {
      for (const relationship of ["owner", "stranger", "lent"] as const) {
        for (const [h, m] of DEMO_TIMES) {
          let memory = freshMemory(relationship);
          const families: string[] = [];
          for (let k = 0; k < 10; k++) {
            const c = demoDay(h, m, { archetype, relationship, facts: ["I hate Mondays"], intent: "greeting", nonce: memory.lineCount, recentIds: memory.recentLineIds });
            const line = composeLine(c);
            families.push(jokesFor(archetype).find((j) => j.id === line.id)?.family ?? "safe");
            memory = rememberLine(memory, line.id);
          }
          const who = families.filter((family) => family === "owner" || family === "stranger").length;
          const told = families.filter((family) => family === "fact").length;
          if (who > 2 || told > 1) problems.push(`${archetype} ${relationship} ${h}:${m}: ${families.join(" ")}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("keeps morning words in the morning and evening words in the evening", () => {
    // Any line with morning words in it knows it is a morning line.
    for (const joke of archetypes.flatMap((a) => jokesFor(a))) {
      if (/before coffee|before breakfast|since dawn|barely started|this morning/i.test(joke.text)) expect(joke.needs.am, joke.id).toBe(true);
    }
    const problems: string[] = [];
    const night = { clock: "9:00 pm", spokenClock: "nine", phase: "night" as const, nextEvent: { title: "Book club", when: "half past nine", minutesUntil: 30 } };
    const early = { clock: "7:00 am", spokenClock: "seven", phase: "dawn" as const };
    // A quarter past five is evening, not late: Gym is still to come.
    const dusk = { clock: "5:20 pm", spokenClock: "quarter past five", phase: "dusk" as const, nextEvent: { title: "Gym", when: "six", minutesUntil: 40 } };
    const late = /\btonight\b|this evening|this late|bedtime|late now|still up/i;
    for (const archetype of archetypes) {
      for (const intent of ["greeting", "idle"] as LineIntent[]) {
        for (const [when, over, wrong] of [
          ["night", night, /before coffee|before breakfast|since dawn|barely started|this morning|good morning/i],
          ["dawn", early, late],
          ["dusk", dusk, late],
        ] as const) {
          let memory = freshMemory("lent");
          for (let nonce = 0; nonce < 40; nonce++) {
            const line = composeLine(ctx({ ...over, archetype, intent, nonce, recentIds: memory.recentLineIds }));
            if (wrong.test(line.caption)) problems.push(`${archetype} ${intent} ${when}: ${line.id}: ${line.caption}`);
            memory = rememberLine(memory, line.id);
          }
        }
      }
      // "Ring me in 30 s" at nine at night is a wake-up, but nothing in it may say they slept, the
      // sun is rising, or the day is all still ahead: with Book club soon, with tomorrow's Standup, or with nothing booked.
      for (const over of [night, { ...night, nextEvent: { title: "Standup", when: "half past nine", minutesUntil: 750 } }, { ...night, nextEvent: null }]) {
        let memory = freshMemory("lent");
        for (let nonce = 0; nonce < 24; nonce++) {
          const c = ctx({ ...over, archetype, intent: "morning", inCall: true, nonce, recentIds: memory.recentLineIds });
          const line = composeLine(c);
          const wakeWords = /good morning|rise and shine|the sun rises|a whole new day|\basleep\b|all day|before coffee|before breakfast|since dawn|barely started|this morning/i;
          if (wakeWords.test(line.caption) || (line.id.includes("-wake-") && /\bmorning\b/i.test(line.caption))) {
            problems.push(`${archetype} night wake-up (${c.nextEvent?.title ?? "no event"}): ${line.id}: ${line.caption}`);
          }
          memory = rememberLine(memory, line.id);
        }
      }
      // A test ring at night with nothing booked still has wake-ups to choose from.
      const nightWakes = jokesFor(archetype).filter((joke) => joke.family === "wake" && !joke.needs.am && !joke.needs.event);
      expect(nightWakes.length, archetype).toBeGreaterThanOrEqual(3);
      // Nobody hurries to an event tomorrow, and "get up" is for the morning.
      const tomorrow = { clock: "11:30 pm", spokenClock: "half past eleven", phase: "night" as const, nextEvent: { title: "Standup", when: "half past nine", minutesUntil: 600 } };
      const afternoon = { clock: "3:10 pm", spokenClock: "ten past three", phase: "day" as const, nextEvent: { title: "Dentist", when: "half past four", minutesUntil: 80 } };
      for (const intent of ["greeting", "idle", "morning", "voicemail", "reminder", "absence"] as LineIntent[]) {
        for (const [over, wrong] of [
          [tomorrow, /\bhurry\b|\. Go\.$/i],
          [afternoon, /\bget up\b|\bgetting up\b/i],
        ] as const) {
          if (intent === "morning" && over === afternoon) continue;
          let memory = freshMemory("lent");
          for (let nonce = 0; nonce < 24; nonce++) {
            const line = composeLine(ctx({ ...over, archetype, intent, nonce, recentIds: memory.recentLineIds }));
            if (wrong.test(line.caption)) problems.push(`${archetype} ${intent} ${over.clock}: ${line.id}: ${line.caption}`);
            memory = rememberLine(memory, line.id);
          }
        }
      }
      // At seven in the morning nobody has been gloating all day.
      for (let nonce = 0; nonce < 14; nonce++) {
        const line = composeLine(ctx({ ...early, archetype, intent: "absence", nonce }));
        if (/all day/i.test(line.caption)) problems.push(`${archetype} absence at seven: ${line.id}: ${line.caption}`);
      }
    }
    // The ring line plays at any hour.
    for (const archetype of archetypes) {
      for (const line of [...RING_LINES[archetype], ...(JOKE_FILES[archetype]?.ring ?? [])]) {
        if (/still up|tonight|this late|bedtime|morning|\bg[mn]\b/i.test(line)) problems.push(`${archetype} ring: ${line}`);
      }
    }
    expect(problems).toEqual([]);
  });
});

/** A line remembered the way ChogApp's say() remembers it: with what it said about the day. */
function rememberSaid(memory: TokenMemory, c: LineContext, line: { id: string; caption: string; names?: boolean }): TokenMemory {
  if (c.intent === "poke") return rememberLine(memory, line.id);
  const names = line.names ?? lineNamesEvent(line.id);
  return rememberLine(memory, line.id, { caption: line.caption, event: c.nextEvent, call: Boolean(c.inCall), names }, new Date(2026, 9, 19, 8));
}

/** What contextFor reads back out of memory (today's call, on the demo day). */
const recalled = (memory: TokenMemory): Partial<LineContext> => ({
  nonce: memory.lineCount,
  recentIds: memory.recentLineIds,
  lastNamed: memory.named ?? null,
  callEvent: memory.callNamed?.event ?? null,
});

const namesNext = (c: LineContext, caption: string) => Boolean(c.nextEvent && caption.includes(c.nextEvent.title));

const POTTERY = { title: "Pottery class", when: "ten to six", minutesUntil: 40 };

describe("the day, by name", () => {
  it("names the next event in every wake-up, even right after the home screen named it", () => {
    const problems: string[] = [];
    let homeNamed = 0;
    for (const archetype of archetypes) {
      for (const relationship of ["lent", "owner", "stranger"] as const) {
        for (const [h, m] of DEMO_TIMES) {
          for (let start = 0; start < 4; start++) {
            let memory = { ...freshMemory(relationship), lineCount: start * 7 };
            for (let k = 0; k < 4; k++) {
              // The home greeting, remembered by id alone the way greet() does, then "Ring me in 30 s".
              const home = demoDay(h, m, { archetype, relationship, intent: "greeting", ...recalled(memory) });
              const greeting = composeLine(home);
              if (namesNext(home, greeting.caption)) homeNamed++;
              memory = rememberLine(memory, greeting.id);
              const c = demoDay(h, m, { archetype, relationship, intent: "morning", inCall: true, ...recalled(memory) });
              const line = composeLine(c);
              if (c.nextEvent && !namesNext(c, line.caption)) problems.push(`${archetype} ${relationship} ${h}:${m} #${k}: ${line.id}: ${line.caption}`);
              memory = rememberSaid(memory, c, line);
            }
          }
        }
      }
    }
    expect(problems).toEqual([]);
    // Plenty of these wake-ups came right after a home line that named the event (lines no longer
    // open with "Lunch soon.", so fewer home lines say a title by chance).
    expect(homeNamed).toBeGreaterThan(120);
  });

  it("names the next event when a call is picked up, even right after the home greeting named it", () => {
    const problems: string[] = [];
    let homeNamed = 0;
    for (const archetype of archetypes) {
      for (const relationship of ["lent", "owner", "stranger"] as const) {
        for (const [h, m] of DEMO_TIMES) {
          for (let start = 0; start < 8; start++) {
            let memory = { ...freshMemory(relationship), lineCount: start * 5 };
            for (let k = 0; k < 1 + (start % 3); k++) {
              const home = demoDay(h, m, { archetype, relationship, intent: "greeting", ...recalled(memory) });
              const greeting = composeLine(home);
              if (k === start % 3 && namesNext(home, greeting.caption)) homeNamed++;
              memory = rememberLine(memory, greeting.id);
            }
            const c = demoDay(h, m, { archetype, relationship, intent: "greeting", inCall: true, ...recalled(memory) });
            const line = composeLine(c);
            if (!namesNext(c, line.caption)) problems.push(`${archetype} ${relationship} ${h}:${m} start ${start}: ${line.id}: ${line.caption}`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
    // Plenty of those calls came straight after a home greeting that had just named the same event.
    expect(homeNamed).toBeGreaterThan(150);
  });

  it("names a newly added or edited event on the next call, then varies, then names it again", () => {
    const problems: string[] = [];
    for (const archetype of archetypes) {
      for (const relationship of ["lent", "owner", "stranger"] as const) {
        for (const [h, m] of DEMO_TIMES) {
          for (let start = 0; start < 4; start++) {
            let memory = { ...freshMemory(relationship), lineCount: start * 7 };
            // A call about the demo day's next event...
            const first = demoDay(h, m, { archetype, relationship, intent: "greeting", inCall: true, ...recalled(memory) });
            const firstLine = composeLine(first);
            memory = rememberSaid(memory, first, firstLine);
            // ...then the judge adds Pottery class, now the next thing, and calls three times.
            const said: boolean[] = [];
            for (let k = 0; k < 3; k++) {
              const c = demoDay(h, m, { archetype, relationship, intent: "greeting", inCall: true, nextEvent: POTTERY, ...recalled(memory) });
              const line = composeLine(c);
              said.push(namesNext(c, line.caption));
              memory = rememberSaid(memory, c, line);
            }
            if (said.join() !== "true,false,true") problems.push(`${archetype} ${relationship} ${h}:${m} start ${start}: ${said.join()}`);
            // Moving the class to another time is a new event to the Chog: the next call names it.
            const moved = demoDay(h, m, { archetype, relationship, intent: "greeting", inCall: true, nextEvent: { ...POTTERY, when: "half past six", minutesUntil: 70 }, ...recalled(memory) });
            if (!namesNext(moved, composeLine(moved).caption)) problems.push(`${archetype} ${relationship} ${h}:${m} start ${start}: moved, not named`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("never lets a caption on the home screen silence a call, or a call silence the wake-up", () => {
    for (const archetype of archetypes) {
      for (let nonce = 0; nonce < 12; nonce++) {
        const day = { archetype, nonce, recentIds: [`${archetype}-day-any-0`], lastNamed: { id: `${archetype}-day-any-0`, event: { title: "Standup", when: "half past nine" } } };
        expect(composeLine(ctx({ ...day, intent: "greeting", inCall: true })).caption, archetype).toContain("Standup");
        // The call before named Standup: the next call varies, the wake-up still names it.
        const after = { ...day, callEvent: { title: "Standup", when: "half past nine" } };
        expect(composeLine(ctx({ ...after, intent: "greeting", inCall: true })).caption, archetype).not.toContain("Standup");
        expect(composeLine(ctx({ ...after, intent: "morning", inCall: true })).caption, archetype).toContain("Standup");
      }
    }
  });

  it("rests an event on the home screen only when the last line named that same event", () => {
    for (const archetype of archetypes) {
      const id = `${archetype}-day-any-0`;
      let pottery = 0;
      for (let nonce = 0; nonce < 20; nonce++) {
        const home = { archetype, intent: "greeting" as const, nonce, recentIds: [id] };
        // The last line named Standup, and Standup is next: a rest.
        const rested = composeLine(ctx({ ...home, lastNamed: { id, event: { title: "Standup", when: "half past nine" } } }));
        expect(rested.caption, archetype).not.toContain("Standup");
        // Pottery class was just added, or Standup moved: the line is picked as if nothing had been named.
        const fresh = composeLine(ctx({ ...home, nextEvent: POTTERY, lastNamed: { id, event: null } }));
        // About it: by name, or a joke written for its kind of event.
        const about = jokesFor(archetype).find((joke) => joke.id === fresh.id);
        if (fresh.caption.includes("Pottery class") || about?.tag?.event) pottery++;
        expect(composeLine(ctx({ ...home, nextEvent: POTTERY, lastNamed: { id, event: { title: "Standup", when: "half past nine" } } })).id).toBe(fresh.id);
        const moved = { title: "Standup", when: "ten", minutesUntil: 150 };
        expect(composeLine(ctx({ ...home, nextEvent: moved, lastNamed: { id, event: { title: "Standup", when: "half past nine" } } })).id).toBe(
          composeLine(ctx({ ...home, nextEvent: moved, lastNamed: { id, event: null } })).id,
        );
      }
      // The new event is not given a rest it never had: plenty of those lines are about it.
      expect(pottery, archetype).toBeGreaterThanOrEqual(5);
    }
  });

  it("still rests the event on the home screen, rolled the way say() rolls it", () => {
    const problems: string[] = [];
    for (const archetype of archetypes) {
      for (const relationship of ["lent", "owner", "stranger"] as const) {
        for (const [h, m] of DEMO_TIMES) {
          for (let start = 0; start < 4; start++) {
            let memory = { ...freshMemory(relationship), lineCount: start * 7 };
            const named: boolean[] = [];
            // Eight lines at one moment: every line in the joke files is written for a moment, so
            // after that the fresh lines that skip the event run out, and a new joke about the event
            // beats saying an old line again word for word.
            for (let k = 0; k < 8; k++) {
              const c = demoDay(h, m, { archetype, relationship, intent: k % 2 ? "idle" : "greeting", ...recalled(memory) });
              const line = composeLine(c);
              named.push(namesNext(c, line.caption));
              memory = rememberSaid(memory, c, line);
            }
            const count = named.filter(Boolean).length;
            if (count > 5 || named.some((said, k) => said && named[k + 1])) problems.push(`${archetype} ${relationship} ${h}:${m} start ${start}: ${named.join()}`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

describe("rewritten lines", () => {
  it("keep the ids they replaced, and stay inside the fiction", () => {
    const all = archetypes.flatMap((a) => jokesFor(a));
    const text = (id: string) => all.find((joke) => joke.id === id)?.text;
    // Lines rewritten in the older bank keep their ids (Chogs with a joke file have new ones).
    if (!JOKE_FILES.hype) expect(text("hype-poke-collar-4")).toMatch(/^That's the \{body\}! First fan contact!/);
    if (!JOKE_FILES.legend) expect(text("legend-poke-face-0")).toMatch(/^Kings have looked at this face/);
    expect(all.filter((joke) => /\bthe app\b|furniture is losing it/i.test(joke.text)).map((joke) => joke.id)).toEqual([]);
    // At most one "Rise and shine" per Chog, and a first poke never says "Again?".
    for (const archetype of archetypes) expect(jokesFor(archetype).filter((joke) => /rise and shine/i.test(joke.text)).length, archetype).toBeLessThanOrEqual(1);
    expect(all.filter((joke) => joke.family === "poke" && /^again\b/i.test(joke.text)).map((joke) => joke.id)).toEqual([]);
  });
});

describe("snoozeLine", () => {
  it("works through a bank without repeating", () => {
    for (const archetype of archetypes) {
      const size = Math.min(7, jokesFor(archetype).filter((joke) => joke.family === "snooze").length);
      const lines = Array.from({ length: size }, () => snoozeLine(archetype));
      expect(new Set(lines).size).toBe(size);
      for (const line of lines) {
        expect(line).not.toMatch(/[{}]/);
        expect(lineIsClean(line)).toBe(true);
      }
    }
  });

  it("skips lines the Chog said recently", () => {
    const ids = jokesFor("roommate").filter((joke) => joke.family === "snooze").map((joke) => joke.id);
    const last = ids.length - 1;
    const text = snoozeLine("roommate", ids.slice(0, last), 0);
    expect(text).toBe(jokesFor("roommate").find((joke) => joke.id === ids[last])?.say(ctx({ archetype: "roommate" })));
  });
});

describe("snoozePick", () => {
  it("rotates through the bank when each snooze is remembered, the way the app does it", () => {
    for (const archetype of archetypes) {
      let memory = freshMemory("lent");
      const seen: string[] = [];
      const size = Math.min(7, jokesFor(archetype).filter((joke) => joke.family === "snooze").length);
      for (let press = 0; press < size; press++) {
        const picked = snoozePick(archetype, memory.recentLineIds);
        expect(picked.id).toMatch(new RegExp(`^${archetype}-snooze-`));
        expect(lineIsClean(picked.caption)).toBe(true);
        seen.push(picked.caption);
        memory = rememberLine(memory, picked.id);
      }
      expect(new Set(seen).size).toBe(size);
    }
  });

  it("brings back the line said longest ago once every line was said", () => {
    const ids = jokesFor("legend").filter((joke) => joke.family === "snooze").map((joke) => joke.id);
    // Newest first, as rememberLine keeps them: the last id is the oldest.
    const recent = [...ids].reverse();
    expect(snoozePick("legend", recent).id).toBe(ids[0]);
  });

  it("counts snoozes only as far as there have been some: no 'again' on the first, no 'trilogy' before the third", () => {
    for (const archetype of archetypes) {
      for (const [snoozes, wrong] of [
        [1, /\bagain\b(?! and)|\btrilogy\b|\bwhat you said in\b/i],
        [2, /\btrilogy\b/i],
      ] as const) {
        let memory = freshMemory("lent");
        for (let press = 0; press < 8; press++) {
          const picked = snoozePick(archetype, memory.recentLineIds, press, snoozes);
          expect(picked.caption, `${archetype}, snooze ${snoozes}`).not.toMatch(wrong);
          memory = rememberLine(memory, picked.id);
        }
      }
    }
    // By the third, the trilogy is true.
    const told = Array.from({ length: 6 }, (_, press) => snoozePick("told-you-so", [], press, 3).caption);
    expect(told.some((caption) => /trilogy/.test(caption))).toBe(true);
  });
});

describe("{wear} with nothing to wear", () => {
  const bad = /\{|\}| {2}|\b(the|a|an|my) [.,!?]|\b(the|a|an) my\b|\bthe this face\b|\b(the|a|an)$|\bin the who\b/i;

  it("reads naturally in every line, even one filled outside the picker", () => {
    for (const archetype of archetypes) {
      for (const joke of jokesFor(archetype).filter((item) => item.text.includes("{wear}"))) {
        for (const traits of [[], TRAITS.bare]) {
          const line = joke.say(ctx({ archetype, traits, facts: ["I hate Mondays"], habit: "up early", streak: 3, memory: ["skipped Gym", "showed up for Standup", "snoozed 3 times"] }));
          expect(line, joke.id).not.toMatch(bad);
          expect(line, joke.id).not.toMatch(/\bThe this\b/);
        }
      }
    }
  });

  it("is never picked for a Chog without a trait to point at", () => {
    for (const archetype of archetypes) {
      for (const intent of intents) {
        for (let nonce = 0; nonce < 12; nonce++) {
          const c = ctx({ archetype, traits: [], intent, nonce, zone: intent === "poke" ? zones[nonce % 3] : undefined });
          const line = composeLine(c);
          expect(line.caption, line.id).not.toMatch(bad);
          expect(jokesFor(archetype).find((joke) => joke.id === line.id)?.text ?? "", line.id).not.toContain("{wear}");
          expect(dayReaction(c)).not.toMatch(bad);
        }
      }
    }
  });

  it("swaps each phrase for one that fits", () => {
    expect(bareWear("I'm the one in the {wear} who called.")).toBe("I'm the one with the opinions who called.");
    expect(bareWear("The {wear} voted. You trip over the {wear}.")).toBe("My face voted. You trip over my face.");
    expect(bareWear("Some of us do it in a {wear}.")).toBe("Some of us do it in style.");
    expect(bareWear("Less apology. More {wear}.")).toBe("Less apology. More me.");
  });
});

describe("SYSTEM_PROMPT", () => {
  it("offers every audio tag the voice understands", () => {
    for (const tag of AUDIO_TAGS) expect(SYSTEM_PROMPT).toContain(tag);
    expect(SYSTEM_PROMPT).toContain("[curious]");
    expect(SYSTEM_PROMPT).not.toMatch(/\$\{/);
  });
});

describe("dayReaction", () => {
  it("says tomorrow for tomorrow's event when measured from now (the Today sheet)", () => {
    // Sunday night, Standup on Monday at half past nine.
    const late = { clock: "8:00 pm", spokenClock: "eight", phase: "night" as const, nextEvent: { title: "Standup", when: "half past nine", minutesUntil: 810 } };
    for (const archetype of archetypes) {
      for (let nonce = 1; nonce < 12; nonce += 2) {
        const line = dayReaction(ctx({ archetype, intent: "idle", nonce, ...late }), { fromNow: true });
        if (/half past nine/.test(line)) expect(line, `${archetype} ${nonce}`).toMatch(/tomorrow/i);
        expect(line).not.toMatch(/\btoday\b|\btonight\b/i);
      }
    }
  });


  it("keeps the calendar aside short and true to the day on screen", () => {
    for (const archetype of archetypes) {
      const upcoming = dayReaction(ctx({ archetype, intent: "idle", nonce: 2 }));
      expect(upcoming.length).toBeLessThan(90);
      // The Today panel lists Standup right under the line, so the line is about a meeting without
      // naming it: the joke is never given away by the title in front.
      expect(upcoming).not.toMatch(/Standup/);
      expect(JOKE_FILES[archetype]?.events.meeting.peek).toContain(upcoming);
      const started = dayReaction(ctx({ archetype, intent: "idle", nonce: 2, nextEvent: { title: "Lunch", when: "half past twelve", minutesUntil: -240 } }));
      expect(started).toMatch(/Lunch/);
      expect(started).not.toMatch(/half past twelve/);
      const empty = dayReaction(ctx({ archetype, intent: "idle", nonce: 2, nextEvent: null }));
      expect(empty).toMatch(/Monday/);
      for (const line of [upcoming, started, empty]) {
        expect(line).not.toMatch(/[{}]|\bAlex\b/);
        expect(lineIsClean(line)).toBe(true);
      }
      const fact = dayReaction(ctx({ archetype, intent: "idle", nonce: 2, facts: ["I hate Mondays"] }));
      expect(fact).toMatch(/you hate Mondays/);
    }
  });
});

describe("time", () => {
  it("rounds spoken times instead of spelling the exact minute", () => {
    expect(spokenClock(new Date(2026, 9, 17, 10, 46))).toBe("quarter to eleven");
    expect(spokenClock(new Date(2026, 9, 17, 9, 30))).toBe("half past nine");
    expect(spokenClock(new Date(2026, 9, 17, 7, 12))).toBe("quarter past seven");
    expect(spokenClock(new Date(2026, 9, 17, 7, 0))).toBe("seven");
    expect(spokenWhen(new Date(2026, 9, 17, 9, 30))).toBe("half past nine");
  });
});

describe("callFollowUps", () => {
  it("turns a studio wake-up into a call of three recorded lines, the next event first", () => {
    for (const archetype of archetypes) {
      const c = ctx({ archetype, studio: true });
      const first = composeLine(c);
      expect(first.clip, archetype).toBeTruthy();
      const parts = callFollowUps(c, first.id);
      expect(parts, archetype).toHaveLength(2);
      expect(new Set([first.id, ...parts.map((part) => part.id)]).size).toBe(3);
      for (const part of parts) {
        expect(part.clip).toMatch(/^\/voice\//);
        expect(lineIsClean(part.caption)).toBe(true);
        expect(part.caption).not.toMatch(/[{}[\]]/);
      }
      // Standup is a meeting two hours out: unless the first line was about it, the next one is.
      if (!first.names) expect(parts[0].names, archetype).toBe(true);
    }
  });

  it("adds nothing outside a call, for the live voice, or for a line with no recording", () => {
    for (const archetype of archetypes) {
      const first = composeLine(ctx({ archetype, studio: true }));
      expect(callFollowUps(ctx({ archetype, studio: true, intent: "idle" }), first.id)).toEqual([]);
      expect(callFollowUps(ctx({ archetype, studio: true, intent: "greeting" }), first.id)).toEqual([]);
      expect(callFollowUps(ctx({ archetype, intent: "morning" }), first.id)).toEqual([]);
      expect(callFollowUps(ctx({ archetype, studio: true }), "no-such-line")).toEqual([]);
    }
  });

  it("keeps a reminder to one more line, and a call picked up to three", () => {
    for (const archetype of archetypes) {
      const soon = ctx({ archetype, studio: true, intent: "reminder", inCall: true, nextEvent: { title: "Standup", when: "half past nine", minutesUntil: 10 } });
      expect(callFollowUps(soon, composeLine(soon).id).length, archetype).toBeLessThanOrEqual(1);
      const picked = ctx({ archetype, studio: true, intent: "greeting", inCall: true });
      expect(callFollowUps(picked, composeLine(picked).id).length, archetype).toBeLessThanOrEqual(2);
    }
  });

  it("leans on a slang word once a call: one whale, not two", () => {
    const whale = jokesFor("roommate").find((joke) => joke.family === "wake" && /whale/i.test(joke.text));
    expect(whale?.clip).toBeTruthy();
    for (let nonce = 0; nonce < 20; nonce++) {
      // Wednesday's roommate line ends on "Whale alert": it waits for another call.
      const c = ctx({ archetype: "roommate", studio: true, inCall: true, weekday: "Wednesday", weather: null, nextEvent: null, nonce });
      const parts = callFollowUps(c, whale!.id);
      expect(parts).toHaveLength(2);
      for (const part of parts) expect(part.caption).not.toMatch(/whale/i);
    }
  });

  it("never repeats a line of the call before", () => {
    for (const archetype of archetypes) {
      const c = ctx({ archetype, studio: true, nextEvent: null });
      const first = composeLine(c);
      const once = callFollowUps(c, first.id);
      const again = callFollowUps({ ...c, recentIds: once.map((part) => part.id) }, first.id);
      for (const part of again) expect(once.map((p) => p.id), archetype).not.toContain(part.id);
    }
  });

  it("keeps ten calls in a row full length, with no line twice in one call", () => {
    const evening = { phase: "night" as const, clock: "9:40 pm", spokenClock: "twenty to ten", weather: null, nextEvent: null };
    const kinds: Array<[string, Partial<LineContext>, number]> = [
      ["greeting", { intent: "greeting" }, 2],
      ["wake-up", { intent: "morning" }, 2],
      ["reminder", { intent: "reminder", nextEvent: { title: "Standup", when: "half past nine", minutesUntil: 10 } }, 1],
      ["reminder on now", { intent: "reminder", nextEvent: { title: "Standup", when: "half past nine", minutesUntil: -2 } }, 1],
      ["greeting, night, no sky", { intent: "greeting", ...evening }, 2],
      ["test wake-up, night, no sky", { intent: "morning", ...evening }, 2],
    ];
    for (const archetype of archetypes) {
      for (const [label, over, follow] of kinds) {
        let memory = freshMemory("lent");
        let lastCall: string[] = [];
        for (let call = 0; call < 10; call++) {
          const c = ctx({ archetype, studio: true, inCall: true, ...over, nonce: memory.lineCount, recentIds: memory.recentLineIds });
          const first = composeLine(c);
          expect(first.clip, `${archetype} ${label} call ${call + 1}`).toBeTruthy();
          const parts = callFollowUps(c, first.id);
          expect(parts, `${archetype} ${label} call ${call + 1}`).toHaveLength(follow);
          const ids = [first.id, ...parts.map((part) => part.id)];
          expect(new Set(ids).size, `${archetype} ${label} call ${call + 1}: ${ids.join(", ")}`).toBe(ids.length);
          // While the moment has lines to spare, the follow-ups never echo the call before.
          if (!label.includes("night")) for (const part of parts) expect(lastCall, `${archetype} ${label} call ${call + 1}`).not.toContain(part.id);
          for (const id of ids) memory = rememberLine(memory, id);
          lastCall = ids;
        }
      }
    }
  });

  it("never greets the pick-up halfway through a wake-up", () => {
    const evening = { phase: "night" as const, clock: "9:40 pm", spokenClock: "twenty to ten", weather: null, nextEvent: null };
    for (const archetype of archetypes) {
      for (const over of [{}, evening]) {
        let memory = freshMemory("lent");
        for (let call = 0; call < 10; call++) {
          const c = ctx({ archetype, studio: true, inCall: true, intent: "morning", ...over, nonce: memory.lineCount, recentIds: memory.recentLineIds });
          const first = composeLine(c);
          const parts = callFollowUps(c, first.id);
          for (const part of parts) expect(part.caption, `${archetype} call ${call + 1}`).not.toMatch(/picked up|answered|^(we are live|finally|it's me|calling from)\b/i);
          for (const id of [first.id, ...parts.map((part) => part.id)]) memory = rememberLine(memory, id);
        }
      }
    }
  });
});

describe("calls in a row", () => {
  /** Calls one after another, remembered the way ChogApp's say() remembers them: each line, and the call whole. */
  function callsInARow(over: Partial<LineContext>, count: number, start = 0): string[][] {
    let memory = { ...freshMemory("lent"), lineCount: start };
    const calls: string[][] = [];
    for (let call = 0; call < count; call++) {
      const c = ctx({ studio: true, inCall: true, ...over, nonce: memory.lineCount, recentIds: memory.recentLineIds, lastCalls: memory.calls ?? [] });
      const first = composeLine(c);
      const ids = [first.id, ...callFollowUps(c, first.id).map((part) => part.id)];
      memory = rememberCall(memory, ids);
      for (const id of ids) memory = rememberLine(memory, id);
      calls.push(ids);
    }
    return calls;
  }

  // The judge's evening: Wednesday at twenty to eleven, clear and one degree, nothing booked.
  const night = { phase: "night" as const, clock: "10:40 pm", spokenClock: "twenty to eleven", weekday: "Wednesday", weather: { kind: "clear" as const, tempC: 1, phrase: "clear and 1 degree", place: "here" }, nextEvent: null };
  const afternoon = { phase: "day" as const, clock: "3:10 pm", spokenClock: "ten past three", nextEvent: { title: "Dentist", when: "half past four", minutesUntil: 80 } };
  const moments: Array<[string, Partial<LineContext>]> = [
    ["a call picked up at night", { intent: "greeting", ...night }],
    ["a test wake-up at night", { intent: "morning", ...night }],
    ["a call picked up at night, no sky", { intent: "greeting", ...night, weather: null }],
    ["the wake-up, Standup ahead", { intent: "morning" }],
    ["a call picked up, the dentist ahead", { intent: "greeting", ...afternoon }],
  ];

  it("never replays a call: twelve in a row each say their lines in an order not heard before", () => {
    const problems: string[] = [];
    for (const archetype of archetypes) {
      for (const [label, over] of moments) {
        // Told You So has three true lines on a night with no sky: six calls is all three can make.
        if (archetype === "told-you-so" && over.weather === null) continue;
        for (const start of [0, 5, 11]) {
          const calls = callsInARow({ archetype, ...over }, 12, start);
          calls.forEach((ids, index) => {
            if (ids.length !== 3 || new Set(ids).size !== 3) problems.push(`${archetype}, ${label}, call ${index + 1}: ${ids.join(", ")}`);
            const earlier = calls.findIndex((other) => other.join(" ") === ids.join(" "));
            if (earlier < index) problems.push(`${archetype}, ${label}, from ${start}: call ${index + 1} replays call ${earlier + 1}: ${ids.join(", ")}`);
          });
        }
      }
    }
    expect(problems).toEqual([]);
  });

  // Fresh profiles on four phones: the device's number goes into the nonce (ChogApp contextFor), the
  // way a later start does here.
  const phones = ["5b0d6f1e-7c4a-4a52-9d0e-3f7a1c2b9e41", "5b0d6f1e-7c4a-4a52-9d0e-3f7a1c2b9e42", "c81f2e07-1b9d-4e6a-8c35-0a4d7e9f2b16", "dev-1761120000000"];

  it("gives fresh profiles on two phones different first calls, and each phone the same one every time", () => {
    for (const archetype of archetypes) {
      for (const [label, over] of moments) {
        const first = (phone: string) => callsInARow({ archetype, ...over }, 1, deviceNonce(phone))[0].join(" ");
        const calls = new Set(phones.map(first));
        expect(calls.size, `${archetype}, ${label}: ${[...calls].join(" / ")}`).toBeGreaterThan(2);
        for (const phone of phones) expect(first(phone)).toBe(first(phone));
      }
    }
  });

  it("never replays a call from a phone's own start either", () => {
    const problems: string[] = [];
    for (const archetype of archetypes) {
      for (const [label, over] of moments) {
        if (archetype === "told-you-so" && over.weather === null) continue;
        for (const phone of phones) {
          const calls = callsInARow({ archetype, ...over }, 12, deviceNonce(phone));
          calls.forEach((ids, index) => {
            if (ids.length !== 3 || new Set(ids).size !== 3) problems.push(`${archetype}, ${label}, ${phone}, call ${index + 1}: ${ids.join(", ")}`);
            const earlier = calls.findIndex((other) => other.join(" ") === ids.join(" "));
            if (earlier < index) problems.push(`${archetype}, ${label}, ${phone}: call ${index + 1} replays call ${earlier + 1}: ${ids.join(", ")}`);
          });
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("varies the opening line too, not only what follows it", () => {
    for (const archetype of archetypes) {
      const openers = new Set(callsInARow({ archetype, intent: "greeting", ...night }, 12).map((ids) => ids[0]));
      expect(openers.size, archetype).toBeGreaterThanOrEqual(4);
    }
  });

  it("with only a few true lines, still never says the call before again", () => {
    for (const archetype of archetypes) {
      const calls = callsInARow({ archetype, intent: "greeting", ...night, weather: null }, 12);
      for (let index = 1; index < calls.length; index++) expect(calls[index].join(" "), `${archetype} call ${index + 1}`).not.toBe(calls[index - 1].join(" "));
    }
  });

  it("keeps a test wake-up at night off bedtime lines", () => {
    for (const archetype of archetypes) {
      let memory = freshMemory("lent");
      for (let call = 0; call < 12; call++) {
        const c = ctx({ archetype, studio: true, inCall: true, intent: "morning", ...night, nonce: memory.lineCount, recentIds: memory.recentLineIds });
        const first = composeLine(c);
        const parts = callFollowUps(c, first.id);
        // A wake-up's own lines may mention the bed ("I sat by your bed all night"); the hour's lines may not send them back to it.
        for (const said of [first, ...parts].filter((line) => line.id.includes("-free-"))) {
          expect(said.caption, `${archetype}: ${said.id}`).not.toMatch(/\bgn\b|\bbed(time)?\b|lights (off|out)|sleep (well|tight)|phone down/i);
        }
        for (const said of [first, ...parts]) memory = rememberLine(memory, said.id);
      }
    }
  });

  it("says the weather on the first wake-up it fits, a line with a bed in it included", () => {
    // Night Shift's one rain line is "I'll be in bed, enjoying the rain on your behalf": not a bedtime line.
    for (const kind of ["rain", "fog", "snow"] as const) {
      for (const archetype of archetypes) {
        const sky = jokesFor(archetype).filter((joke) => joke.family === "free" && joke.tag?.weather === kind && joke.clip);
        if (!sky.length) continue;
        const weather = { kind, tempC: 8, phrase: kind, place: "here" };
        const c = ctx({ archetype, studio: true, inCall: true, intent: "morning", weather, lastCalls: [] });
        const first = composeLine(c);
        const ids = [first.id, ...callFollowUps(c, first.id).map((part) => part.id)];
        expect(ids.some((id) => sky.some((joke) => joke.id === id)), `${archetype}, ${kind}: ${ids.join(", ")}`).toBe(true);
      }
    }
  });
});

describe("true to the day", () => {
  /** Lines that remember a time together, the hour, or the cap's angle, as the audit heard them. */
  const PAST = /as yesterday|yesterday's|last time, (you|kayaks|everyone)|last seen|on file|last night|last week|desk lunch again|lunch at the desk again|not one thank you/i;

  it("claims no past together on day one, and keeps those lines for later", () => {
    const heard = { dayOne: [] as string[], later: 0 };
    for (const archetype of archetypes) {
      for (const [phase, weekday] of [["dawn", "Wednesday"], ["morning", "Saturday"], ["day", "Wednesday"], ["night", "Saturday"]] as const) {
        for (const intent of ["greeting", "morning", "voicemail"] as LineIntent[]) {
          for (const [streak, habit] of [[1, null], [3, "usually up around seven"]] as const) {
            let memory = freshMemory("lent");
            for (let nonce = 0; nonce < 12; nonce++) {
              const c = ctx({ archetype, phase, weekday, intent, streak, habit, studio: true, inCall: true, nextEvent: null, nonce, recentIds: memory.recentLineIds });
              const line = composeLine(c);
              const parts = callFollowUps(c, line.id);
              for (const caption of [line.caption, ...parts.map((part) => part.caption)]) {
                if (!PAST.test(caption)) continue;
                if (streak < 2 && !habit) heard.dayOne.push(`${archetype} ${phase} ${intent}: ${caption}`);
                else heard.later++;
              }
              for (const id of [line.id, ...parts.map((part) => part.id)]) memory = rememberLine(memory, id);
            }
          }
        }
      }
    }
    expect(heard.dayOne).toEqual([]);
    expect(heard.later).toBeGreaterThan(0);
  });

  it("says the hour only when it is that hour", () => {
    const at = (clock: string, phase: "night" | "dawn") => {
      const said = new Set<string>();
      let memory = freshMemory("lent");
      for (let nonce = 0; nonce < 40; nonce++) {
        const c = ctx({ archetype: "told-you-so", intent: "greeting", phase, clock, nextEvent: null, weather: null, nonce, recentIds: memory.recentLineIds });
        const line = composeLine(c);
        said.add(line.caption);
        memory = rememberLine(memory, line.id);
      }
      return [...said];
    };
    expect(at("9:10 pm", "night").filter((line) => /It's now one/.test(line))).toEqual([]);
    expect(at("1:00 am", "night").some((line) => /It's now one/.test(line))).toBe(true);
    // The house meeting at noon is still to come in the morning, and long gone at nine at night.
    for (let nonce = 0; nonce < 20; nonce++) {
      const line = composeLine(ctx({ archetype: "roommate", intent: "greeting", phase: "night", clock: "9:10 pm", nextEvent: null, nonce }));
      expect(line.caption).not.toMatch(/at noon/);
    }
  });

  it("never says gm on a test wake-up at night", () => {
    for (const archetype of archetypes) {
      let memory = freshMemory("lent");
      for (let nonce = 0; nonce < 30; nonce++) {
        const c = ctx({ archetype, intent: "morning", phase: "night", clock: "9:10 pm", studio: true, inCall: true, nextEvent: null, nonce, recentIds: memory.recentLineIds });
        const line = composeLine(c);
        const parts = callFollowUps(c, line.id);
        for (const caption of [line.caption, ...parts.map((part) => part.caption)]) expect(caption, archetype).not.toMatch(/\bgm\b/);
        for (const id of [line.id, ...parts.map((part) => part.id)]) memory = rememberLine(memory, id);
      }
    }
  });

  it("keeps a voicemail from early in the evening out until the others have had a turn", () => {
    for (const archetype of archetypes) {
      for (let nonce = 0; nonce < 12; nonce++) {
        const first = composeLine(ctx({ archetype, intent: "voicemail", nextEvent: null, nonce }));
        let memory = rememberLine(freshMemory("lent"), first.id);
        // Calls, captions and pokes in between: thirty lines.
        for (let k = 0; k < 30; k++) memory = rememberLine(memory, `${archetype}-poke-hat-${k}`);
        const next = composeLine(ctx({ archetype, intent: "voicemail", nextEvent: null, nonce: nonce + 31, recentIds: memory.recentLineIds }));
        expect(next.id, archetype).not.toBe(first.id);
      }
    }
  });

  it("never says a cap the art draws facing forwards is on backwards", () => {
    const forwards = displayTraits([{ trait_type: "Head", value: "MCGA Cap" }]);
    for (const archetype of archetypes) {
      let memory = freshMemory("lent");
      for (let nonce = 0; nonce < 30; nonce++) {
        const line = composeLine(ctx({ archetype, intent: "poke", zone: "hat", traits: forwards, nonce, recentIds: memory.recentLineIds }));
        expect(line.caption, archetype).not.toMatch(/cap's backwards|cap backwards!|on backwards|worn backwards|wear the cap backwards/i);
        memory = rememberLine(memory, line.id);
      }
    }
  });

  it("calls a garment what the art draws: a jersey is never a tee, and armour is never a shirt", () => {
    const wearing = (value: string) => displayTraits([{ trait_type: "Body", value }]);
    for (const archetype of archetypes) {
      for (const studio of [false, true]) {
        for (const [value, wrong] of [
          ["Blue 143 Jersey", /\btee\b/i],
          ["Purple Tank", /\btee\b/i],
          ["Hawaiian Polo", /\btee\b/i],
          ["Golden Armor", /\bshirt\b|\btee\b/i],
          ["Mon Hoodie", /\bshirt\b|\btee\b/i],
        ] as const) {
          let memory = freshMemory("lent");
          for (let nonce = 0; nonce < 30; nonce++) {
            const line = composeLine(ctx({ archetype, intent: "poke", zone: "collar", traits: wearing(value), studio, nonce, recentIds: memory.recentLineIds }));
            expect(line.caption, `${archetype} in ${value}: ${line.id}`).not.toMatch(wrong);
            // A recording says its own words: one that says "tee" never plays for a jersey.
            if (line.clip) expect(clipForCaption(archetype, line.caption), line.id).toBe(line.clip);
            memory = rememberLine(memory, line.id);
          }
        }
      }
      // The live voice says the jersey's line about its tee as a line about the jersey.
      const jersey = Array.from({ length: 30 }, (_, nonce) => composeLine(ctx({ archetype, intent: "poke", zone: "collar", traits: wearing("Blue 143 Jersey"), nonce })).caption);
      expect(jersey.some((caption) => /\bjersey\b/i.test(caption)), archetype).toBe(true);
    }
  });
});

describe("titles and moments", () => {
  it("answers a reminder for something already under way with a line about now", () => {
    for (const archetype of archetypes) {
      const line = composeLine(ctx({ archetype, intent: "reminder", nextEvent: { title: "Standup", when: "half past nine", minutesUntil: -1 } }));
      expect(line.id, archetype).toMatch(/-now-|-free-/);
    }
  });

  it("cuts a long event title at a word, never in the middle of one", () => {
    const title = "Quarterly planning offsite with the entire extended leadership";
    for (const archetype of archetypes) {
      for (let nonce = 0; nonce < 30; nonce++) {
        const line = composeLine(ctx({ archetype, intent: "reminder", nonce, nextEvent: { title, when: "half past nine", minutesUntil: 8 } }));
        expect(line.caption).not.toMatch(/leadersh|extended leadership/);
        // Nor on a word that leads into the part cut off: "offsite with the at half past nine".
        expect(line.caption).not.toMatch(/\bwith\b|\bthe entire\b/);
      }
    }
  });

  it("counts a reminder's line about the event being on now as about that event, so its chip doesn't say Next", () => {
    for (const archetype of archetypes) {
      const line = composeLine(ctx({ archetype, intent: "reminder", nextEvent: { title: "Call mum back", when: "seven", minutesUntil: 0 } }));
      expect(line.id, archetype).toMatch(/-now-/);
      expect(line.names, `${archetype}: ${line.id}`).toBe(true);
      expect(lineNamesEvent(line.id), line.id).toBe(true);
    }
  });

  it("gives a 1-of-1 its own name where other Chogs show an outfit", () => {
    const blaze = profileFromMeta(53, { name: "CHOG #53 — Blaze", attributes: [{ trait_type: "Base", value: "1:1" }] });
    expect(blaze.headlineTrait).toBe("Blaze");
  });
});

describe("on now, and over", () => {
  // Gym from six to seven, seen at a quarter to eleven at night: over for hours.
  const gym = { title: "Gym", when: "six", minutesUntil: -285, minutesLeft: -225 };
  const late = { clock: "10:45 pm", spokenClock: "quarter to eleven", phase: "night" as const };
  const STARTING = /starting now|it begins|kickoff/i;

  it("never says an event that has ended is on now, in a line or a call", () => {
    const problems: string[] = [];
    for (const archetype of archetypes) {
      for (const intent of ["greeting", "idle", "morning", "reminder"] as LineIntent[]) {
        // Sent with its end, and without one (an hour is assumed): either way it is over.
        for (const nextEvent of [gym, { title: "Gym", when: "six", minutesUntil: -285 }]) {
          let memory = freshMemory("lent");
          for (let nonce = 0; nonce < 12; nonce++) {
            const c = ctx({ archetype, intent, nextEvent, ...late, studio: nonce % 2 === 0, inCall: true, nonce, recentIds: memory.recentLineIds });
            const line = composeLine(c);
            const parts = callFollowUps(c, line.id);
            for (const said of [line, ...parts]) {
              if (/-now-|-day-|-reminder-/.test(said.id) || said.names || /\bGym\b/.test(said.caption)) problems.push(`${archetype} ${intent}: ${said.id}: ${said.caption}`);
            }
            for (const said of [line, ...parts]) memory = rememberLine(memory, said.id);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("gives the calendar's bubble a line about an event done, not one on now, once the day's last block is over", () => {
    for (const archetype of archetypes) {
      const done = bankFor(archetype).peekLate.map((text) => text.replace("{event}", "Gym"));
      for (let nonce = 0; nonce < 8; nonce++) {
        const line = dayReaction(ctx({ archetype, intent: "idle", nonce, nextEvent: gym, ...late }));
        expect(done, `${archetype} ${nonce}`).toContain(line);
      }
    }
  });

  it("says an event is on only while it runs, and that it is starting only as it starts", () => {
    for (const archetype of archetypes) {
      const now = JOKE_FILES[archetype]!.now.map((text) => text.replace("{event}", "Gym"));
      for (let nonce = 0; nonce < 8; nonce++) {
        // Forty minutes into an hour: on now, but long past its first minute.
        const running = { title: "Gym", when: "six", minutesUntil: -40, minutesLeft: 20 };
        const bubble = dayReaction(ctx({ archetype, intent: "idle", nonce: nonce * 2 + 1, nextEvent: running }));
        expect(now, `${archetype} ${nonce}`).toContain(bubble);
        expect(bubble).not.toMatch(STARTING);
        const reminder = composeLine(ctx({ archetype, intent: "reminder", nonce, nextEvent: running }));
        expect(reminder.caption).not.toMatch(STARTING);
      }
    }
  });
});

describe("the sky, the hour and the event on screen", () => {
  /** The sample week at a moment on Wednesday the 21st, as contextFor sends it: each event with its end. */
  function sampleDay(h: number, m: number, over: Partial<LineContext> = {}): LineContext {
    const at = new Date(2026, 9, 21, h, m);
    const events = seedEvents(at);
    const toLine = (item: Occurrence | null | undefined) =>
      item
        ? {
            title: item.event.title,
            when: spokenWhen(item.start),
            minutesUntil: Math.round((item.start.getTime() - at.getTime()) / 60000),
            minutesLeft: Math.round((item.end.getTime() - at.getTime()) / 60000),
            sample: true,
          }
        : null;
    return ctx({
      phase: skyPhase(at),
      weekday: WEEKDAYS[at.getDay()],
      clock: formatClock(at),
      spokenClock: spokenClock(at),
      nextEvent: toLine(nextStarting(events, at, 2)),
      pastEvent: toLine(mostRecent(events, at)),
      nowEvent: toLine(upcoming(events, at, 1).find((item) => item.start <= at)),
      ...over,
    });
  }

  /**
   * Calls one after another in a fresh profile, remembered the way say() remembers them: each line as
   * it plays, the call whole at once. `heard`: how many follow-ups played before the call was ended.
   */
  function callsFrom(base: LineContext, count: number, heard = 2): Array<Array<{ id: string; caption: string }>> {
    let memory = freshMemory("lent");
    const calls: Array<Array<{ id: string; caption: string }>> = [];
    for (let call = 0; call < count; call++) {
      const c = { ...base, studio: true, inCall: true, nonce: memory.lineCount, recentIds: memory.recentLineIds, lastCalls: memory.calls ?? [] };
      const first = composeLine(c);
      const parts = callFollowUps(c, first.id);
      memory = rememberLine(memory, first.id);
      for (const part of parts.slice(0, heard)) memory = rememberLine(memory, part.id);
      memory = rememberCall(memory, [first.id, ...parts.map((part) => part.id)]);
      calls.push([first, ...parts]);
    }
    return calls;
  }

  const sky = (kind: "clear" | "cloud" | "rain" | "hot") => ({ kind, tempC: 9, phrase: `${kind} and 9 degrees`, place: "here" });
  const weatherIds = (archetype: Archetype) => new Set(jokesFor(archetype).filter((joke) => joke.tag?.weather).map((joke) => joke.id));

  it("says a weather line with the day out only in daylight, and no weather line when none fits the hour", () => {
    const DAY_OUT = /\bday\b|\bsun(?!set|down)|\bgrass\b|vitamin d|paddling pool/i;
    const problems: string[] = [];
    for (const archetype of archetypes) {
      const weather = weatherIds(archetype);
      for (const kind of ["clear", "cloud", "hot"] as const) {
        // Late dusk, the night before midnight, and the small hours.
        for (const [h, m] of [[19, 30], [23, 10], [2, 0]] as const) {
          for (const intent of ["greeting", "morning"] as const) {
            for (const said of callsFrom(sampleDay(h, m, { archetype, intent, weather: sky(kind) }), 8, 0).flat()) {
              if (weather.has(said.id) && DAY_OUT.test(said.caption)) problems.push(`${archetype} ${kind} ${h}:${m} ${intent}: ${said.caption}`);
            }
          }
          let memory = freshMemory("lent");
          for (let k = 0; k < 20; k++) {
            const line = composeLine(sampleDay(h, m, { archetype, intent: "greeting", weather: sky(kind), nonce: memory.lineCount, recentIds: memory.recentLineIds }));
            if (weather.has(line.id) && DAY_OUT.test(line.caption)) problems.push(`${archetype} ${kind} ${h}:${m} home: ${line.caption}`);
            memory = rememberLine(memory, line.id);
          }
        }
      }
    }
    expect(problems).toEqual([]);
    // Hype's only clear-sky line is about touching grass: at ten past eleven its calls do without the sky, and stay full.
    const night = callsFrom(sampleDay(23, 10, { archetype: "hype", weather: sky("clear"), intent: "greeting" }), 8);
    for (const call of night) expect(call).toHaveLength(3);
    expect(night.flat().some((said) => /touch grass/.test(said.caption))).toBe(false);
    // In the afternoon it's back.
    const afternoon = callsFrom(sampleDay(15, 10, { archetype: "hype", weather: sky("clear"), intent: "greeting" }), 4);
    expect(afternoon.flat().some((said) => /touch grass/.test(said.caption))).toBe(true);
  });

  it("never says one weather line in two calls in a row, even when the call before was cut short", () => {
    const problems: string[] = [];
    for (const archetype of archetypes) {
      const weather = weatherIds(archetype);
      for (const kind of ["clear", "rain"] as const) {
        for (const [h, m] of [[8, 15], [18, 40], [22, 54]] as const) {
          for (const intent of ["greeting", "morning"] as const) {
            for (const heard of [0, 1, 2]) {
              const calls = callsFrom(sampleDay(h, m, { archetype, intent, weather: sky(kind) }), 8, heard);
              calls.forEach((call, index) => {
                const before = new Set((calls[index - 1] ?? []).map((said) => said.id));
                const again = call.find((said) => weather.has(said.id) && before.has(said.id));
                if (again) problems.push(`${archetype} ${kind} ${h}:${m} ${intent}, heard ${heard}, call ${index + 1}: ${again.caption}`);
              });
            }
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("opens each call with another line, never with the call before's first two again, and no line opens most of them", () => {
    const problems: string[] = [];
    for (const archetype of archetypes) {
      for (const [h, m] of [[18, 5], [18, 40], [19, 6], [22, 54], [23, 10]] as const) {
        for (const intent of ["greeting", "morning"] as const) {
          for (const heard of [0, 1, 2]) {
            const calls = callsFrom(sampleDay(h, m, { archetype, intent, weather: sky("clear") }), 12, heard);
            const label = `${archetype} ${h}:${m} ${intent}, heard ${heard}`;
            calls.forEach((call, index) => {
              const before = calls[index - 1];
              if (!before) return;
              if (call[0].id === before[0].id) problems.push(`${label}: calls ${index} and ${index + 1} open on ${call[0].caption}`);
              if (call[1] && before[1] && call[1].id === before[1].id && call[0].id === before[0].id) problems.push(`${label}: calls ${index} and ${index + 1} share their first two lines`);
            });
            const leads = new Map<string, number>();
            for (const call of calls) leads.set(call[0].id, (leads.get(call[0].id) ?? 0) + 1);
            const most = Math.max(...leads.values());
            if (most > 4) problems.push(`${label}: one line opens ${most} of 12 calls`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("keeps claims about the night that's over off a test wake-up outside the morning", () => {
    const NIGHT_OVER = /\ball night\b|\bslept\b|\bovernight\b|\bsunrise\b|\bbreakfast\b|\byour sleep\b|\beight hours\b/i;
    const problems: string[] = [];
    for (const archetype of archetypes) {
      for (const [h, m] of [[23, 5], [14, 0]] as const) {
        for (const said of callsFrom(sampleDay(h, m, { archetype, intent: "morning", weather: null }), 12).flat()) {
          if (said.id.includes("-wake-") && NIGHT_OVER.test(said.caption)) problems.push(`${archetype} ${h}:${m}: ${said.caption}`);
        }
      }
    }
    expect(problems).toEqual([]);
    // In the morning it's true, and still said.
    const sat = jokesFor("soap-star").find((joke) => /sat by your bed all night/.test(joke.text));
    expect(sat?.needs.am).toBe(true);
  });

  it("says a place is still open only until the event there has ended", () => {
    const said = (h: number, m: number) => [
      ...callsFrom(sampleDay(h, m, { archetype: "told-you-so", intent: "greeting" }), 10).flat(),
      ...Array.from({ length: 20 }, (_, nonce) => composeLine(sampleDay(h, m, { archetype: "told-you-so", intent: "greeting", nonce }))),
    ];
    // Wednesday's Gym runs six to seven.
    expect(said(18, 40).some((line) => /gym is still open/i.test(line.caption))).toBe(true);
    for (const [h, m] of [[19, 6], [20, 15]] as const) expect(said(h, m).filter((line) => /gym is still open/i.test(line.caption))).toEqual([]);
  });

  it("says how long an event runs only when it runs that long", () => {
    for (const archetype of ["hype", "professor"] as const) {
      // Tomorrow's Standup is a quarter of an hour.
      const standup = sampleDay(23, 10, { archetype, intent: "greeting" });
      expect(standup.nextEvent?.title).toBe("Standup");
      const lines = [...callsFrom(standup, 10).flat(), ...Array.from({ length: 30 }, (_, nonce) => composeLine({ ...standup, nonce }))];
      expect(lines.filter((line) => /\bone hour\b/i.test(line.caption)), archetype).toEqual([]);
      // An hour-long planning meeting in two hours: "one hour" is true.
      const planning = ctx({ archetype, intent: "greeting", phase: "day", clock: "1:00 pm", spokenClock: "one", nextEvent: { title: "Planning meeting", when: "three", minutesUntil: 120, minutesLeft: 180 } });
      let memory = freshMemory("lent");
      const heard: string[] = [];
      for (let nonce = 0; nonce < 30; nonce++) {
        const line = composeLine({ ...planning, nonce, recentIds: memory.recentLineIds });
        heard.push(line.caption);
        memory = rememberLine(memory, line.id);
      }
      expect(heard.some((caption) => /\bone hour\b/i.test(caption)), archetype).toBe(true);
    }
  });

  it("holds a length, or a place still open, only against the event the line is about", () => {
    const line = (voice: Archetype, words: RegExp) => jokesFor(voice).find((joke) => words.test(joke.text));
    // "Eight hours of sleep" in a poke and "hours of missing data" in a welcome back aren't about an event's length.
    expect(line("night-shift", /eight hours of sleep/)?.needs.runs).toBeNull();
    expect(line("professor", /hours of missing data/)?.needs.runs).toBeNull();
    expect(line("hype", /One hour, one agenda point/)?.needs.runs).toEqual([45, 75]);
    // The gym is the place still open; "Still on page two" and "still on the bed" name no event's place.
    expect(line("told-you-so", /gym is still open/)?.needs.stillOpen).toBe("gym");
    expect(line("legend", /Still on page two/)?.needs.stillOpen).toBeNull();
    // The sample One-on-one ended at noon: the bed still has the charger on it.
    const travel = ctx({
      archetype: "hype",
      intent: "greeting",
      phase: "dusk",
      clock: "6:00 pm",
      spokenClock: "six",
      nextEvent: { title: "Flight to Lisbon", when: "eight", minutesUntil: 120, minutesLeft: 300 },
      pastEvent: { title: "One-on-one", when: "eleven", minutesUntil: -420, minutesLeft: -390 },
    });
    const bed = line("hype", /still on the bed/)!;
    const said = Array.from({ length: 40 }, (_, nonce) => composeLine({ ...travel, nonce }).id);
    expect(said).toContain(bed.id);
  });

  it("keeps 'since you typed it in' off the sample week in the calendar's bubble", () => {
    const gym = { title: "Gym", when: "six", minutesUntil: -294, minutesLeft: -234 };
    const late = { clock: "10:54 pm", spokenClock: "six minutes to eleven", phase: "night" as const, intent: "idle" as const, archetype: "told-you-so" as const };
    const sample = Array.from({ length: 12 }, (_, nonce) => dayReaction(ctx({ ...late, nonce, nextEvent: { ...gym, sample: true } })));
    expect(sample.filter((line) => /typed/.test(line))).toEqual([]);
    const own = Array.from({ length: 12 }, (_, nonce) => dayReaction(ctx({ ...late, nonce, nextEvent: gym })));
    expect(own.some((line) => /since you typed it in/.test(line))).toBe(true);
  });
});
