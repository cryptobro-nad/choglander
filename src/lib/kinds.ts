// What kind of thing an event or a trait is, so a line can be about it and not about anything.
// A line written for the dentist knows about flossing; a line written for a crown knows it's a crown.

export const EVENT_KINDS = [
  "meeting",
  "big",
  "focus",
  "health",
  "workout",
  "food",
  "social",
  "family",
  "errand",
  "travel",
  "rest",
  "other",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const HEAD_KINDS = ["beanie", "cap", "crown", "horns", "helmet", "hair", "band", "hat", "odd", "none"] as const;
export type HeadKind = (typeof HEAD_KINDS)[number];

export const BODY_KINDS = ["suit", "costume", "hoodie", "tee", "robe", "jacket", "armor", "none"] as const;
export type BodyKind = (typeof BODY_KINDS)[number];

export const EYES_KINDS = ["glasses", "smiling", "sleepy", "wide", "narrow"] as const;
export type EyesKind = (typeof EYES_KINDS)[number];

/** Whole words, so "gym" is not found in "gymnastics" and "run" is not found in "brunch". */
const words = (list: string) => new RegExp(`\\b(${list})\\b`, "i");

/**
 * First match wins, so the order matters: an errand "run" or a "school run" before a workout run,
 * an investor "meeting" before a meeting, lunch before the team it is with.
 */
const EVENT_RULES: Array<[EventKind, RegExp]> = [
  ["errand", words("bakery run|supply run|beer run|grocery run|groceries|grocery|shopping|supermarket|laundry|bins?|bin day|recycling|trash|garbage|cleaning|clean|hoover|vacuum|dishes|ironing|haircut|barber|hairdresser|nails|pharmacy|chemist|post office|parcel|package|bank|dmv|mechanic|car wash|oil change|plumber|electrician|landlord|delivery|chores?|errands?|pick up|repair|iron|tidy|bakery|butcher|market")],
  ["family", words("school run|mom|mum|mother|dad|father|parents|grandma|grandpa|granny|nan|kids?|children|son|daughter|sister|brother|family|in-laws|aunt|uncle|cousin|nursery|daycare|pickup|drop off|school")],
  ["health", words("dentist|dental|doctor|gp|dr|checkup|check-up|physio|physiotherapy|therapy|therapist|counsell?ing|clinic|hospital|appointment|vet|optician|eye test|vaccine|jab|blood test|scan|x-ray|surgery|orthodontist|dermatologist")],
  ["big", words("interview|pitch|investors?|presentation|present|demo|exam|test|audition|speech|deadline|launch|board|performance review|appraisal|defen[cs]e|viva|court|hearing|negotiation|offer|final|finals|keynote|recital|premiere|opening night")],
  ["food", words("lunch|dinner|breakfast|brunch|coffee|tea|cook|cooking|meal|meal prep|eat|snack|pizza|sushi|burger|tacos|bbq|barbecue|restaurant|cafe|café|picnic|supper|dessert|cake")],
  ["meeting", words("standup|stand-up|stand up|meeting|sync|call|1:1|1-1|one on one|one-on-one|catch up|catch-up|check-in|check in|retro|retrospective|planning|review|all hands|all-hands|town hall|huddle|zoom|teams|scrum|sprint|kickoff|kick-off|workshop|briefing|webinar|team")],
  ["focus", words("deep work|focus|write|writing|study|studying|homework|revision|revise|code|coding|design|essay|thesis|report|admin|emails?|inbox|paperwork|taxes|invoices?|budget|research|reading|practice|draft|edit|editing")],
  ["workout", words("gym|run|running|jog|jogging|5k|10k|marathon|yoga|pilates|swim|swimming|cycle|cycling|bike|spin|workout|work out|training|football|soccer|tennis|padel|squash|climb|climbing|bouldering|hike|hiking|boxing|crossfit|lift|lifting|leg day|stretch|dance class|zumba|walk")],
  ["social", words("drinks|party|date|birthday|wedding|bar|pub|hang|hangout|friends?|book club|club|game night|quiz|concert|gig|movie|movies|cinema|film|theatre|theater|festival|karaoke|show|reunion|housewarming|bbq|dinner party|games")],
  ["travel", words("flight|fly|plane|train|airport|station|trip|travel|drive|driving|commute|bus|uber|taxi|ferry|pack|packing|check-in|hotel|road trip|holiday travel|layover|boarding")],
  ["rest", words("nap|sleep|lie in|lie-in|spa|massage|meditation|meditate|rest|day off|holiday|vacation|chill|me time|bath|sauna")],
];

/** The kind of event a calendar title is. Unknown titles are "other", and get lines that never pretend to know. */
export function eventKind(title: string | null | undefined): EventKind {
  const text = (title ?? "").trim();
  if (!text) return "other";
  for (const [kind, rule] of EVENT_RULES) if (rule.test(text)) return kind;
  return "other";
}

const HEAD_RULES: Array<[HeadKind, RegExp]> = [
  ["beanie", /beanie/i],
  ["helmet", /helmet/i],
  ["crown", /crown|wreath|thorn|holy seal|halo|tiara/i],
  ["horns", /\bhorn/i],
  ["band", /headband|bandana|head wrap|wrap/i],
  ["hair", /hair|wig|durag/i],
  ["hat", /\bhat\b|russian|mafia/i],
  ["cap", /\bcap\b|plumber|mcga|mmga/i],
];

/** What sits on the Chog's head, as a kind. Odd things (a banana, a mushroom, a laser) are "odd". */
export function headKind(label: string | null | undefined): HeadKind {
  const text = (label ?? "").trim();
  if (!text || /^(none|bare|no)$/i.test(text)) return "none";
  for (const [kind, rule] of HEAD_RULES) if (rule.test(text)) return kind;
  return "odd";
}

const BODY_RULES: Array<[BodyKind, RegExp]> = [
  ["costume", /banana|dragon|shark|toad|astro|duck|mummy|squid|wizard|sci fi|inmate|prisoner|float/i],
  ["armor", /armou?r/i],
  ["suit", /tuxedo|suit|mafia|gangster/i],
  ["robe", /robe|yukata|cape/i],
  ["hoodie", /hoodie/i],
  ["jacket", /jacket|vest|trackset|chinese|coat/i],
];

/** What the Chog wears, as a kind. Shirts, tees, jerseys, tanks and slogans are all "tee". */
export function bodyKind(label: string | null | undefined): BodyKind {
  const text = (label ?? "").trim();
  if (!text || /^(none|bare|no)$/i.test(text)) return "none";
  for (const [kind, rule] of BODY_RULES) if (rule.test(text)) return kind;
  return "tee";
}

// Checked against the art of each eye trait. Happy and XD are drawn shut with a smile, so a joke
// about big eyes never runs on them; Round Crying, Round Tear and Teary are wide open, in tears.
const EYES_RULES: Array<[EyesKind, RegExp]> = [
  ["glasses", /glass|vr|visor|laser|thug|mog|viper/i],
  ["smiling", /happy|\bxd\b/i],
  ["sleepy", /closed|tired|dead|dazed/i],
  ["wide", /round|heart|frog|\bup\b|retard|worried|teary|crying|\btear\b/i],
];

/** How the Chog looks at you: through glasses, shut in a smile, half asleep, wide-eyed, or narrowed (smirks, side-eyes, flat stares). */
export function eyesKind(label: string | null | undefined): EyesKind {
  const text = (label ?? "").trim();
  for (const [kind, rule] of EYES_RULES) if (rule.test(text)) return kind;
  return "narrow";
}
