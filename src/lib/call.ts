import { isTestNonce, type NativeEndReason, type NativeEvent } from "@/lib/native";
import type { LineEvent, LineIntent } from "@/lib/types";

// The call screen as a small state machine: ringing -> (wake ->) talking -> done.

export type CallKind = "call" | "alarm" | "reminder" | "voicemail";
export type CallPhase = "ringing" | "wake" | "talking" | "done";

export type CallState = {
  /** Unique per call, so timers and late speech from an earlier call can tell it is gone. */
  id: number;
  kind: CallKind;
  phase: CallPhase;
  caption: string;
  /** The reminder occurrence that rang, said as "next" even if something else starts sooner. */
  event?: LineEvent;
  /** The native alarm is ringing on the alarm stream; the page stays quiet. */
  native?: boolean;
  /** The phone's id for that ring, so a later "answered" or "ended" for it finds this call. */
  nonce?: string;
  /** "Ring me in 30 s" rather than the real daily alarm. */
  test?: boolean;
  /** Overrides the header, e.g. "Snoozed". */
  title?: string;
};

/** How long a page-rung call rings before it turns into a voicemail. */
export const RING_TIMEOUT_MS = 28_000;
/**
 * The page's own deadline for a native ring. The phone gives up after three minutes (RingService)
 * and says so with an "ended" event; this only catches an event that never arrived, so it waits a
 * little longer and can never cut the phone's ring short.
 */
export const NATIVE_RING_TIMEOUT_MS = 3 * 60_000 + 5_000;
export const REMIND_AGAIN_MIN = 5;

/** The small caps line over the Chog's name. */
export function callHeader(call: Pick<CallState, "kind" | "phase" | "title">): string {
  if (call.title) return call.title;
  if (call.kind === "voicemail") return "Voicemail";
  if (call.phase === "wake") return "Wake-up call";
  if (call.phase === "ringing") {
    if (call.kind === "alarm") return "Wake-up call";
    if (call.kind === "reminder") return "Reminder";
    return "Incoming call";
  }
  return call.phase === "done" ? "Call ended" : "On the line";
}

/** What the Chog says once a call is picked up. */
export function callIntent(kind: CallKind): LineIntent {
  if (kind === "alarm") return "morning";
  if (kind === "reminder") return "reminder";
  if (kind === "voicemail") return "voicemail";
  return "greeting";
}

/** Whether a call on screen blocks a new one. A finished call (e.g. "Snoozed") gives way. */
export function callIsLive(call: Pick<CallState, "phase"> | null): boolean {
  return !!call && call.phase !== "done";
}

/** How long a ringing call waits before it goes to voicemail. */
export function ringTimeout(call: Pick<CallState, "native">): number {
  return call.native ? NATIVE_RING_TIMEOUT_MS : RING_TIMEOUT_MS;
}

/**
 * The line under the Chog while it rings. A reminder says what and when, the wake-up says the time,
 * and an ordinary call gets one of the archetype's own ring lines.
 */
export function ringCaption(kind: CallKind, options: { event?: LineEvent; clock: string; ringLine?: string }): string {
  if (kind === "reminder" && options.event) {
    const event = options.event;
    if (event.minutesUntil > 0) return `${event.title} at ${event.when}.`;
    // A reminder put off past the event's end: it is over, so never "Now".
    return event.minutesLeft != null && event.minutesLeft <= 0 ? `${event.title}.` : `${event.title}. Now.`;
  }
  if (kind === "alarm") return `It's ${options.clock}.`;
  return options.ringLine ?? "";
}

/**
 * "Remind me in 5" rings back with the event as it is now: the minutes left were counted when it
 * first rang, so they are counted down by the time that has passed since.
 */
export function agedEvent(event: LineEvent, rangAt: number, now: number): LineEvent {
  const passed = Math.max(0, Math.round((now - rangAt) / 60_000));
  const aged = { ...event, minutesUntil: event.minutesUntil - passed };
  return event.minutesLeft == null ? aged : { ...aged, minutesLeft: event.minutesLeft - passed };
}

/** What the page does with one delivery from the phone (see onNative in ChogApp). */
export type NativeStep =
  /** Ring a wake-up call. `answer` when the notification's Answer opened the app. */
  | { do: "ring"; test: boolean; answer: boolean; markSlot: boolean }
  /** The call on screen is that ring: pick it up. */
  | { do: "answer" }
  /** The phone stopped ringing without the page: Decline on the notification, or three minutes. */
  | { do: "voicemail"; declined: boolean }
  /** Snooze on the notification: the phone has already armed it. */
  | { do: "snoozed" }
  /**
   * A ring the page never showed stopped without it: the phone was in use, so Android showed a
   * heads-up and the page only hears the end. The call on screen, if any, is another one.
   */
  | { do: "missed"; why: NativeEndReason; test: boolean }
  | { do: "ignore" };

function isThatRing(call: CallState | null, nonce: string): call is CallState {
  return !!call && !!call.native && call.nonce === nonce;
}

/** `seen`: every ring the page has been handed, so an end it has dealt with already stays dealt with. */
export function nativeStep(event: NativeEvent, current: CallState | null, seen: ReadonlySet<string>): NativeStep {
  if (event.kind === "ended") {
    if (isThatRing(current, event.nonce)) {
      // One the page already answered, snoozed or declined stays as it is.
      if (current.phase !== "ringing") return { do: "ignore" };
      if (event.why === "snoozed") return { do: "snoozed" };
      return { do: "voicemail", declined: event.why === "declined" };
    }
    // Shown and gone (the page's own three-minute fallback left its voicemail): nothing more.
    if (seen.has(event.nonce)) return { do: "ignore" };
    return { do: "missed", why: event.why, test: isTestNonce(event.nonce) };
  }
  if (isThatRing(current, event.nonce)) {
    // A second delivery of a ring already on screen: only Answer changes anything.
    return event.answered && current.phase === "ringing" ? { do: "answer" } : { do: "ignore" };
  }
  // "snooze" is the snooze alarm ringing again once the snooze is up: a wake-up call like any other.
  return { do: "ring", test: event.kind === "test", answer: !!event.answered, markSlot: event.kind === "alarm" };
}

/**
 * What a missed ring leaves behind, as its Decline, Snooze or ring-out would have on screen: a
 * voicemail unless it was snoozed, and for a real morning the skip or the snooze in memory.
 */
export function missedCall(step: { why: NativeEndReason; test: boolean }): { voicemail: boolean; skipped: boolean; snoozed: boolean } {
  return {
    voicemail: step.why !== "snoozed",
    skipped: step.why === "declined" && !step.test,
    snoozed: step.why === "snoozed" && !step.test,
  };
}
