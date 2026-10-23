// Checks a Chog's joke file (src/data/jokes/<archetype>.json) against the shape the writer reads and
// the house rules: every line tied to something real, no formula, nothing a different Chog could say.
//
//   node scripts/check-jokes.mjs src/data/jokes/told-you-so.json [more files]
//
// Prints each problem and exits 1 if there are any. src/lib/jokes.test.ts runs the same checks.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const ARCHETYPES = ["told-you-so", "hype", "professor", "gremlin", "soap-star", "night-shift", "golden", "roommate", "legend"];
export const EVENT_KINDS = ["meeting", "big", "focus", "health", "workout", "food", "social", "family", "errand", "travel", "rest", "other"];
export const PHASES = ["dawn", "morning", "day", "dusk", "night"];
export const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
export const WEATHER = ["clear", "cloud", "rain", "snow", "fog", "wind", "hot", "cold"];
export const HEADS = ["beanie", "cap", "crown", "horns", "helmet", "hair", "band", "hat", "odd", "none"];
export const BODIES = ["suit", "costume", "hoodie", "tee", "robe", "jacket", "armor", "none"];
export const EYES = ["glasses", "smiling", "sleepy", "wide", "narrow"];

/** How many lines each list holds. */
export const COUNTS = {
  intro: 3,
  ring: 3,
  wake: 8,
  snooze: 6,
  voicemail: 6,
  absence: 4,
  owner: 3,
  stranger: 3,
  recall: 5,
  now: 2,
  calendarFree: 2,
  time: 4,
  days: 1,
  weather: 1,
  ahead: 3,
  soon: 2,
  peek: 1,
  pokeAny: 3,
  pokeKind: 2,
};

const SLOTS = ["Name", "wear", "hat", "body", "sky", "day", "clock", "event", "when", "soon", "fact", "habit", "streak", "skipped", "attended", "snoozes"];
const EVENT_SLOTS = /\{(event|when|soon)\}/;
const RECALL_SLOTS = /\{(snoozes|skipped|attended|streak|fact|habit)\}/;
/**
 * A voiced line is recorded once in the Chog's studio voice and ships with the app, so it can hold no
 * slot but {Name} (left out when recorded). The moment still fits: event lines are tagged with the kind
 * of event, time lines with the hour, pokes with what the Chog wears; the event's name is on screen.
 */
const voiced = (text) => !/\{(?!Name\})[A-Za-z]+\}/.test(text);

/** Never said: advice, prices, slurs, an invented "Alex". Web3 slang itself is the point and is allowed. */
const BANNED = /\b(buy the dip|financial advice|not financial advice|nfa|price target|jeets?|retard\w*|alex|\$\d)/i;
/** Engineering words nobody laughs at. The joke is the culture (gm, rugs, floor, gas), not the protocol. */
const JARGON =
  /\b(mempool|finality|validators?|parallel execution|slippage|multisig|smart contracts?|block explorer|nodes?|tokenomics|consensus|shard(s|ing)?|evm|layer ?(one|two|2)|l2s?|oracles?|merkle|hash ?rate|nonce|calldata|rollups?|bytecode|tps|throughput|block ?times?|latency|liquidity pools?|amm|tvl|apy|apr|oracle)\b/i;
/** Web3 bolted on as a comparison ("like a validator") instead of being the joke. */
const SIMILE =
  /\b(like|as) an? (\w+ )?(validator|node|whale|rug|wallet|chart|candle|token|nft|jpeg|airdrop|mint|transaction|contract|dao|dev|degen|bag|bot|testnet|mainnet|roadmap|whitepaper|block|chain|protocol|exchange)s?\b/i;
/** Clichés that killed the joke years ago. */
const CLICHES = /\b(to the moon|diamond hands?|wen lambo|this is fine|we'?re so back|it'?s so over|hold the line|stay humble|just saying|no cap)\b/i;
/** A line that trails off after its laugh. */
const WEAK_END = /\b(though|anyway|honestly|basically|really|actually|or whatever|i guess|or something|you know|right now|just saying)[.!?]*$/i;
/**
 * A first sentence that only announces the moment ("Gym soon.", "Rain.", "Monday.", "Snooze!"). The
 * screen already shows it (the event under the line, the sky, the weekday), so saying it first gives
 * the joke away: a line starts inside the joke and lets the moment show through the details.
 */
