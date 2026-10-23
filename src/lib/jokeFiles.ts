import type { EventKind } from "@/lib/kinds";
import type { Archetype, SkyPhase, WeatherKind } from "@/lib/types";
import golden from "@/data/jokes/golden.json";
import gremlin from "@/data/jokes/gremlin.json";
import hype from "@/data/jokes/hype.json";
import legend from "@/data/jokes/legend.json";
import nightShift from "@/data/jokes/night-shift.json";
import professor from "@/data/jokes/professor.json";
import roommate from "@/data/jokes/roommate.json";
import soapStar from "@/data/jokes/soap-star.json";
import toldYouSo from "@/data/jokes/told-you-so.json";

/**
 * One Chog's joke file (src/data/jokes/<archetype>.json). Every line is written for a moment: the
 * kind of event it is, what the Chog wears, the hour, the weather or what you did. The shape and the
 * house rules are checked by scripts/check-jokes.mjs.
 */
export type BankFile = {
  archetype: Archetype;
  intro: string[];
  /** The incoming-call caption while it rings. */
  ring: string[];
  wake: string[];
  snooze: string[];
  voicemail: string[];
  absence: string[];
  owner: string[];
  stranger: string[];
  /** Callbacks: {snoozes} {skipped} {attended} {streak} {fact} {habit}. */
  recall: string[];
  /** The next event is happening right now. */
  now: string[];
  /** The calendar's bubble on a day with nothing in it. */
  calendarFree: string[];
  time: Record<SkyPhase, string[]>;
  /** One line per weekday, "monday" to "sunday". */
  days: Record<string, string[]>;
  weather: Record<WeatherKind, string[]>;
  events: Record<EventKind, { ahead: string[]; soon: string[]; peek: string[] }>;
  pokes: {
    hat: Record<string, string[]>;
    face: Record<string, string[]>;
    collar: Record<string, string[]>;
  };
};

/** Every Chog's jokes, one file per archetype. */
export const JOKE_FILES: Partial<Record<Archetype, BankFile>> = {
  "told-you-so": toldYouSo as BankFile,
  hype: hype as BankFile,
  professor: professor as BankFile,
  gremlin: gremlin as BankFile,
  "soap-star": soapStar as BankFile,
  "night-shift": nightShift as BankFile,
  golden: golden as BankFile,
  roommate: roommate as BankFile,
  legend: legend as BankFile,
};
