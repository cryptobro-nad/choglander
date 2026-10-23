import type { Archetype, DisplayTrait } from "@/lib/types";

/**
 * Personality comes from the token's traits, never from a hand-picked list.
 * Each rule reads one trait and votes for the archetypes it fits. The highest
 * total wins; ties go to the earlier archetype in ORDER. archetypeReason()
 * names the traits that voted for the winner, so the meet screen can say why.
 */

type Votes = Partial<Record<Archetype, number>>;
type Rule = { type: string; match: RegExp; votes: Votes };

const ORDER: Archetype[] = [
  "told-you-so",
  "professor",
  "gremlin",
  "hype",
  "soap-star",
  "night-shift",
  "golden",
  "legend",
  "roommate",
];

const RULES: Rule[] = [
  // Eyes: the strongest signal of temperament.
  { type: "Eyes", match: /side eye|^flat$|blue flat|red flat|vertical|^base$|normal eye|^normal$|^up$/i, votes: { "told-you-so": 2 } },
  { type: "Eyes", match: /glass|\bvr\b/i, votes: { professor: 3 } },
  { type: "Eyes", match: /visor/i, votes: { legend: 2, "night-shift": 1 } },
  { type: "Eyes", match: /smirk|thug|angry|viper|clown/i, votes: { gremlin: 3 } },
  { type: "Eyes", match: /fire laser|cyan laser/i, votes: { hype: 2 } },
  { type: "Eyes", match: /purple laser|green laser/i, votes: { legend: 2 } },
  { type: "Eyes", match: /happy|\bxd\b/i, votes: { hype: 2, golden: 1 } },
  { type: "Eyes", match: /heart/i, votes: { golden: 3 } },
  { type: "Eyes", match: /cry|tear|worried/i, votes: { "soap-star": 3 } },
  { type: "Eyes", match: /tired|dead/i, votes: { "night-shift": 3 } },
  { type: "Eyes", match: /round|retard|dazed/i, votes: { roommate: 1, golden: 1 } },
  { type: "Eyes", match: /frog/i, votes: { golden: 2 } },
  { type: "Eyes", match: /\bmog\b/i, votes: { legend: 2 } },

  // Head: what they chose to wear says what they think of you.
  { type: "Head", match: /wizard|3rd eye/i, votes: { "told-you-so": 3 } },
  { type: "Head", match: /peace|star cap|thunder|10k tps|headband|bandana/i, votes: { hype: 3 } },
  { type: "Head", match: /horn|thorn|robber|clown|poison|8 ball/i, votes: { gremlin: 3 } },
  { type: "Head", match: /crown|rainbow wig|bob hair/i, votes: { "soap-star": 2, legend: 1 } },
  { type: "Head", match: /spartan|wreath|holy seal|diamond|mafia|taped banana/i, votes: { legend: 3 } },
  { type: "Head", match: /beanie|durag|neet|russian|head wrap/i, votes: { "night-shift": 2 } },
  { type: "Head", match: /cloud cap|choggie cap/i, votes: { golden: 2 } },
  {
    type: "Head",
    match: /bucket|plumber|jeet|mon cap|chog cap|btc cap|dollar|balls cap|horny cap|tism|boob|buttcoin|mcga|mmga|wagmi|mega chog|retard cap|eth cap/i,
    votes: { roommate: 2 },
  },

  // Body: how they turn up.
  { type: "Body", match: /tuxedo/i, votes: { hype: 1, professor: 1 } },
  { type: "Body", match: /jersey|trackset|six seven|fire shirt/i, votes: { hype: 1, roommate: 1 } },
  { type: "Body", match: /^wizard$|sci fi|astro|ceo vest/i, votes: { professor: 2 } },
  { type: "Body", match: /toad|inmate|prisoner|chug life|boner/i, votes: { gremlin: 2 } },
  { type: "Body", match: /squid game/i, votes: { "night-shift": 2 } },
  { type: "Body", match: /gangster|mafia/i, votes: { legend: 2 } },
  { type: "Body", match: /kings robe|yukata|jesus|pink tuxedo|red tuxedo|chinese/i, votes: { "soap-star": 2 } },
  { type: "Body", match: /hoodie|black shirt|dark |black vest|army vest/i, votes: { "night-shift": 2 } },
  { type: "Body", match: /duck float|shark|banana|farmer|hawaiian|pure shirt|yellow shirt|pink vest|pink shirt/i, votes: { golden: 2 } },
  { type: "Body", match: /\btee\b|shirt|sleeveless|tank|stripe|vest|jacket|bbc|milf|virgin|thots/i, votes: { roommate: 1 } },
  { type: "Body", match: /golden armor|gojo|guko|mummy|wizard cape|dragon/i, votes: { legend: 2 } },

  // Mouth: the delivery.
  { type: "Mouth", match: /lip bite|grit|clown/i, votes: { gremlin: 1 } },
  { type: "Mouth", match: /sad/i, votes: { "soap-star": 2 } },
  { type: "Mouth", match: /worried/i, votes: { "soap-star": 1, "night-shift": 1 } },
  { type: "Mouth", match: /bubblegum|drool/i, votes: { golden: 2 } },
  { type: "Mouth", match: /^wo$|rainbow/i, votes: { hype: 1 } },
  { type: "Mouth", match: /^flat$/i, votes: { "told-you-so": 1, professor: 1 } },
  { type: "Mouth", match: /gold tooth/i, votes: { legend: 2 } },

  // Rarity and the odd ones: some Chogs are simply above it all.
  { type: "Tier", match: /legendary/i, votes: { legend: 4 } },
  { type: "Tier", match: /epic/i, votes: { legend: 2 } },
  { type: "Base", match: /1:1/i, votes: { legend: 4 } },
  { type: "Base", match: /skull/i, votes: { "night-shift": 2 } },
  { type: "Base", match: /radioactive/i, votes: { gremlin: 1, legend: 1 } },
  { type: "Accessory", match: /knife|fwog|pepe/i, votes: { gremlin: 1 } },
  { type: "Accessory", match: /cigar/i, votes: { legend: 1 } },
  { type: "Accessory", match: /heart/i, votes: { golden: 1 } },
  { type: "Aura", match: /rose|pink mist/i, votes: { "soap-star": 1 } },
  { type: "Aura", match: /smoke/i, votes: { "night-shift": 1 } },
  { type: "Aura", match: /royal aura/i, votes: { legend: 1 } },
];

