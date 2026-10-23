import type { SkyPhase } from "@/lib/types";

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

const HOURS = ["twelve", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven"];

export function skyPhase(date: Date): SkyPhase {
  const h = date.getHours() + date.getMinutes() / 60;
  if (h >= 5 && h < 7.5) return "dawn";
  if (h >= 7.5 && h < 11.5) return "morning";
  if (h >= 11.5 && h < 17) return "day";
  if (h >= 17 && h < 20.5) return "dusk";
  return "night";
}

export function phaseGreeting(phase: SkyPhase): string {
  if (phase === "dawn" || phase === "morning") return "good morning";
  if (phase === "day") return "good afternoon";
  if (phase === "dusk") return "good evening";
  return "still up";
}

export function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function weekKey(date: Date): string {
  const copy = new Date(date);
  const day = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - day);
  return dayKey(copy);
}

export function formatClock(date: Date): string {
  let h = date.getHours();
  const m = date.getMinutes();
  const ap = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  if (m === 0) return `${h} ${ap}`;
  return `${h}:${`${m}`.padStart(2, "0")} ${ap}`;
}

function hourName(hour24: number): string {
  return HOURS[((hour24 % 24) + 24) % 24 % 12];
}

/** Nearest quarter hour, said the way a person would. Never "ten forty six". */
export function spokenClock(date: Date): string {
  const total = date.getHours() * 60 + date.getMinutes();
  const rounded = Math.round(total / 15) * 15;
  const hour24 = Math.floor(rounded / 60) % 24;
  const minute = rounded % 60;
  const hour = hourName(hour24);
  const next = hourName(hour24 + 1);
  if (minute === 0) return hour;
  if (minute === 15) return `quarter past ${hour}`;
  if (minute === 30) return `half past ${hour}`;
  return `quarter to ${next}`;
}

const PAST = ["", "five past", "ten past", "quarter past", "twenty past", "twenty-five past", "half past"];
const TO = ["", "five to", "ten to", "quarter to", "twenty to", "twenty-five to"];

/**
 * When a calendar item starts, said the way a person reads a clock face, to the nearest five
 * minutes: "twenty-five past six", "ten to nine", "noon". An event at 6:25 is never "half past six".
 */
export function spokenWhen(date: Date): string {
  const total = Math.round((date.getHours() * 60 + date.getMinutes()) / 5) * 5;
  const hour24 = Math.floor(total / 60) % 24;
  const minute = total % 60;
  if (minute === 0) {
    if (hour24 === 12) return "noon";
    if (hour24 === 0) return "midnight";
    return hourName(hour24);
  }
  if (minute <= 30) return `${PAST[minute / 5]} ${hourName(hour24)}`;
  return `${TO[(60 - minute) / 5]} ${hourName(hour24 + 1)}`;
}

export function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function atTime(day: Date, hour: number, minute: number): Date {
  const copy = startOfDay(day);
  copy.setHours(hour, minute, 0, 0);
  return copy;
}

export function sameDay(a: Date, b: Date): boolean {
  return dayKey(a) === dayKey(b);
}

export function formatHourLabel(hour: number): string {
  const ap = hour >= 12 ? "PM" : "AM";
  const h = hour % 12 || 12;
  return `${h} ${ap}`;
}

export function countdown(to: Date, now = new Date()): string {
  const ms = Math.max(0, to.getTime() - now.getTime());
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}

export function nextMidnight(now = new Date()): Date {
  const copy = startOfDay(now);
  copy.setDate(copy.getDate() + 1);
  return copy;
}