const LABEL =
  /^(the |a |an |your |my |big |another |nearly |almost |it's |its )?(meeting|standup|stand-up|sync|call|calls|big day|big one|interview|exam|deadline|focus|focus day|deep work|study|appointment|dentist|doctor|checkup|health|workout|gym|training|training day|leg day|run|food|lunch|lunchtime|dinner|brunch|breakfast|meal|coffee|social|social thing|party|drinks|date|family|family thing|errands?|groceries|laundry|chores|travel|travel day|flight|trip|commute|rest|rest day|nap|day off|rain|raining|sunny|sun|sunshine|clear skies|clear|cloudy|clouds|grey|snow|snowing|fog|foggy|wind|windy|hot|heatwave|cold|freezing|dawn|morning|afternoon|evening|dusk|night|midnight|late|monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend|snooze|snoozed|snoozing|missed call|voicemail|beep|no answer|you're back|back)( (today|soon|later|tonight|time|incoming|day|again|out|thing|run|now))*$/i;
const labelOpener = (text) => {
  const first = text.replace("{Name}", "").split(/(?<=[.!?])\s/)[0].replace(/[.!?]+$/, "").trim();
  return first.split(/\s+/).length <= 4 && LABEL.test(first);
};

/**
 * The web3 half of the joke. At least half the lines must carry one of these, and none may be leaned
 * on: each phrase at most three times in a file, so the slang is a turn, not a tic.
 */
