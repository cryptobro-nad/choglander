import { JOKE_FILES } from "@/lib/jokeFiles";
import { LINE_MAX, decodeLine, encodeLine, sharePagePath } from "@/lib/shareCard";
import { WEEKDAYS } from "@/lib/time";
import { bodyKind, headKind } from "@/lib/kinds";
import { traitLabel } from "@/lib/traits";
import type { Archetype, DisplayTrait } from "@/lib/types";
import { stripAudioTags } from "@/lib/voices";
import { jokesFor, SHIRT_NAMES, wornFits, wornSlots } from "@/lib/writer";

// A share link (/c/<art>/<line>) carries its line in the URL, so anyone can write one. The page only
// shows a line that Chog could really have said: one of its own joke-bank lines (or the app's), with
// its slots filled in. A line in one voice doesn't pass for another Chog. A slot ({Name}, {event},
// {when}, ...) matches a bounded stretch of text, the rest of the line has to be the bank's own
// words, and what went into the slots is checked for phishing bait, read the way a person sees it (a
// fullwidth dot is a dot, a Cyrillic "а" is an "a"). Anything else answers 404.
// This narrows what a forged link can say; it does not close it. A calendar title or a fact is free
// text, so bait spelled out in plain words still fits one. Only a link the app signs would.

/**
 * Lines the app says that are not in a joke bank: the home screen's first caption (ChogApp's
 * FIRST_CAPTION), the snooze line with no bank to pick from, and the writer's safe line (safeBody).
 */
const APP_LINES = ["Tap them. They already have a note.", "Nine more minutes.", "{day}. I had a sharper line and I swallowed it."];

/**
 * The most a slot can hold, in characters, from where its value comes from: a name typed in the app
 * (32, then ", "), a calendar title (60), "skipped <title>" notes, a fact as factClause says it back
 * (90 and the "you" it gains), a trait as the writer says it ("toad green suit", "wizard hat").
 */
const SLOT_MAX: Record<string, number> = {
  Name: 34,
  event: 60,
  when: 24,
  soon: 24,
  clock: 32,
  sky: 40,
  wear: 40,
  hat: 40,
  body: 40,
  fact: 110,
  habit: 80,
  streak: 24,
  skipped: 60,
  attended: 60,
  snoozes: 24,
};
/** A slot the table doesn't know. */
const SLOT_DEFAULT = 24;

/** Slots with a fixed set of values: the weekday (the server says "Today" when it got none), and "a"/"an". */
const SLOT_CHOICES: Record<string, readonly string[]> = {
  day: [...WEEKDAYS, "Today"],
  "~n": ["", "n"],
};

