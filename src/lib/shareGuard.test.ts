import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEMO_META } from "@/lib/chog";
import { cleanLine, decodeLine, encodeLine } from "@/lib/shareCard";
import { bankLines, isChogLine, sharePageLink, type Speaker } from "@/lib/shareGuard";
import { WEEKDAYS } from "@/lib/time";
import { displayTraits } from "@/lib/traits";
import type { Archetype, DisplayTrait, LineContext, LineEvent, LineIntent, PokeZone, SkyPhase, WeatherKind } from "@/lib/types";
import { ARCHETYPES, stripAudioTags, VOICES } from "@/lib/voices";
import { composeLine, jokesFor, snoozePick, wornSlots } from "@/lib/writer";
import ARCHIVE from "@/lib/shareLines.json";

const INTENTS: LineIntent[] = ["intro", "greeting", "morning", "reminder", "poke", "voicemail", "idle", "absence", "snooze"];
const ZONES: PokeZone[] = ["hat", "face", "collar"];
const PHASES: Array<{ phase: SkyPhase; clock: string; spokenClock: string }> = [
  { phase: "dawn", clock: "5:45 am", spokenClock: "quarter to six" },
  { phase: "morning", clock: "7:30 am", spokenClock: "half past seven" },
  { phase: "day", clock: "1:15 pm", spokenClock: "quarter past one" },
  { phase: "dusk", clock: "6:45 pm", spokenClock: "quarter to seven" },
  { phase: "night", clock: "11:00 pm", spokenClock: "eleven" },
];
const WEATHER: WeatherKind[] = ["clear", "cloud", "rain", "snow", "fog", "wind", "hot", "cold"];

const TRAITS: DisplayTrait[][] = [
  ...[375, 642, 821, 242].map((art) => displayTraits(DEMO_META[art].attributes)),
  displayTraits([{ trait_type: "Eyes", value: "Happy" }]),
  displayTraits([
    { trait_type: "Head", value: "WAGMI Cap" },
    { trait_type: "Body", value: "Mon Hoodie" },
  ]),
];

/** Calendar titles of every kind, the longest a title can be (60), and one that isn't plain ASCII. */
const EVENTS = [
  "Standup",
  "Dentist",
  "Gym",
  "Flight to Lisbon",
  "Dinner with Mum",
  "Deep work",
  "Haircut",
  "Bin day",
  "Design review",
  "Café with Zoë",
  "Quarterly planning with the whole product team in room four",
];
/** Names as typed in the app: none, short, the longest it takes (32), and one with an accent. */
const NAMES = ["", "Sam", "Maximilian Alexander-Worthington", "Zoë"];