export const WEB3 = [
  /\bgm\b/i, /\bgn\b/i, /\bwagmi\b/i, /\bngmi\b/i, /\bser\b/i, /\bfrens?\b/i, /\bwen\b/i, /\blfg\b/i, /\bfew understand\b/i,
  /\bprobably nothing\b/i, /\bso early\b/i, /\bso back\b/i, /\bso over\b/i, /\btouch(ing)? grass\b/i, /\bpaper hands?\b/i,
  /\bdiamond hands?\b/i, /\brug(ged|s| pull)?\b/i, /\bfloor\b/i, /\bgas( fees?)?\b/i, /\bmint(ed|ing|s)?\b/i, /\bairdrops?\b/i,
  /\balpha\b/i, /\bdegens?\b/i, /\bfud\b/i, /\bhodl\b/i, /\bdyor\b/i, /\btestnet\b/i, /\bmainnet\b/i, /\bwhitepaper\b/i,
  /\broadmap\b/i, /\bseed phrase\b/i, /\bwallet\b/i, /\bon-?chain\b/i, /\bblock(chain| time)\b/i, /\btps\b/i,
  /\bmonad\b/i, /\bnads?\b/i, /\bjpegs?\b/i, /\bpfp\b/i, /\brarity\b/i, /\bone of one\b/i, /\brare trait\b/i,
  /\bwhitelist(ed)?\b/i, /\ballowlist\b/i, /\bdiscord\b/i, /\bspaces\b/i, /\bshill(ing)?\b/i, /\bape(d|s)? in\b/i,
  /\bbagholder\b/i, /\bholding (the|your|my) bags?\b/i, /\bexit liquidity\b/i, /\bnumber go up\b/i, /\bup only\b/i, /\bath\b/i, /\bdown bad\b/i,
  /\brekt\b/i, /\bliquidat(ed|ion)\b/i, /\bdao\b/i, /\bgovernance\b/i,
  /\bairdrop farming\b/i, /\bstak(e|ed|ing)\b/i, /\bconnect(ed)? (your |my )?wallet\b/i, /\bsign(ed|ing)? (the|this) transaction\b/i,
  /\bbull run\b/i, /\bbear market\b/i, /\bwhales?\b/i, /\bmoon(ing)?\b/i, /\bcrypto\b/i, /\bweb3\b/i, /\bnfts?\b/i, /\bsnapshot\b/i,
  /\broyalt(y|ies)\b/i, /\bsweep(ing)? the floor\b/i, /\bhalving\b/i, /\bfork(ed)?\b/i,
  /\bledger\b/i, /\bbullish\b/i, /\bbearish\b/i, /\bgenesis\b/i, /\bthe timeline\b/i, /\bfront-?run\b/i, /\bclaim(ed)?\b/i,
  /\bfundamentals\b/i, /\bunlocks?\b/i, /\bbuilding\b/i, /\bcharts?\b/i, /\bconviction\b/i, /\baccumulat\w*\b/i,
  /\bcold storage\b/i, /\byield\b/i, /\bstealth\b/i, /\breveal\b/i, /\bvesting\b/i, /\btwo weeks\b/i,
  /\bbags\b/i, /\bthe dip\b/i, /\b(red|green) candles?\b/i, /\bcopium\b/i, /\bhopium\b/i, /\bfomo\b/i, /\bthe devs?\b/i,
  /\bdoxx(ed)?\b/i, /\butility\b/i, /\bpump(ed|ing)?\b/i, /\bdump(ed|ing)?\b/i, /\bngmi\b/i, /\bhigher lows?\b/i, /\bdegen\w*\b/i,
  /\bfloor price\b/i, /\bbased\b/i, /\bcope\b/i, /\bseed round\b/i, /\bwen\b/i, /\bover-?leveraged\b/i, /\bleverage\b/i,
];
/** Capitalised words that may sit mid-sentence. Anything else capitalised is probably an invented name. */
const CAPS_OK = new Set(["I", "I'm", "I'll", "I've", "I'd", "Chog", "Chogs", "Monad", "Mon", "Discord", "OK", "TV", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December", "God", "English", "French", "Latin", "Greek", "Wi-Fi", "Google", "Earth", "Mars", "Olympics", "Shakespeare", "Hamlet", "Mozart", "Napoleon", "Rome", "Roman", "Romans", "Paris", "Egypt", "Egyptian", "Viking", "Vikings", "Christmas", "Netflix", "Bluetooth", "PowerPoint", "Excel", "Zoom", "LinkedIn", "Slack", "Uber", "Spotify", "Instagram", "Tinder", "Starbucks", "Amazon", "Ikea", "Gmail", "Wendy", "Duolingo", "Venmo", "Airbnb", "Wordle"]);
/** Phrases every Chog leans on when it has nothing; one use per file at most. */
const CRUTCHES = [/\bwrite that down\b/i, /\bplot twist\b/i, /\bjust saying\b/i, /\bcalled it\b/i, /\bi predicted\b/i, /\bnoted\b/i, /\bfor science\b/i, /\bno notes\b/i, /\bin this economy\b/i, /\bliterally\b/i, /\bvibes?\b/i, /\bunhinged\b/i, /\bmain character\b/i, /\bit'?s giving\b/i, /\bslay\b/i, /\bbestie\b/i];

/** Everyday words that may repeat freely; anything else in more than fifteen lines is a tic. */
const COMMON = new Set(
  "that with your have it's they this what when just like about from them then there their will been into only more some very over even still back time yours you're i've i'll don't can't never every nine minutes minute you've isn't it'll that's what's here where which while would could should because before after again also always being doing does going gets make made much most need know knew said says something anything nothing everyone someone today tonight morning night first last next really right through these those than other onto under around away down well once ever okay sure each such same both took take takes come came went want look looks thing things good great little long whole half part keep kept left tell told call called calls calling please thank thanks yeah let's we're they're i'm word words week chog chogs you'd we'll there's here's didn't doesn't wasn't won't haven't you'll".split(
    " ",
  ),
);

const wordsOf = (text) => text.replace(/\{[A-Za-z]+\}/g, "X").split(/\s+/).filter(Boolean);

function lineProblems(text, where, rules = {}) {
  const out = [];
  const say = (msg) => out.push(`${where}: ${msg}: "${text}"`);
  if (typeof text !== "string" || !text.trim()) return [`${where}: empty line`];
  for (const slot of text.matchAll(/\{([^}]*)\}/g)) if (!SLOTS.includes(slot[1])) say(`unknown slot {${slot[1]}}`);
  if (/\[[^\]]*\]/.test(text)) say("no audio tags in lines (the voice adds its own)");
  if (BANNED.test(text)) say(`banned word "${text.match(BANNED)[0]}"`);
  if (JARGON.test(text)) say(`jargon "${text.match(JARGON)[0]}" (nobody laughs at the protocol; use the culture)`);
  if (SIMILE.test(text)) say(`"${text.match(SIMILE)[0]}" bolts web3 on as a comparison; make it the joke itself`);
  if (CLICHES.test(text)) say(`cliché "${text.match(CLICHES)[0]}"`);
  if (WEAK_END.test(text.trim())) say("trails off after the laugh; end on the funny word");
  if (/[—–]|--/.test(text)) say("no dashes; use a full stop or a comma");
  if (/\p{Extended_Pictographic}|#/u.test(text)) say("no emoji or hashtags");
  if (rules.voiced && !voiced(text)) say("recorded in the studio voice, so no slots here but {Name}");
  if (/^\{(event|when|soon)\}/.test(text)) say("opens with the event, which gives the joke away; start inside the joke and name it later");
  if (rules.noLabel && voiced(text) && labelOpener(text)) say("opens by announcing the moment, which the screen already shows; start inside the joke");
  if (/.\{Name\}/s.test(text)) say("{Name} only opens a line (it fills as \"Sam, \" or nothing)");
  if (rules.maxChars && text.length > rules.maxChars) say(`too long for the ringing screen (${text.length} characters, max ${rules.maxChars})`);
  if (/^incoming\b/i.test(text)) say("never open with \"Incoming\"");
  const n = wordsOf(text).length;
  const max = rules.maxWords ?? 18;
  const min = rules.minWords ?? 4;
  if (n > max) say(`too long (${n} words, max ${max})`);
  if (n < min) say(`too short (${n} words, min ${min})`);
  if (/\{(when|clock|soon)\}[.!?]?$/.test(text.trim())) say("the time is never the last word; end on the laugh");
  // People type titles as verbs ("Call mom", "Pick up kids"), so the title stands on its own:
  // "{event} at {when}." or "{event}: ...", never "at {event}" or "for {event}".
  if (/\b(at|for|during|in|to|before|after|from|on|with|of|about)\s+\{event\}/i.test(text)) say("a word in front of {event} breaks on titles like 'Call mom'; let the title stand alone");
  // {when} is a bare clock ("two", "half past nine"): it needs "at", "by", "around" or "until" in front.
  if (/\{when\}/.test(text) && !/\b(at|by|around|until|till|from)\s+\{when\}/i.test(text)) say("{when} needs 'at', 'by', 'around' or 'until' in front of it");
  if (rules.needs && !rules.needs.every((slot) => text.includes(`{${slot}}`))) say(`must use ${rules.needs.map((s) => `{${s}}`).join(" and ")}`);
  if (rules.noEvent && EVENT_SLOTS.test(text)) say("no {event}/{when}/{soon} here");
  if (rules.forbid) for (const slot of rules.forbid) if (text.includes(`{${slot}}`)) say(`no {${slot}} here`);
  // Invented names: a capitalised word mid-sentence that isn't on the allow list.
  const sentences = text.replace(/\{[A-Za-z]+\}/g, "x").split(/(?<=[.!?])\s+/);
  for (const sentence of sentences) {
    const ws = sentence.replace(/^[^A-Za-z']+/, "").split(/\s+/).slice(1);
    for (const w of ws) {
      const bare = w.replace(/^[^A-Za-z']+|[^A-Za-z'-]+$/g, "");
      const known = [bare, bare.replace(/'s$/, ""), bare.replace(/s$/, "")].some((word) => CAPS_OK.has(word));
      if (/^[A-Z][a-z]/.test(bare) && !known) say(`capitalised "${bare}" mid-sentence (an invented name?)`);
    }
  }
  // Staccato: more than two one- or two-word sentences reads as a formula.
  const tiny = sentences.filter((s) => wordsOf(s).length <= 2).length;
  if (tiny > 2) say("too many one- or two-word sentences; vary the rhythm");
  if (sentences.filter((s) => s.trim()).length > 3) say("more than three sentences; a joke on the phone is setup, turn, laugh");
  return out;
}

function list(value, where, count, rules, problems) {
  if (!Array.isArray(value)) {
    problems.push(`${where}: missing list`);
    return [];
  }
  if (value.length !== count) problems.push(`${where}: wants ${count} lines, has ${value.length}`);
  value.forEach((text, i) => problems.push(...lineProblems(text, `${where}[${i}]`, rules)));
  return value.filter((text) => typeof text === "string");
}

/** Every problem in one archetype's joke file, as readable strings. Empty means it passes. */
export function checkBank(bank, archetype) {
  const problems = [];
  const all = [];
  const add = (lines) => all.push(...lines);
  if (!bank || typeof bank !== "object") return ["not a JSON object"];
  if (bank.archetype !== archetype) problems.push(`archetype is "${bank.archetype}", expected "${archetype}"`);

  // A list needs enough voiced lines (recorded in the studio voice) and enough that name the event (live voice).
  const atLeast = (lines, where, n, test, what) => {
    if (lines.filter(test).length < n) problems.push(`${where}: at least ${n} line(s) must ${what}`);
  };
  const named = (...slots) => (t) => slots.every((slot) => t.includes(`{${slot}}`));
  add(list(bank.intro, "intro", COUNTS.intro, { noEvent: true, voiced: true }, problems));
  // The ring caption and the snooze line are shown as written, so they take no slots at all.
  add(list(bank.ring, "ring", COUNTS.ring, { noEvent: true, maxWords: 10, minWords: 3, maxChars: 46, forbid: SLOTS }, problems));
  const wake = list(bank.wake, "wake", COUNTS.wake, { noLabel: true }, problems);
  add(wake);
  atLeast(wake, "wake", 5, voiced, "be voiced (no slot but {Name})");
  atLeast(wake, "wake", 2, named("event", "when"), "use {event} and {when} (the live voice names the day)");
  const anyHour = /\bmorning\b|\bbreakfast\b|\bcoffee\b|\bdawn\b|\bsunrise\b|\bslept\b|\basleep\b|\btoday\b|\ball day\b|rise and shine|before coffee|since dawn/i;
  atLeast(wake, "wake", 3, (t) => voiced(t) && !anyHour.test(t), "be voiced and work at any hour (a test ring at 9 pm), with no morning words");
  add(list(bank.snooze, "snooze", COUNTS.snooze, { noEvent: true, forbid: SLOTS, maxWords: 12, noLabel: true }, problems));
  const voicemail = list(bank.voicemail, "voicemail", COUNTS.voicemail, { noLabel: true }, problems);
  add(voicemail);
  atLeast(voicemail, "voicemail", 4, voiced, "be voiced (no slot but {Name})");
  atLeast(voicemail, "voicemail", 2, named("event"), "use {event}");
  add(list(bank.absence, "absence", COUNTS.absence, { voiced: true, noLabel: true }, problems));
  for (const who of ["owner", "stranger"]) {
    const lines = list(bank[who], who, COUNTS[who], {}, problems);
    add(lines);
    atLeast(lines, who, 2, voiced, "be voiced (no slot but {Name})");
    atLeast(lines, who, 1, named("event", "when"), "use {event} and {when}");
  }
  const recall = list(bank.recall, "recall", COUNTS.recall, {}, problems);
  add(recall);
  recall.forEach((t, i) => {
    if (!RECALL_SLOTS.test(t)) problems.push(`recall[${i}]: must use one of {snoozes} {skipped} {attended} {streak} {fact} {habit}: "${t}"`);
  });
  for (const slot of ["snoozes", "skipped", "fact"]) {
    if (!recall.some((t) => t.includes(`{${slot}}`))) problems.push(`recall: at least 1 line must use {${slot}}`);
  }
  const now = list(bank.now, "now", COUNTS.now, {}, problems);
  add(now);
  atLeast(now, "now", 1, voiced, "be voiced (no slot but {Name})");
  atLeast(now, "now", 1, named("event"), "use {event}");
  add(list(bank.calendarFree, "calendarFree", COUNTS.calendarFree, { noEvent: true, maxWords: 14, needs: ["day"] }, problems));

  // A phase is hours long ("day" runs from half past eleven to five), so a line never says the clock.
  const clockTime = /\b(o'clock|half past|quarter (past|to)|\d{1,2}(:\d\d)? ?(am|pm))\b|^(midnight|midday|noon)\b|\bat (midnight|midday|noon)\b/i;
  for (const phase of PHASES) {
    const lines = list(bank.time?.[phase], `time.${phase}`, COUNTS.time, { voiced: true, noLabel: true }, problems);
    add(lines);
    for (const text of lines) if (clockTime.test(text)) problems.push(`time.${phase}: says a clock time, but the phase is hours long: "${text}"`);
  }
  for (const day of DAYS) add(list(bank.days?.[day], `days.${day}`, COUNTS.days, { voiced: true, noLabel: true }, problems));
  for (const kind of WEATHER) add(list(bank.weather?.[kind], `weather.${kind}`, COUNTS.weather, { voiced: true, noLabel: true }, problems));
  for (const kind of EVENT_KINDS) {
    const block = bank.events?.[kind];
    const ahead = list(block?.ahead, `events.${kind}.ahead`, COUNTS.ahead, { noLabel: true }, problems);
    add(ahead);
    atLeast(ahead, `events.${kind}.ahead`, 2, voiced, `be voiced: about this kind of event (${kind}) without naming it`);
    atLeast(ahead, `events.${kind}.ahead`, 1, named("event", "when"), "use {event} and {when}");
    const soon = list(block?.soon, `events.${kind}.soon`, COUNTS.soon, { noLabel: true }, problems);
    add(soon);
    atLeast(soon, `events.${kind}.soon`, 1, voiced, `be voiced: about this kind of event (${kind}) without naming it`);
    atLeast(soon, `events.${kind}.soon`, 1, named("event", "soon"), "use {event} and {soon}");
    // The Today panel lists the event right under this line, so the line never names it.
    add(list(block?.peek, `events.${kind}.peek`, COUNTS.peek, { maxWords: 14, forbid: ["event", "when", "soon"] }, problems));
  }

  // Pokes are recorded too: a line names the crown or the hoodie in words, never with {hat} or {body}.
  const zones = { hat: HEADS, face: EYES, collar: BODIES };
  for (const [zone, kinds] of Object.entries(zones)) {
    const pokes = bank.pokes?.[zone];
    add(list(pokes?.any, `pokes.${zone}.any`, COUNTS.pokeAny, { voiced: true, maxWords: 14 }, problems));
    for (const kind of kinds) add(list(pokes?.[kind], `pokes.${zone}.${kind}`, COUNTS.pokeKind, { voiced: true, maxWords: 14 }, problems));
  }

  // Duplicates, and phrases leaned on across the file.
  const seen = new Map();
  for (const text of all) {
    const key = text.toLowerCase().replace(/[^a-z{} ]/g, "").replace(/\s+/g, " ").trim();
    if (seen.has(key)) problems.push(`duplicate line: "${text}"`);
    seen.set(key, true);
  }
  for (const crutch of CRUTCHES) {
    const hits = all.filter((t) => crutch.test(t));
    if (hits.length > 1) problems.push(`leans on "${hits[0].match(crutch)[0]}" ${hits.length} times (once at most): ${hits.map((t) => `"${t}"`).join(" | ")}`);
  }
  // A signature word is good; the same word in every other line is a tic ("darling", "biscuit", "the elders").
  const counts = new Map();
  for (const text of all) {
    const words = new Set(text.replace(/\{[A-Za-z]+\}/g, " ").toLowerCase().match(/[a-z][a-z']+/g) ?? []);
    for (const word of words) if (word.length >= 4 && !COMMON.has(word)) counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  for (const [word, count] of counts) if (count > 12) problems.push(`"${word}" is in ${count} lines (twelve at most; a signature word turns into a tic)`);
  // The mix: real life plus web3. Half the lines at least carry the web3 turn, and no phrase is a tic.
  const spiced = all.filter((t) => WEB3.some((rule) => rule.test(t)));
  if (spiced.length * 2 < all.length) problems.push(`only ${spiced.length} of ${all.length} lines carry a web3 turn (half at least)`);
  for (const rule of WEB3) {
    const hits = all.filter((t) => rule.test(t));
    if (hits.length > 3) problems.push(`"${hits[0].match(rule)[0]}" appears in ${hits.length} lines (three at most)`);
  }
  const grams = new Map();
  for (const text of all) {
    const ws = wordsOf(text.toLowerCase().replace(/[^a-z{}' ]/g, " "));
    const mine = new Set();
    for (let i = 0; i + 4 <= ws.length; i++) mine.add(ws.slice(i, i + 4).join(" "));
    for (const g of mine) grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  for (const [g, count] of grams) if (count > 2 && !/^(x x|at x|x at x)/.test(g)) problems.push(`the phrase "${g}" appears in ${count} lines (twice at most)`);
  const openers = new Map();
  for (const text of all) {
    const first = wordsOf(text.toLowerCase()).slice(0, 2).join(" ");
    openers.set(first, (openers.get(first) ?? 0) + 1);
  }
  for (const [first, count] of openers) if (count > 5) problems.push(`${count} lines open with "${first}" (five at most)`);
  return problems;
}

function main(files) {
  let bad = 0;
  for (const file of files) {
    const archetype = path.basename(file, ".json");
    let bank;
    try {
      bank = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      console.log(`${file}: not valid JSON (${error.message})`);
      bad += 1;
      continue;
    }
    const problems = checkBank(bank, archetype);
    const lines = JSON.stringify(bank).match(/"[^"]*"/g)?.length ?? 0;
    if (problems.length) {
      bad += problems.length;
      console.log(`${file}: ${problems.length} problem(s)`);
      for (const p of problems) console.log(`  - ${p}`);
    } else {
      console.log(`${file}: OK (${lines} strings)`);
    }
  }
  process.exit(bad ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main(process.argv.slice(2));