const ZERO = (): Record<Archetype, number> => ({
  "told-you-so": 0,
  hype: 0,
  professor: 0,
  gremlin: 0,
  "soap-star": 0,
  "night-shift": 0,
  golden: 0,
  roommate: 0,
  legend: 0,
});

type Scored = {
  best: Archetype;
  scores: Record<Archetype, number>;
  voters: Array<{ trait: DisplayTrait; weight: number }>;
};

function score(traits: DisplayTrait[]): Scored {
  const scores = ZERO();
  const hits: Array<{ trait: DisplayTrait; votes: Votes }> = [];
  for (const trait of traits) {
    const raw = `${trait.value ?? ""}`.trim();
    if (!raw) continue;
    for (const rule of RULES) {
      if (rule.type !== trait.type || !rule.match.test(raw)) continue;
      hits.push({ trait, votes: rule.votes });
      for (const [key, weight] of Object.entries(rule.votes) as Array<[Archetype, number]>) scores[key] += weight;
    }
  }
  let best: Archetype = "roommate";
  let top = 0;
  for (const key of ORDER) {
    if (scores[key] > top) {
      top = scores[key];
      best = key;
    }
  }
  const voters = hits
    .filter((hit) => (hit.votes[best] ?? 0) > 0)
    .map((hit) => ({ trait: hit.trait, weight: hit.votes[best] ?? 0 }))
    .sort((a, b) => b.weight - a.weight);
  return { best, scores, voters };
}

/** The archetype for a token, from its traits alone. The art id no longer decides anything. */
export function archetypeFrom(artId: number, traits: DisplayTrait[]): Archetype {
  return score(traits).best;
}

/** Score totals per archetype, for tests and for tuning the spread across the collection. */
export function archetypeScores(traits: DisplayTrait[]): Record<Archetype, number> {
  return score(traits).scores;
}

function readable(trait: DisplayTrait): string {
  const label = trait.label.trim();
  if (trait.type === "Eyes" && !/eye|glass|visor|vr|laser/i.test(label)) return `${label} eyes`;
  if (trait.type === "Mouth" && /^(sad|flat|worried|open|smile)$/i.test(label)) return `${label} mouth`;
  if (trait.type === "Tier") return `${label} tier`;
  if (trait.type === "Base") return `${label} base`;
  if (trait.type === "Aura" && !/aura/i.test(label)) return `${label} aura`;
  return label;
}

/**
 * The trait labels that decided this Chog's archetype, strongest first, at most three
 * (for #375: "Wizard Beanie", "Base eyes"). Empty when no trait voted and the Chog
 * fell back to the roommate.
 */
export function archetypeReason(artId: number, traits: DisplayTrait[]): string[] {
  const out: string[] = [];
  for (const voter of score(traits).voters) {
    const label = readable(voter.trait);
    if (out.includes(label)) continue;
    out.push(label);
    if (out.length === 3) break;
  }
  return out;
}
