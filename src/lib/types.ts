import type { AlarmStyle } from "@/lib/ringtones";

export type Archetype =
  | "told-you-so"
  | "hype"
  | "professor"
  | "gremlin"
  | "soap-star"
  | "night-shift"
  | "golden"
  | "roommate"
  | "legend";

export type RawTrait = { trait_type: string; value: string };
export type DisplayTrait = { type: string; value: string; label: string };

export type ChogMeta = {
  name: string;
  description?: string;
  image?: string;
  attributes: RawTrait[];
};

export type Side = "Left" | "Right";

export type ChogProfile = {
  artId: number;
  tokenId: number;
  name: string;
  traits: RawTrait[];
  display: DisplayTrait[];
  image: string;
  texture: string;
  mode: "bust" | "photo";
  background: string;
  backgroundName: string;
  skin: string;
  skinName: string;
  side: Side;
  archetype: Archetype;
  voiceId: string;
  voiceName: string;
  headlineTrait: string;
};

export type SkyPhase = "dawn" | "morning" | "day" | "dusk" | "night";

export type WeatherKind =
  | "clear"
  | "cloud"
  | "rain"
  | "snow"
  | "fog"
  | "wind"
  | "hot"
  | "cold";

export type WeatherNow = {
  kind: WeatherKind;
  tempC: number;
  phrase: string;
  place: string;
};

export type Recurrence = "none" | "daily" | "weekdays" | "weekly";
export type EventColor = "lilac" | "sage" | "butter" | "rose" | "sky";

export type CalEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  recurrence: Recurrence;
  reminderMin: number | null;
  color: EventColor;
  notes: string;
};

export type Occurrence = {
  event: CalEvent;
  start: Date;
  end: Date;
  key: string;
};

export type Alarm = {
  enabled: boolean;
  hour: number;
  minute: number;
  days: number[];
};

export type Voicemail = {
  id: string;
  artId: number;
  at: string;
  caption: string;
  heard: boolean;
};

export type WakeMark = { at: string; hour: number; minute: number };

export type TokenMemory = {
  streak: number;
  lastMorning: string | null;
  freezes: number;
  freezeWeek: string | null;
  lastSeen: string | null;
  facts: string[];
  recentLineIds: string[];
  lineCount: number;
  dayLine: { date: string; caption: string } | null;
  relationship: "stranger" | "lent" | "owner";
  snoozeCount: number;
  lastSnoozeAt: string | null;
  wakes: WakeMark[];
  attended: string[];
  skipped: string[];
  /** The last line said with what it said about the day (rememberLine): its id, and the event it named, or null. */
  named?: { id: string; event: NamedEvent | null } | null;
  /** What the last answered call named about the day, on which day (dayKey), and the calendar it was said against (calendarStamp). */
  callNamed?: { date: string; event: NamedEvent | null; calendar?: string } | null;
  /** The last calls in the studio voice, newest first, each its line ids in order (rememberCall): a call never replays one. */
  calls?: string[];
};

export type LineIntent =
  | "intro"
  | "greeting"
  | "morning"
  | "reminder"
  | "poke"
  | "voicemail"
  | "idle"
  | "absence"
  | "snooze";

/** Where a tap landed on the portrait: the hat or top of the head, the face, or the collar. */
export type PokeZone = "hat" | "face" | "collar";

export type LineEvent = {
  title: string;
  when: string;
  minutesUntil: number;
  /**
   * Minutes until it ends. An event is on now only while it has started and not ended
   * (minutesUntil <= 0 < minutesLeft); one that has ended is past, never now.
   */
  minutesLeft?: number;
  /** From the sample week, not something the person added: the chip under a line says so. */
  sample?: boolean;
};

/** An event as a line named it: enough to tell the event just said from a new or edited one. */
export type NamedEvent = Pick<LineEvent, "title" | "when">;

export type LineContext = {
  name: string;
  artId: number;
  archetype: Archetype;
  traits: DisplayTrait[];
  intent: LineIntent;
  zone?: PokeZone;
  phase: SkyPhase;
  weekday: string;
  clock: string;
  spokenClock: string;
  weather?: WeatherNow | null;
  nextEvent?: LineEvent | null;
  pastEvent?: LineEvent | null;
  /** An event under way right now (nextEvent is the next one to start): the day is not empty while it runs. */
  nowEvent?: LineEvent | null;
  memory: string[];
  /** Things the user told the Chog themselves, newest first. Only these fill {fact}. */
  facts?: string[];
  /** Whether this person owns the token (verified), is borrowing a demo Chog, or is visiting. */
  relationship?: TokenMemory["relationship"];
  streak: number;
  habit?: string | null;
  absenceHours?: number;
  nonce: number;
  recentIds: string[];
  /** Spoken in a call that was picked up, not shown as a caption on the home screen. */
  inCall?: boolean;
  /**
   * The last line remembered with what it named (TokenMemory.named). It counts only while that line
   * is still the newest in recentIds, pokes and snoozes aside; otherwise the writer goes by ids alone.
   */
  lastNamed?: { id: string; event: NamedEvent | null } | null;
  /** What the last call picked up today named: null when it named nothing, or there was none. */
  callEvent?: NamedEvent | null;
  /** The last calls' lines (TokenMemory.calls): the next call's lines never come in one of these, in that order. */
  lastCalls?: string[];
  /** The studio voice: say a recorded line when one fits (the live voice can say any line). */
  studio?: boolean;
};

export type SavedState = {
  version: 1;
  deviceId: string;
  userName: string;
  artId: number | null;
  onboarded: boolean;
  mute: boolean;
  /**
   * Off (the default): the Chog speaks in its recorded studio voice. On: it can also say lines written
   * for the moment (your event's name, what you told it) in the phone's own voice.
   */
  liveVoice?: boolean;
  /** They set Live voice themselves. Until then it follows the server: on when it can speak in the Chog's own voice. */
  liveVoiceSet?: boolean;
  alarm: Alarm;
  /** How the wake-up rings: the tone, its volume, the snooze. Missing in saves from before Settings had it. */
  alarmStyle?: AlarmStyle;
  events: CalEvent[];
  memory: Record<string, TokenMemory>;
  voicemails: Voicemail[];
  fired: string[];
  lastAlarmKey: string | null;
  seeded: boolean;
  snoozeUntil: string | null;
  /** That snooze was a test ring's ("Ring me in 30 s"): it rings back as a test, never a real wake. */
  snoozeTest?: boolean;
  /** The city the sky follows ("City for the sky"); empty or missing: wherever the phone is. */
  city?: string;
  /** The judge desk only: which of its "things to try" the judge has really done. */
  judgeTried?: string[];
  /** "Ring me in 30 s" in a browser: when the test ring is due (ms). Kept so a reload still rings. */
  ringAt?: number | null;
  /** "Remind me in 5": when it rings back (ms), about what, and when it first rang. */
  later?: { at: number; event?: LineEvent; rangAt: number } | null;
  /** A wake-up or reminder ringing on the page right now, so a reload rings it again or leaves its voicemail. */
  ringing?: { kind: "alarm" | "reminder"; at: number; event?: LineEvent; test?: boolean } | null;
  /** A Live Talk invite from a ?pass= link (src/lib/talkPass.ts). Only /api/talk can say whether it is real. */
  talkPass?: string;
};