/** The weather as the app says it: "fogged in at -3 degrees". */
const SPOKEN = /^[\p{L}\p{N} '-]*$/u;
/** A time as time.ts says one (spokenWhen, spokenClock): "twenty-five past six", "quarter to seven", "noon". */
const TIME = "(?:(?:(?:five|ten|quarter|twenty|twenty-five|half) (?:past|to) )?(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)|noon|midnight)";
/**
 * What a slot the app fills itself can look like. A name is said "Sam, " (or not at all); a trait is
 * words from the collection's metadata; times, waits and counts are the writer's own words (softWait,
 * habitPhrase, streakOf, recallOf). Calendar titles and facts are free text: BAIT is what stands
 * between them and a phishing line.
 */
const SLOT_SHAPE: Record<string, RegExp> = {
  Name: /^(?:[\p{L}\p{M}\p{N}\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}️ '’.&_()+-]+, )?$/u,
  when: new RegExp(`^${TIME}$`, "i"),
  clock: new RegExp(`^${TIME}$`, "i"),
  habit: new RegExp(`^usually up around ${TIME}$`, "i"),
  soon: /^(?:on right now|tomorrow|coming up|any minute now|in a few minutes|in about half an hour|within the hour|in an hour or two|later today)$/i,
  streak: /^[a-z0-9-]+ mornings$/i,
  snoozes: /^(?:once|twice|[a-z0-9-]+ times)$/i,
  sky: SPOKEN,
  wear: /^[\p{L}\p{M}\p{N} :'-]*$/u,
  hat: /^[\p{L}\p{M}\p{N} :'-]*$/u,
  body: /^[\p{L}\p{M}\p{N} :'-]*$/u,
};

/** Endings of the addresses bait points at, spelled out after a spaced dot or "dot" ("chogmint dot xyz"). */
const TLD = "(?:com|net|org|io|xyz|gg|ly|cc|ru|cn|biz|info|nft|eth|wtf|sbs|cfd)";

/**
 * Never in a line anywhere, as it reads (see readings): an address, a URL, a wallet. No bank line has
 * one. A dot spaced out, bracketed or spelled "dot" is still a dot.
 */
const LINK = [
  /:\/\//,
  /\bwww\b/,
  /[a-z0-9]\.[a-z]{2,}\b/,
  /[a-z0-9] +\.[a-z]{2,}\b/,
  new RegExp(`[a-z0-9]\\. +${TLD}\\b`),
  /[a-z0-9] *[[({<] *(?:\.|dot) *[\])}>] *[a-z]{2,}/,
  new RegExp(`[a-z0-9] +dot +${TLD}\\b`),
  /\b0x[0-9a-f]{4,}/,
];

/**
 * Never in what a slot holds, in any of its readings. The bank's own lines joke about seed phrases and
 * connect wallet, so these are only checked against the words that went into the slots (a name, a
 * calendar title, a fact). Words a calendar has for other reasons ("Buy a new wallet", "Expense
 * claims") are bait only in the phrase that asks for something.
 */
const BAIT = [
  /@[a-z0-9_]/,
  /\$[a-z]{2,}/,
  /\b(?:connect|link|sync|verify|validate|import|restore|unlock|approve|authori[sz]e|recover|migrate|revoke|sign|enter|paste|share|send)\w*\s+(?:\w+\s+){0,2}wallets?\b/,
  /\bwallets?\s+(?:connect|verif|sync|validat|drain|address|seed|key)/,
  /\b(?:seed|secret|recovery) ?phrases?\b/,
  /\bprivate ?keys?\b/,
  /\bairdrops?\b/,
  /\bclaim(?:s|ing)?\s+(?:your|ur|yours|now|free|it|here|this|\d)/,
  /\bgiveaways?\b/,
  /\bfree\s+(?:mints?|mon|chogs?|eth|btc|sol|nfts?|tokens?|crypto|coins?|money|cash)\b/,
  /\bmint(?:ing)?\s+(?:is\s+)?(?:now|live|today|tonight|here|link|open)\b/,
  /\b(?:white|allow) ?list(?:ed)?\s+(?:spots?|slots?|access|mint|open|live|now|here|form|link)\b/,
  /\b(?:get|got|be|join|claim|secure|grab|guaranteed|free)\s+(?:\w+\s+)?(?:white|allow) ?list/,
  /\bholders?\s+(?:only|get|can|must|need|should|will)\b/,
  /\b(?:all|attention|dear|calling|chog|nft) holders\b/,
  /\bpresales?\b/,
  /\bdms?[\W\d_]*\b(?:me|us|them|him|her)\b/,
  /\b(?:recovery|seed|secret|backup|mnemonic|wallet)\s+(?:words?|codes?)\b/,
  /\b(?:twelve|12|twenty[\s-]?four|24)[\s-]+(?:\w+[\s-]+)?words?\b/,
  /\bmnemonic\b/,
  /\b(?:refund|reimburse)\w*\b.*\b(?:if|when|once)\s+(?:you|u)\b/,
  /\b(?:refund|reimburse|compensat)\w*\b.{0,30}\bholders?\b/,
  /\b(?:message|pm|inbox)\s+(?:me|us)\b/,
  // Taking the talk to a chat app: its name said as a verb ("Telegram me") or as where to find someone
  // ("Text me on WhatsApp", "Add me on Telegram", "Join our Discord"). A handle with it has an "@",
  // bait anywhere. Texting is ordinary, and Signal and Discord are words too: "Text me when you land",
  // "Signal us at the gate" and "Join the Discord call" are plans, so those two are bait as a verb
  // only with nothing after it.
  /\b(?:telegram|whats\W?app)\s+(?:me|us)\b/,
  /\b(?:signal|discord)\s+(?:me|us)\b(?![^\S\n]*\w)/,
  /\b(?:message|msg|text|txt|reach|contact|find|add|ping|dm)\s+(?:(?:me|us)\s+)?(?:on|via)\s+(?:telegram|whats\W?app|signal|discord)\b/,
  /\bjoin\s+(?:our|my|the)\s+(?:telegram|whats\W?app|signal|discord)\b(?!\s+(?:voice\s+)?(?:call|calls|meeting|meetup|hangout|stream)\b)/,
  // "Send 1 MON to get 2 back": the doubling scam.
  /\b(?:send|deposit|transfer)\s+(?:\$?\d[\d.,]*|one|two|five|ten)\b.{0,30}?\b(?:get|receive)\s+(?:\$?\d[\d.,]*|double|twice|two|back)\b/,
];

/**
 * Letters that pass for Latin ones (Cyrillic, Greek, Armenian and Cherokee lookalikes, small capitals)
 * and signs that pass for a dot, a slash or a colon. Fullwidth forms, mathematical letters and the
 * like need no entry: NFKD already reads them as the plain letter.
 */
const LOOKALIKE: Record<string, string> = {
  а: "a", в: "b", е: "e", һ: "h", і: "i", ј: "j", к: "k", м: "m", о: "o", п: "n", р: "p", с: "c", т: "t", у: "y", х: "x", ѕ: "s", ԁ: "d", ԛ: "q", ԝ: "w", ӏ: "l", ү: "y",
  А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", Х: "X", У: "Y", І: "I", Ј: "J", Ѕ: "S", Ԛ: "Q", Ԝ: "W", Ӏ: "I", Ү: "Y",
  α: "a", γ: "y", ε: "e", ι: "i", κ: "k", ν: "v", ο: "o", ρ: "p", τ: "t", υ: "u", χ: "x", ω: "w",
  Α: "A", Β: "B", Ε: "E", Ζ: "Z", Η: "H", Ι: "I", Κ: "K", Μ: "M", Ν: "N", Ο: "O", Ρ: "P", Τ: "T", Υ: "Y", Χ: "X",
  օ: "o", ս: "u", հ: "h", ո: "n", ց: "g", զ: "q", Ս: "U", Օ: "O",
  Ꭺ: "A", Ᏼ: "B", Ꮯ: "C", Ꭼ: "E", Ꮐ: "G", Ꮋ: "H", Ꭵ: "i", Ꭻ: "J", Ꮶ: "K", Ꮮ: "L", Ꮇ: "M", Ꮲ: "P", Ꮪ: "S", Ꭲ: "T", Ꮩ: "V", Ꮃ: "W", Ꮓ: "Z",
  ᴀ: "a", ʙ: "b", ᴄ: "c", ᴅ: "d", ᴇ: "e", ɢ: "g", ʜ: "h", ɪ: "i", ᴊ: "j", ᴋ: "k", ʟ: "l", ᴍ: "m", ɴ: "n", ᴏ: "o", ᴘ: "p", ʀ: "r", ꜱ: "s", ᴛ: "t", ᴜ: "u", ᴠ: "v", ᴡ: "w", ʏ: "y", ᴢ: "z", ɡ: "g", ı: "i", ȷ: "j",
  "。": ".", "︒": ".", "·": ".", "•": ".", "∙": ".", "⋅": ".", "・": ".", "‧": ".", "⸱": ".",
  "∕": "/", "⁄": "/", "꞉": ":", ː: ":",
};
const LOOKALIKES = new RegExp(`[${Object.keys(LOOKALIKE).join("")}]`, "gu");

/** The text without what nobody sees: compatibility forms unfolded ("．" is "."), accents and other marks, invisible format characters. */
function bare(text: string): string {
  return text.normalize("NFKD").replace(/[\p{M}\p{Cf}]/gu, "");
}

/** A word of Latin letters with a letter from another script in it: "wаllet" with a Cyrillic "а". */
function mixesScripts(text: string): boolean {
  return (text.match(/[\p{L}\p{N}]+/gu) ?? []).some(
    (word) => /\p{sc=Latin}/u.test(word) && /[^\P{L}\p{sc=Latin}\p{sc=Common}\p{sc=Inherited}]/u.test(word),
  );
}

/**
 * The ways a text reads, lowercased: as it looks (lookalike letters as the Latin ones they pass for),
 * then with digits and signs read as the letters they stand in for, a "1" or "I" as an "l" ("cIaim",
 * "wa11et") and a "1" as an "i" ("a1rdrop").
 */
function readings(text: string): string[] {
  const seen = bare(text).replace(LOOKALIKES, (ch) => LOOKALIKE[ch]);
  const letters = (s: string) => s.replace(/0/g, "o").replace(/3/g, "e").replace(/[4@]/g, "a").replace(/[5$]/g, "s").replace(/7/g, "t");
  // Single letters split by anything but letters read as one word: "D M me", "D.M. me" and "D-M me"
  // are "DM me". A slot's edge (the "\n" slotText leaves for bank words) still keeps them apart.
  const run = /(?<!\p{L})\p{L}(?:[^\p{L}\n]+\p{L}(?!\p{L}))+[^\p{L}\s]*/gu;
  const glue = (text: string) => text.replace(/\P{L}/gu, "");
  const joined = seen.replace(run, glue);
  // A single letter just before joins the run too and hides the word in it ("Q: D M me" is "QDM me",
  // "w/ D. M. me" is "wDM me"), so each run is also read broken before each of its letters: "Q DM me".
  const broken = [...seen.matchAll(run)].flatMap((match) => {
    const chars = Array.from(glue(match[0]));
    const [before, after] = [seen.slice(0, match.index), seen.slice(match.index + match[0].length)];
    return chars.slice(1).map((_, i) => `${before}${chars.slice(0, i + 1).join("")} ${chars.slice(i + 1).join("")}${after}`);
  });
  return [seen, joined, ...broken, letters(seen.replace(/[I1|!]/g, "l")), letters(seen.replace(/[1|!]/g, "i"))].map((s) => s.toLowerCase());
}

/** Whether what went into the slots is bait, in any of the ways it reads. */
function baited(slots: string): boolean {
  return readings(slots).some((reading) => BAIT.some((pattern) => pattern.test(reading)));
}

type Slot = { slot: string; max: number; choices?: readonly string[]; shape?: RegExp };
type Token = string | Slot;
/** `source`: the bank line it was made from. `shirt`: a collar line's "tee" said as the art's jersey, tank top or polo (writer asWorn). */
type Template = { tokens: Token[]; anchor: string; source: string; shirt?: string };

/** "Up at {when}." as "Up at tomorrow {when}." the way the writer says an event tomorrow (writer.ts fill). */
function tomorrow(text: string): string {
  return text
    .replace(/\b(at|around|by) \{when\}/g, "tomorrow $1 \u0001")
    .replaceAll("{when}", "\u0001 tomorrow")
    .replaceAll("\u0001", "{when}");
}

function compile(text: string, from = text, shirt?: string): Template {
  // "a {wear}" is said "an Orb Cap" when the item starts with a vowel.
  const source = stripAudioTags(text.replace(/\b([Aa]) \{(wear|hat|body)\}/g, "$1{~n} {$2}"));
  const tokens: Token[] = [];
  let anchor = "";
  source.split(/\{(~?[A-Za-z]+)\}/).forEach((part, index) => {
    if (index % 2 === 1) {
      tokens.push({ slot: part, max: SLOT_MAX[part] ?? SLOT_DEFAULT, choices: SLOT_CHOICES[part], shape: SLOT_SHAPE[part] });
      return;
    }
    if (!part) return;
    tokens.push(part);
    for (const word of part.split(" ")) if (word.length > anchor.length) anchor = word;
  });
  return { tokens, anchor: anchor.toLowerCase(), source: from, ...(shirt ? { shirt } : {}) };
}

/** Who says a line: one Chog, in its own voice, or the app, whose lines any Chog says. */
export type Speaker = Archetype | "app";

/** Lines kept after they left the banks, by who said them (src/lib/shareLines.json). */
export type LineArchive = Partial<Record<Speaker, readonly string[]>>;

const NO_ARCHIVE: LineArchive = {};

const banks = new Map<Speaker, string[]>();

/**
 * Every line a Chog can say now, as written (slots unfilled): its joke file's lines and the writer's
 * bank for it. "app": the app's own lines. src/lib/shareLines.json keeps every one that ever shipped.
 */
export function bankLines(speaker: Speaker): string[] {
  const known = banks.get(speaker);
  if (known) return known;
  const texts = new Set<string>(speaker === "app" ? APP_LINES : []);
  if (speaker !== "app") {
    const walk = (value: unknown) => {
      if (typeof value === "string") texts.add(value);
      else if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") for (const [key, inner] of Object.entries(value)) if (key !== "archetype") walk(inner);
    };
    walk(JOKE_FILES[speaker]);
    for (const joke of jokesFor(speaker)) texts.add(joke.text);
  }
  const lines = [...texts];
  banks.set(speaker, lines);
  return lines;
}

/**
 * Lines as templates, each with an event on {when} also said for tomorrow, and a collar line about a
 * tee also said of a jersey, a tank top or a polo, the way the live voice says it of one (writer asWorn).
 */
function templatesOf(texts: Iterable<string>): Template[] {
  const out: Template[] = [];
  for (const text of new Set(texts)) {
    for (const said of new Set([text, ...(text.includes("{when}") ? [tomorrow(text)] : [])])) {
      out.push(compile(said, text));
      if (/\btee\b/i.test(said)) for (const shirt of SHIRT_NAMES) out.push(compile(said.replace(/\btee\b/gi, shirt), text, shirt));
    }
  }
  return out;
}

const current = new Map<Speaker, Template[]>();
const archived = new WeakMap<LineArchive, Map<Speaker, Template[]>>();

/**
 * What a line from `voice` is read against: its lines and the app's as the banks have them now, then
 * the archive's lines of theirs that have left the banks.
 */
function templateSets(voice: Archetype, archive: LineArchive): Template[][] {
  const speakers: Speaker[] = [voice, "app"];
  const sets = speakers.map((speaker) => {
    let now = current.get(speaker);
    if (!now) current.set(speaker, (now = templatesOf(bankLines(speaker))));
    return now;
  });
  let gone = archived.get(archive);
  if (!gone) archived.set(archive, (gone = new Map()));
  for (const speaker of speakers) {
    const kept = archive[speaker];
    if (!kept?.length) continue;
    let left = gone.get(speaker);
    if (!left) {
      const now = new Set(bankLines(speaker));
      gone.set(speaker, (left = templatesOf(kept.filter((text) => !now.has(text)))));
    }
    sets.push(left);
  }
  return sets;
}

/** Where tidy() starts a sentence: the very start, or after ". ", "! " or "? ". Its first letter may be raised there. */
function sentenceStart(line: string, at: number): boolean {
  return at === 0 || (at >= 2 && line[at - 1] === " " && /[.!?]/.test(line[at - 2]));
}

/**
 * Where a literal piece of a template ends in the line from `at`, or -1. Case counts, except for the
 * first letter of a sentence. A space may be missing where tidy() drops one (before a comma or a
 * full stop, at either end, or one of two). `partial`: the line may end inside the piece.
 */
function literalEnd(piece: string, line: string, at: number, partial: boolean): number {
  let j = at;
  for (const want of piece) {
    if (want === " ") {
      if (line[j] === " ") j += 1;
      else if (!(j === 0 || j === line.length || line[j - 1] === " " || ",.!?".includes(line[j]))) return -1;
      continue;
    }
    if (j === line.length) return partial ? j : -1;
    const got = line[j];
    if (got !== want && !(got.toLowerCase() === want.toLowerCase() && sentenceStart(line, j))) return -1;
    j += 1;
  }
  return j;
}

/** The line read through the template: each piece and what it matched, or null when the line doesn't fit it. */
function fit(template: Template, line: string, partial: boolean, worn?: WornSlots): { slot: boolean; text: string }[] | null {
  const { tokens } = template;
  const pieces: { slot: boolean; text: string }[] = [];
  // A place that already failed fails again: (token, position) is all that decides it.
  const dead = new Set<number>();
  const walk = (t: number, i: number): boolean => {
    if (partial && i === line.length) return true;
    if (t === tokens.length) return i === line.length;
    const key = t * (line.length + 1) + i;
    if (dead.has(key)) return false;
    const token = tokens[t];
    if (typeof token === "string") {
      const end = literalEnd(token, line, i, partial);
      if (end >= 0) {
        pieces.push({ slot: false, text: token });
        if (walk(t + 1, end)) return true;
        pieces.pop();
      }
    } else if (token.choices || (worn && isWornSlot(token.slot))) {
      // A slot for what the Chog wears holds what this art wears, said as the writer says it.
      for (const choice of token.choices ?? [worn![token.slot as keyof WornSlots]]) {
        const rest = line.slice(i).toLowerCase();
        const want = choice.toLowerCase();
        const end = rest.startsWith(want) ? i + want.length : partial && want.startsWith(rest) ? line.length : -1;
        if (end < 0) continue;
        pieces.push({ slot: true, text: line.slice(i, end) });
        if (walk(t + 1, end)) return true;
        pieces.pop();
      }
    } else {
      // Shortest first, a character (not a UTF-16 unit) at a time, up to the slot's limit. A value
      // cut off by the end of a shortened line only has to be clean, not whole.
      let end = i;
      for (let count = 0; count <= token.max && end <= line.length; count++) {
        const text = line.slice(i, end);
        if (!token.shape || token.shape.test(text) || (partial && end === line.length)) {
          pieces.push({ slot: true, text });
          if (walk(t + 1, end)) return true;
          pieces.pop();
        }
        if (end === line.length) break;
        end += (line.codePointAt(end) ?? 0) > 0xffff ? 2 : 1;
      }
    }
    dead.add(key);
    return false;
  };
  return walk(0, 0) ? pieces : null;
}

/** What the slots held, run together where only spaces stood between them, so bait can't be split across two. */
function slotText(pieces: { slot: boolean; text: string }[]): string {
  return pieces.map((piece) => (piece.slot ? piece.text : piece.text.trim() ? "\n" : " ")).join("");
}

type WornSlots = ReturnType<typeof wornSlots>;

const isWornSlot = (slot: string) => slot === "wear" || slot === "hat" || slot === "body";

/** Hats and outfits a line can name outright, and the kind the art's trait has to be for it. */
const NAMED_WORN: Array<[RegExp, "Head" | "Body", string]> = [
  [/\barmou?r\b/i, "Body", "armor"],
  [/\bhoodie\b/i, "Body", "hoodie"],
  [/\brobe\b/i, "Body", "robe"],
  [/\btuxedo\b/i, "Body", "suit"],
  [/\bcostume\b/i, "Body", "costume"],
  [/\bcrown\b/i, "Head", "crown"],
  [/\bhelmet\b/i, "Head", "helmet"],
  [/\bbeanie\b/i, "Head", "beanie"],
  [/\bhorns?\b/i, "Head", "horns"],
  [/\bcap\b/i, "Head", "cap"],
];

/**
 * Whether the art wears what the line says it does. A bank line knows what it was written for (writer
 * wornFits): a poke for a crown needs a crown, and a tee said of a jersey is said "jersey". A line kept
 * only in the archive is read for the hats and outfits it names ("Gold armour!"), leaving out the
 * listener's own ("your jersey") and ones it says aren't there ("No hat, no helmet").
 */
function dressed(template: Template, voice: Archetype, traits: DisplayTrait[]): boolean {
  const said = template.shirt ? template.source.replace(/\btee\b/gi, template.shirt) : template.source;
  const known = wornFits(voice, template.source, said, traits);
  if (known !== undefined) return known;
  if (template.shirt) return false;
  // A line about the day names what they (or a passer-by) wear, not the Chog: "Robe on, lights low.
  // {event} is {soon}." and "Keys, bag, the hoodie you pretend is a jacket" fit any outfit.
  if (/\{(?:event|when|soon|sky|day|fact)\}/.test(template.source)) return true;
  const named = template.source.replace(/\b(?:your|no|not a|woolly)\s+\w+/gi, "");
  return NAMED_WORN.every(([words, type, kind]) => !words.test(named) || (type === "Head" ? headKind(traitLabel(traits, "Head")) : bodyKind(traitLabel(traits, "Body"))) === kind);
}

function fits(line: string, partial: boolean, voice: Archetype, archive: LineArchive, traits?: DisplayTrait[]): boolean {
  const lower = line.toLowerCase();
  const worn = traits ? wornSlots(traits) : undefined;
  for (const templates of templateSets(voice, archive)) {
    for (const template of templates) {
      // A cheap first look: the template's longest word has to be in the line (all of it, when it is whole).
      if (!partial && template.anchor && !lower.includes(template.anchor)) continue;
      const pieces = fit(template, line, partial, worn);
      if (pieces && !baited(slotText(pieces)) && (!traits || dressed(template, voice, traits))) return true;
    }
  }
  return false;
}

/**
 * Whether a line (as a share link carries it, after cleanLine) is one a Chog in `voice` could have said:
 * one of its joke-bank lines or one of the app's own, with its slots filled. A line cleanLine cut at
 * LINE_MAX (it ends in "…") only has to be the start of one, and so does a long one the voice server
 * cut at a sentence. `archive`: lines that may have left the banks since a link went out (the server
 * passes shareLines.json). `traits`: the art's, when known (the share page): a line about what the
 * Chog wears has to be about what this one wears.
 */
export function isChogLine(line: string, voice: Archetype, archive: LineArchive = NO_ARCHIVE, traits?: DisplayTrait[]): boolean {
  const text = line.trim();
  if (!text || mixesScripts(bare(text))) return false;
  const [seen] = readings(text);
  if (LINK.some((pattern) => pattern.test(seen))) return false;
  if (fits(text, false, voice, archive, traits)) return true;
  const length = Array.from(text).length;
  if (text.endsWith("…") && length >= LINE_MAX * 0.55) return fits(text.slice(0, -1), true, voice, archive, traits);
  if (/[.!?]$/.test(text) && length >= 128) return fits(text, true, voice, archive, traits);
  return false;
}

/**
 * The link the share sheet gives with a line: its share page on `origin`, or "" when that page would
 * not show the line (it would say "Wrong number", and its link preview would be empty), as for a line
 * the AI writer wrote. The card and the words still go; only the link is left out. `voice`: the
 * Chog's archetype, the one the page reads the line against.
 */
export function sharePageLink(origin: string, artId: number, line: string, voice: Archetype, traits?: DisplayTrait[]): string {
  if (!origin) return "";
  const said = decodeLine(encodeLine(line));
  return said && isChogLine(said, voice, NO_ARCHIVE, traits) ? `${origin}${sharePagePath(artId, line)}` : "";
}