function ctx(over: Partial<LineContext> = {}): LineContext {
  return {
    name: "",
    artId: 375,
    archetype: "told-you-so",
    traits: TRAITS[0],
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

/** The line exactly as a share link carries it: cleaned, into the URL and back out. */
function shared(caption: string): string {
  const line = cleanLine(caption);
  expect(decodeLine(encodeLine(line))).toBe(line);
  return line;
}

/** Whether a Golden Chog's link may show the line: most of the checks below read the Golden's own lines. */
const golden = (line: string) => isChogLine(line, "golden");

/** Every caption the writer can make for one Chog, across the moments a day has. */
function captionsFor(archetype: Archetype): string[] {
  const out = new Set<string>();
  let nonce = 0;
  for (const intent of INTENTS) {
    for (let v = 0; v < 24; v++) {
      nonce += 7;
      const sky = PHASES[v % PHASES.length];
      const kind = WEATHER[v % WEATHER.length];
      const title = EVENTS[(v + INTENTS.indexOf(intent)) % EVENTS.length];
      // Today, on now, tomorrow (said "tomorrow at ..."), and none.
      const events: Array<LineEvent | null> = [
        { title, when: "twenty-five past six", minutesUntil: 95 },
        { title, when: "half past nine", minutesUntil: -10 },
        { title, when: "half past nine", minutesUntil: 630 },
        null,
      ];
      const base = ctx({
        archetype,
        intent,
        zone: intent === "poke" ? ZONES[v % ZONES.length] : undefined,
        traits: TRAITS[v % TRAITS.length],
        ...sky,
        weekday: WEEKDAYS[v % WEEKDAYS.length],
        weather: v % 6 === 5 ? null : { kind, tempC: kind === "cold" ? -3 : 21, phrase: kind === "cold" ? "cold at -3 degrees" : `clear and ${v} degrees`, place: "here" },
        nextEvent: events[v % events.length],
        pastEvent: v % 5 === 0 ? { title: "Lunch", when: "half past twelve", minutesUntil: -200 } : null,
        name: NAMES[v % NAMES.length],
        facts: v % 3 === 0 ? ["I'm training for a marathon and my knees already hate me for it"] : v % 3 === 1 ? ["hates early meetings"] : [],
        memory: v % 2 === 0 ? ["skipped Gym", "showed up for Standup", "snoozed 3 times"] : ["snoozed once"],
        streak: v % 4,
        habit: v % 2 === 0 ? "usually up around seven" : null,
        relationship: v % 3 === 0 ? "owner" : v % 3 === 1 ? "stranger" : undefined,
        inCall: v % 2 === 1,
        nonce,
      });
      out.add(composeLine(base).caption);
      // The studio voice (the default): a recorded line, said without the name.
      out.add(composeLine({ ...base, studio: true }).caption);
    }
  }
  for (let turn = 0; turn < 8; turn++) out.add(snoozePick(archetype, [], turn).caption);
  return [...out];
}

describe("a share link's line", () => {
  it("passes for every line the writer composes, for all nine Chogs", () => {
    expect(ARCHETYPES).toHaveLength(9);
    for (const archetype of ARCHETYPES) {
      const captions = captionsFor(archetype);
      expect(captions.length).toBeGreaterThan(40);
      const failed = captions.filter((caption) => !isChogLine(shared(caption), archetype));
      expect(failed, archetype).toEqual([]);
    }
  });

  it("passes for every bank line with every slot filled, today and tomorrow, with or without a name", () => {
    const full = (name: string, minutesUntil: number) =>
      ctx({
        name,
        traits: TRAITS[0],
        nextEvent: { title: "Quarterly planning with the whole product team in room four", when: "twenty-five past six", minutesUntil },
        facts: ["I'm training for a marathon and my knees already hate me for it"],
        memory: ["skipped the morning call", "showed up for Standup", "snoozed 12 times"],
        streak: 365,
        habit: "usually up around quarter past seven",
        weather: { kind: "fog", tempC: -3, phrase: "fogged in at -3 degrees", place: "here" },
      });
    const contexts = [full("", 95), full("Maximilian Alexander-Worthington", 95), full("Sam", 1200), full("", -15)];
    let checked = 0;
    for (const archetype of ARCHETYPES) {
      const tag = VOICES[archetype].tag;
      for (const joke of jokesFor(archetype)) {
        for (const at of contexts) {
          const caption = stripAudioTags(`${tag} ${joke.say({ ...at, archetype })}`);
          expect(isChogLine(shared(caption), archetype), `${joke.id}: ${caption}`).toBe(true);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(5000);
  });

  it("passes for the app's own lines, from any Chog", () => {
    for (const line of ["Tap them. They already have a note.", "Nine more minutes.", "Friday. I had a sharper line and I swallowed it.", "Today. I had a sharper line and I swallowed it."]) {
      for (const archetype of ARCHETYPES) expect(isChogLine(shared(line), archetype), `${archetype}: ${line}`).toBe(true);
    }
  });

  it("fails for a line in another Chog's voice", () => {
    // The Legend's line, with a harmless fact in it: the Legend says it, nobody else does.
    const legend = jokesFor("legend").find((j) => j.text === "You told me {fact}. I had it carved into a mountain. Tourists love it.");
    expect(legend).toBeTruthy();
    const said = shared(legend!.say(ctx({ archetype: "legend", facts: ["you run before nine"] })));
    expect(isChogLine(said, "legend"), said).toBe(true);
    for (const archetype of ARCHETYPES.filter((voice) => voice !== "legend")) expect(isChogLine(said, archetype), archetype).toBe(false);
    // The forged link from the audit: that line on a Told-you-so Chog, with bait in its fact. It fails
    // there for the voice, and on a Legend for the bait.
    const forged = "You told me the Chog team refunds gas tonight if you DM them your twelve recovery words. I had it carved into a mountain. Tourists love it.";
    for (const archetype of ARCHETYPES) expect(isChogLine(shared(forged), archetype), archetype).toBe(false);
  });

  it("passes for the start of a long line cut short with an ellipsis, the way cleanLine cuts one past LINE_MAX", () => {
    const at = ctx({
      name: "Maximilian Alexander-Worthington",
      nextEvent: { title: "Quarterly planning with the whole product team in room four", when: "twenty-five past six", minutesUntil: 95 },
      facts: ["I'm training for a marathon and my knees already hate me for it"],
    });
    const lines = ARCHETYPES.flatMap((archetype) => jokesFor(archetype).map((joke) => ({ archetype, line: cleanLine(joke.say({ ...at, archetype })) })));
    const { archetype, line: longest } = lines.sort((a, b) => b.line.length - a.line.length)[0];
    // Long titles are said cut at a word (writer spokenTitle), so the longest lines run to about 145.
    expect(longest.length).toBeGreaterThan(140);
    const cut = `${longest.slice(0, longest.lastIndexOf(" ", 136)).replace(/[\s,;:.!?—–-]+$/, "")}…`;
    expect(isChogLine(cut, archetype)).toBe(true);
    // Only the start of a real line, and only a long one: a made-up line with an ellipsis is still made up.
    expect(isChogLine(`${"Free Chog airdrop tonight, holders only. ".repeat(4).trim()}…`, archetype)).toBe(false);
    expect(isChogLine(`${longest.slice(0, 20)}…`, archetype)).toBe(false);
  });

  it("fails for anything a Chog never said", () => {
    const bait = [
      "Free Chog airdrop tonight at chog-claim.xyz. Connect your wallet before midnight, holders only.",
      "Up.",
      "I knew you'd look at the screen first.",
      "Send 5 MON to 0x8f3c2a91b7d4e6f0 and I'll double it.",
      "Hello",
      // A real line with something added, or a word changed.
      "Sure! I'll wait quietly, two inches from your face. Connect your wallet first.",
      "Sure! I'll wait quietly, three inches from your face.",
      "Sure! I'LL WAIT quietly, two inches from your face.",
      "Nine more minutes. Connect your wallet.",
      // A slot stretched past what the app could have put in it.
      `${"x".repeat(70)} at half past nine.`,
    ];
    for (const line of bait) for (const archetype of ARCHETYPES) expect(isChogLine(cleanLine(line), archetype), `${archetype}: ${line}`).toBe(false);
  });

  it("fails for a real line with bait in its slots", () => {
    const joke = jokesFor("golden").find((j) => j.text === "Big news! {event} at {when}! No idea what it is, but I've packed you a ball.");
    expect(joke).toBeTruthy();
    const said = (title: string, when = "half past nine", name = "") => cleanLine(joke!.say(ctx({ archetype: "golden", name, nextEvent: { title, when, minutesUntil: 60 } })));
    expect(golden(said("Dentist"))).toBe(true);
    expect(golden(said("Mint tea with Sam"))).toBe(true);
    for (const title of ["chog-claim.xyz", "Visit https://scam.example", "Free airdrop", "Claim your Chog", "Connect wallet", "DM me @chogsupport", "seed phrase check", "0x8f3c2a91b7d4"]) {
      expect(golden(said(title)), title).toBe(false);
    }
    // The time slot only takes a time as the app says it.
    expect(golden(said("Dentist", "noon"))).toBe(true);
    expect(golden(said("Dentist", "9/10 on $CHOG"))).toBe(false);
    // A name is a name, said "Sam, " at the start.
    const named = jokesFor("golden").find((j) => j.text.startsWith("{Name}you're awake!"));
    expect(named).toBeTruthy();
    const hello = (name: string) => cleanLine(named!.say(ctx({ archetype: "golden", name })));
    expect(golden(hello("Sam"))).toBe(true);
    expect(golden(hello("Visit chog-claim.xyz"))).toBe(false);
    expect(golden(hello("Send 5 MON to 0x8f3c2a91"))).toBe(false);
    expect(golden(hello("$CHOG to the moon"))).toBe(false);
  });

  it("reads bait the way a person sees it: other dots, spaced and spelled-out domains, lookalike letters", () => {
    const fact = (text: string) => `You told me ${text}. Pure alpha. I've kept it secret, which is hard at this volume.`;
    const news = (text: string) => `Big news! ${text} at half past nine! No idea what it is, but I've packed you a ball.`;
    // The same lines with harmless words in the slots: they fit (the Hype man's and the Golden's), so
    // it is only the bait that fails.
    expect(isChogLine(shared(fact("you run before nine")), "hype")).toBe(true);
    expect(golden(shared(news("Dentist")))).toBe(true);
    const bait = [
      fact("holders get free MON tonight if you sign in at chogmint．xyz before nine"),
      fact("you sign in at chogmint。xyz before nine"),
      fact("you sign in at chogmint｡xyz before nine"),
      fact("you sign in at chogmint .xyz before nine"),
      fact("you sign in at chogmint. xyz before nine"),
      fact("you sign in at chogmint(.)xyz before nine"),
      fact("you sign in at chogmint (dot) xyz before nine"),
      fact("you sign in at chogmint dot xyz before nine"),
      fact("you sign in at chogmint DOT com before nine"),
      fact("you go to https：／／chogmint before nine"),
      news("Holders: connect your wаllet at chogmint .xyz"),
      // A Cyrillic letter inside a Latin word, with no domain at all.
      news("Cоnnect your wallet"),
      news("Bring wаllet"),
      // Whole words of lookalikes, small capitals, mathematical bold, a soft hyphen, digits for letters.
      news("Free МОΝ"),
      news("ᴄᴏɴɴᴇᴄᴛ ʏᴏᴜʀ ᴡᴀʟʟᴇᴛ"),
      news("\u{1d41c}\u{1d428}\u{1d427}\u{1d427}\u{1d41e}\u{1d41c}\u{1d42d} \u{1d430}\u{1d41a}\u{1d425}\u{1d425}\u{1d41e}\u{1d42d}"),
      news("Connect your wal­let"),
      news("C0nnect y0ur wa11et"),
      news("Free a1rdrop"),
      news("cIaim your MON"),
      news("Claim your MON"),
      // Bait in plain words: the twelve words, a DM, a refund that wants something.
      fact("the team refunds gas tonight if you DM them"),
      fact("support needs your twelve recovery words"),
      fact("you keep your 24 words in your notes app"),
      news("DM us for a refund"),
      // The ways round it the audit found: spaced letters (a Roman numeral D too), a hyphen, other words.
      news("D M me"),
      news("Ⅾ M me"),
      news("D.M. me"),
      news("D. M. me"),
      news("Tell me your twelve-word phrase"),
      news("Send 1 MON to get 2 back"),
      news("Your mnemonic please"),
      news("Message me privately"),
      news("Refunds for holders"),
      // Letters split by any other sign, a digit tacked on, and a chat app to move the talk to.
      news("D-M me"),
      news("D_M me"),
      news("D/M me"),
      news("D+M me"),
      news("D4M me"),
      news("DM4 me"),
      news("DM 2 us"),
      news("Telegram me"),
      news("Whatsapp me"),
      news("Whats-app us"),
      news("Text me on telegram"),
      news("Signal me"),
      news("Find us on Discord"),
      news("Join our Telegram"),
      // A single letter in front that would join the run and hide the word in it.
      news("Q: D M me"),
      news("Gym w/ D. M. me"),
      news("P.S. D M me"),
      news("x D-M me"),
      news("D M M E"),
      // A chat app's name as a verb or with a handle, and its links, still fail once the filter lets
      // plans that only mention one through.
      news("DM me"),
      news("Discord me"),
      news("Signal us."),
      news("Add me on Telegram"),
      news("Join our Discord server"),
      news("Join the Telegram"),
      news("Telegram @chogsupport"),
      news("WhatsApp @chog_help"),
      news("discord: @chogmod"),
      news("Signal @sam_ops"),
      news("t.me/anything"),
      news("wa.me/123"),
    ];
    for (const line of bait) for (const archetype of ARCHETYPES) expect(isChogLine(cleanLine(line), archetype), `${archetype}: ${line}`).toBe(false);
    // Plain plans with the same words still pass.
    for (const title of [
      "Message Mum",
      "Send invoice",
      "Holders AGM",
      "Write 300 words",
      "Dad's 12th mile",
      "Call Dad at 5 p.m.",
      "Plan A. Then B",
      "Q&A with Sam",
      "A/B test review",
      "R&D sync",
      "Text Mum",
      "Fix the bike signal",
      "Discord community call",
      "DM meeting",
      // Texting, signalling and a call on Discord are plans, not a move to a chat app.
      "Text me when you land",
      "Text me",
      "Text us the address",
      "Join the Discord call",
      "Signal us at the gate",
    ]) {
      expect(golden(shared(news(title))), title).toBe(true);
    }
  });

  it("lets a line about what a Chog wears through only for a Chog that wears it", () => {
    const tuxedo = displayTraits(DEMO_META[642].attributes);
    const jersey = displayTraits(DEMO_META[375].attributes);
    const wearing = (type: string, value: string) => displayTraits([{ trait_type: type, value }]);
    // The audit's link: an archived line about gold armour, on #642 in a white tuxedo.
    const gold = "Gold armour! Polished, gleaming, and completely liquidation proof. You can poke it all day. Your finger loses.";
    expect(isChogLine(gold, "hype", ARCHIVE)).toBe(true);
    expect(isChogLine(gold, "hype", ARCHIVE, tuxedo)).toBe(false);
    expect(isChogLine(gold, "hype", ARCHIVE, wearing("Body", "Golden Armor"))).toBe(true);
    // A poke written for a crown, on a Chog in a peace hat.
    const crown = "Mind the crown! Won it in the genesis final. The other finalist fell asleep.";
    expect(isChogLine(crown, "hype", ARCHIVE, tuxedo)).toBe(false);
    expect(isChogLine(crown, "hype", ARCHIVE, wearing("Head", "Crown"))).toBe(true);
    // A tee line said of a jersey says "jersey", and only of a jersey.
    const tee = "Mind the tee. I had it printed before you'd even made the mistake.";
    const asJersey = "Mind the jersey. I had it printed before you'd even made the mistake.";
    expect(isChogLine(asJersey, "told-you-so", ARCHIVE, jersey)).toBe(true);
    expect(isChogLine(tee, "told-you-so", ARCHIVE, jersey)).toBe(false);
    expect(isChogLine(tee, "told-you-so", ARCHIVE, wearing("Body", "white tee"))).toBe(true);
    expect(isChogLine(asJersey, "told-you-so", ARCHIVE, wearing("Body", "white tee"))).toBe(false);
    // An archived line with the hat in a slot holds this art's hat, not any hat.
    const hat = (said: string) => `Don't touch the ${said}. It took longer to set than most projects take to rug.`;
    expect(isChogLine(hat(wornSlots(jersey).hat), "told-you-so", ARCHIVE, jersey)).toBe(true);
    expect(isChogLine(hat("crown"), "told-you-so", ARCHIVE, jersey)).toBe(false);
    // An archived line about the day names what they wear, not the Chog: it still passes for any outfit.
    const robe = ARCHIVE["soap-star"]?.find((line) => line.startsWith("Robe on, lights low. {event}"));
    expect(robe).toBeTruthy();
    expect(isChogLine(robe!.replace("{event}", "Standup").replace("{soon}", "in a few minutes"), "soap-star", ARCHIVE, tuxedo)).toBe(true);
    // Every line the writer says for a Chog passes for that Chog, studio voice or live.
    for (const archetype of ARCHETYPES) {
      for (const traits of TRAITS) {
        for (const intent of ["poke", "greeting", "morning"] as LineIntent[]) {
          for (let nonce = 0; nonce < 6; nonce++) {
            for (const studio of [false, true]) {
              const caption = composeLine(ctx({ archetype, traits, intent, zone: ZONES[nonce % ZONES.length], studio, nonce })).caption;
              expect(isChogLine(shared(caption), archetype, ARCHIVE, traits), `${archetype}: ${caption}`).toBe(true);
            }
          }
        }
      }
    }
  });

  it("passes the calendar titles and names people really have", () => {
    const joke = jokesFor("golden").find((j) => j.text === "Big news! {event} at {when}! No idea what it is, but I've packed you a ball.")!;
    const said = (title: string) => shared(joke.say(ctx({ archetype: "golden", nextEvent: { title, when: "half past nine", minutesUntil: 60 } })));
    for (const title of [
      "Buy a new wallet",
      "Find my wallet",
      "Submit expense claims",
      "Insurance claim call",
      "Read Whitelist doc",
      "Mint tea with Sam",
      "Coffee @ the corner",
      "Café with Zoë",
      "Встреча с Сашей",
      "東京タワー",
      "Ana's 30th 🎂",
      "Pay $50 rent",
    ]) {
      expect(golden(said(title)), title).toBe(true);
    }
    // Anything shaped like an address or a handle still fails, innocent or not; the share sheet then
    // sends the card and the words without a link (sharePageLink).
    for (const title of ["Coffee @Starbucks", "Node.js meetup", "Visit St.Albans", "Zoom: zoom.us/j/123"]) {
      expect(golden(said(title)), title).toBe(false);
    }
    const named = jokesFor("golden").find((j) => j.text.startsWith("{Name}you're awake!"))!;
    for (const name of ["Mary_Kate", "Sam & Alex", "Ana (mom)", "👋🏽 Sam", "🇬🇧 Tom", "Саша", "O’Neill", "Zoë"]) {
      expect(golden(shared(named.say(ctx({ archetype: "golden", name })))), name).toBe(true);
    }
  });

  it("passes every way the writer says how soon an event is", () => {
    const joke = jokesFor("golden").find((j) => j.text === "I cleaned your camera for you. {event} is {soon}! With my tongue.")!;
    expect(joke).toBeTruthy();
    for (const minutesUntil of [-20, 0, 5, 15, 40, 60, 120, 300, 1000, 2000, 4000]) {
      const caption = shared(joke.say(ctx({ archetype: "golden", nextEvent: { title: "Dentist", when: "half past nine", minutesUntil } })));
      expect(golden(caption), caption).toBe(true);
    }
  });
});

const ARCHIVE_FILE = path.join(process.cwd(), "src/lib/shareLines.json");

describe("the archive of lines already out in links", () => {
  const archive = JSON.parse(readFileSync(ARCHIVE_FILE, "utf8")) as Record<Speaker, string[]>;
  const SPEAKERS: Speaker[] = ["app", ...ARCHETYPES];

  it("holds every line the banks say now, filed under who says it, so none can leave them unrecorded", () => {
    expect(Object.keys(archive).sort()).toEqual([...SPEAKERS].sort());
    const missing: Partial<Record<Speaker, string[]>> = {};
    for (const speaker of SPEAKERS) {
      const lines = archive[speaker];
      expect(lines.every((line) => typeof line === "string")).toBe(true);
      const kept = new Set(lines);
      expect(kept.size, `no line twice (${speaker})`).toBe(lines.length);
      const left = bankLines(speaker).filter((line) => !kept.has(line));
      if (left.length) missing[speaker] = left;
    }
    if (Object.keys(missing).length && process.env.ARCHIVE_LINES === "1") {
      // Append-only: new lines go on the end of their speaker's list and nothing is ever taken out, so
      // every link already shared keeps opening after its line is reworded or dropped.
      const next = Object.fromEntries(SPEAKERS.map((speaker) => [speaker, [...archive[speaker], ...(missing[speaker] ?? [])]]));
      writeFileSync(ARCHIVE_FILE, `${JSON.stringify(next, null, 2)}\n`);
      return;
    }
    expect(missing, "New lines in the banks: record them with ARCHIVE_LINES=1 npx vitest run src/lib/shareGuard.test.ts").toEqual({});
  });

  it("opens a line that has left the banks, but only from the archive, and only for its own voice", () => {
    let checked = 0;
    for (const voice of ARCHETYPES) {
      const now = new Set(bankLines(voice));
      const gone = archive[voice].filter((line) => !now.has(line));
      const plain = gone.filter((line) => !line.includes("{")).map((line) => shared(stripAudioTags(line)));
      expect(plain.filter((line) => !isChogLine(line, voice, archive)), voice).toEqual([]);
      expect(plain.filter((line) => isChogLine(line, voice)).length, voice).toBeLessThan(plain.length / 10 + 1);
      // Another Chog doesn't get the line from the archive either.
      const other = ARCHETYPES[(ARCHETYPES.indexOf(voice) + 1) % ARCHETYPES.length];
      expect(plain.filter((line) => isChogLine(line, other, archive)).length, `${voice} as ${other}`).toBeLessThan(plain.length / 10 + 1);
      checked += plain.length;
    }
    expect(checked).toBeGreaterThan(100);
    // An old line with a slot, filled: the archive's lines get the same slots, and the same checks.
    const voice = ARCHETYPES.find((v) => archive[v].some((line) => line.startsWith("{Name}") && !line.slice(6).includes("{") && !bankLines(v).includes(line)))!;
    expect(voice).toBeTruthy();
    const slotted = archive[voice].find((line) => line.startsWith("{Name}") && !line.slice(6).includes("{") && !bankLines(voice).includes(line))!;
    const filled = shared(slotted.replace("{Name}", "Sam, "));
    expect(isChogLine(filled, voice, archive)).toBe(true);
    expect(isChogLine(shared(slotted.replace("{Name}", "Visit chogmint dot xyz, ")), voice, archive)).toBe(false);
  });
});

describe("the link the share sheet gives", () => {
  const ORIGIN = "https://choglander.vercel.app";
  const line = "Big news! Dentist at half past nine! No idea what it is, but I've packed you a ball.";

  it("is the line's share page when the page would show it", () => {
    expect(sharePageLink(ORIGIN, 1, line, "golden")).toBe(`${ORIGIN}/c/1/${encodeLine(line)}`);
    // A plan that only mentions texting or Discord keeps its link; a move to a chat app does not.
    const titled = (title: string) => line.replace("Dentist", title);
    for (const title of ["Text me when you land", "Join the Discord call"]) expect(sharePageLink(ORIGIN, 1, titled(title), "golden"), title).toBe(`${ORIGIN}/c/1/${encodeLine(titled(title))}`);
    for (const title of ["Telegram me", "DM me"]) expect(sharePageLink(ORIGIN, 1, titled(title), "golden"), title).toBe("");
  });

  it("is left out when the page would say 'Wrong number', or there is no public address", () => {
    expect(sharePageLink("", 1, line, "golden")).toBe("");
    // The Golden's line from a Professor is not one it says.
    expect(sharePageLink(ORIGIN, 821, line, "professor")).toBe("");
    // A line the AI writer wrote is not in a bank; neither is anything with an address in it.
    expect(sharePageLink(ORIGIN, 821, "Standup at nine. I polished my monocle for it. Wear the good socks.", "professor")).toBe("");
    expect(sharePageLink(ORIGIN, 1, "Big news! Node.js meetup at half past nine! No idea what it is, but I've packed you a ball.", "golden")).toBe("");
  });
});
