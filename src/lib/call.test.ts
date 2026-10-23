import { describe, expect, it } from "vitest";
import {
  agedEvent,
  callHeader,
  callIsLive,
  missedCall,
  NATIVE_RING_TIMEOUT_MS,
  nativeStep,
  RING_TIMEOUT_MS,
  ringCaption,
  ringTimeout,
  type CallState,
} from "@/lib/call";

const ringing = (overrides: Partial<CallState> = {}): CallState => ({
  id: 4,
  kind: "alarm",
  phase: "ringing",
  caption: "It's half past seven.",
  native: true,
  nonce: "alarm-1",
  ...overrides,
});

/** Rings the page has shown (onNative remembers every one it is handed). */
const none: ReadonlySet<string> = new Set();

describe("what a delivery from the phone does", () => {
  it("rings the snooze alarm as a wake-up call, not as a Snooze press", () => {
    // Nine minutes after a snooze the phone rings again and says {kind: "snooze"}. Earlier builds
    // showed "Snoozed / Back to sleep" here, and that one tap ended the wake-up for good.
    const snoozed: CallState = { id: 3, kind: "alarm", phase: "done", caption: "Nine more minutes.", title: "Snoozed" };
    for (const current of [null, snoozed]) {
      const step = nativeStep({ kind: "snooze", nonce: "snooze-2" }, current, none);
      expect(step).toEqual({ do: "ring", test: false, answer: false, markSlot: false });
    }
    // And the call it starts is a ringing wake-up call (one that can be answered), not "Snoozed".
    expect(callHeader({ kind: "alarm", phase: "ringing" })).toBe("Wake-up call");
    expect(callIsLive(snoozed)).toBe(false);
  });

  it("rings the daily alarm (marking its slot) and the 30-second test (not a real wake)", () => {
    expect(nativeStep({ kind: "alarm", nonce: "alarm-9" }, null, none)).toEqual({ do: "ring", test: false, answer: false, markSlot: true });
    expect(nativeStep({ kind: "test", nonce: "test-1" }, null, none)).toEqual({ do: "ring", test: true, answer: false, markSlot: false });
  });

  it("picks up when the notification's Answer opened the app", () => {
    // The ring was already on screen: answer it, no second ringing screen.
    expect(nativeStep({ kind: "alarm", nonce: "alarm-1", answered: true }, ringing(), none)).toEqual({ do: "answer" });
    // The app opened straight from Answer: ring it and answer at once.
    expect(nativeStep({ kind: "alarm", nonce: "alarm-1", answered: true }, null, none)).toEqual({ do: "ring", test: false, answer: true, markSlot: true });
    // Already picked up on the page: nothing to do.
    expect(nativeStep({ kind: "alarm", nonce: "alarm-1", answered: true }, ringing({ phase: "wake" }), none)).toEqual({ do: "ignore" });
  });

  it("never re-rings a ring the page already has, however it is delivered again", () => {
    expect(nativeStep({ kind: "alarm", nonce: "alarm-1" }, ringing(), none)).toEqual({ do: "ignore" });
    expect(nativeStep({ kind: "alarm", nonce: "alarm-1" }, ringing({ phase: "done" }), none)).toEqual({ do: "ignore" });
  });

  it("turns a ring that stopped without the page into a voicemail or the Snoozed screen", () => {
    expect(nativeStep({ kind: "ended", nonce: "alarm-1", why: "declined" }, ringing(), none)).toEqual({ do: "voicemail", declined: true });
    expect(nativeStep({ kind: "ended", nonce: "alarm-1", why: "timeout" }, ringing(), none)).toEqual({ do: "voicemail", declined: false });
    expect(nativeStep({ kind: "ended", nonce: "alarm-1", why: "snoozed" }, ringing(), none)).toEqual({ do: "snoozed" });
  });

  it("leaves a ring the page has shown alone once it is off the screen", () => {
    const ended = { kind: "ended", nonce: "alarm-1", why: "timeout" } as const;
    const shown: ReadonlySet<string> = new Set(["alarm-1"]);
    // The page's own three-minute fallback left the voicemail already: never a second one.
    expect(nativeStep(ended, null, shown)).toEqual({ do: "ignore" });
    // Another ring or a page call on screen now; that call is left alone too.
    expect(nativeStep(ended, ringing({ nonce: "alarm-2" }), shown)).toEqual({ do: "ignore" });
    expect(nativeStep(ended, ringing({ native: false, nonce: undefined, kind: "call" }), shown)).toEqual({ do: "ignore" });
    // The same ring once the page has answered it.
    expect(nativeStep(ended, ringing({ phase: "wake" }), shown)).toEqual({ do: "ignore" });
    expect(nativeStep(ended, ringing({ phase: "talking" }), none)).toEqual({ do: "ignore" });
  });

  it("turns a ring the page never showed into a missed call", () => {
    // The phone was in use: Android showed a heads-up, the page never saw the ring, and only its
    // end arrives (live, or on the next resume). Earlier builds dropped it: no voicemail, no memory.
    expect(nativeStep({ kind: "ended", nonce: "alarm-mgx2k3h1-5f3a", why: "timeout" }, null, none)).toEqual({ do: "missed", why: "timeout", test: false });
    expect(nativeStep({ kind: "ended", nonce: "snooze-mgx2k3h1-5f3a", why: "declined" }, null, none)).toEqual({ do: "missed", why: "declined", test: false });
    expect(nativeStep({ kind: "ended", nonce: "test-mgx2k3h1-5f3a", why: "snoozed" }, null, none)).toEqual({ do: "missed", why: "snoozed", test: true });
    // With another call on screen, or the Snoozed screen, it is missed all the same.
    const other = ringing({ nonce: "alarm-1", phase: "talking" });
    expect(nativeStep({ kind: "ended", nonce: "alarm-2", why: "declined" }, other, new Set(["alarm-1"]))).toEqual({ do: "missed", why: "declined", test: false });
    const snoozed: CallState = { id: 3, kind: "alarm", phase: "done", caption: "Nine more minutes.", title: "Snoozed" };
    expect(nativeStep({ kind: "ended", nonce: "alarm-2", why: "timeout" }, snoozed, none)).toEqual({ do: "missed", why: "timeout", test: false });
  });

  it("leaves what a decline or snooze on screen would for a missed ring", () => {
    expect(missedCall({ why: "timeout", test: false })).toEqual({ voicemail: true, skipped: false, snoozed: false });
    expect(missedCall({ why: "declined", test: false })).toEqual({ voicemail: true, skipped: true, snoozed: false });
    // The phone armed the snooze already; the page only counts it.
    expect(missedCall({ why: "snoozed", test: false })).toEqual({ voicemail: false, skipped: false, snoozed: true });
    // A test ring still leaves its voicemail, but is never kept in memory as a skipped or snoozed morning.
    expect(missedCall({ why: "declined", test: true })).toEqual({ voicemail: true, skipped: false, snoozed: false });
    expect(missedCall({ why: "timeout", test: true })).toEqual({ voicemail: true, skipped: false, snoozed: false });
    expect(missedCall({ why: "snoozed", test: true })).toEqual({ voicemail: false, skipped: false, snoozed: false });
  });
});

describe("ringing", () => {
  it("gives a native ring the phone's three minutes and a little more before the page gives up", () => {
    expect(ringTimeout({ native: true })).toBe(NATIVE_RING_TIMEOUT_MS);
    expect(NATIVE_RING_TIMEOUT_MS).toBeGreaterThan(3 * 60_000);
    expect(ringTimeout({})).toBe(RING_TIMEOUT_MS);
  });

  it("says something in character on an ordinary call, never a bare 'Incoming.'", () => {
    expect(ringCaption("call", { clock: "half past nine", ringLine: "Pick up. I have notes." })).toBe("Pick up. I have notes.");
    expect(ringCaption("call", { clock: "half past nine" })).toBe("");
    expect(ringCaption("alarm", { clock: "half past seven", ringLine: "x" })).toBe("It's half past seven.");
    const event = { title: "Standup", when: "half past nine", minutesUntil: 10 };
    expect(ringCaption("reminder", { event, clock: "twenty past nine" })).toBe("Standup at half past nine.");
    expect(ringCaption("reminder", { event: { ...event, minutesUntil: 0 }, clock: "half past nine" })).toBe("Standup. Now.");
  });

  it("counts the minutes down when 'Remind me in 5' rings back", () => {
    const event = { title: "Standup", when: "half past nine", minutesUntil: 10 };
    const rangAt = Date.UTC(2026, 9, 19, 9, 20);
    const back = agedEvent(event, rangAt, rangAt + 5 * 60_000);
    expect(back).toEqual({ ...event, minutesUntil: 5 });
    expect(event.minutesUntil).toBe(10);
    // Twice more and it is on: the caption becomes "Standup. Now."
    const again = agedEvent(back, rangAt + 5 * 60_000, rangAt + 10 * 60_000);
    expect(again.minutesUntil).toBe(0);
    expect(ringCaption("reminder", { event: again, clock: "" })).toBe("Standup. Now.");
    // A clock that went backwards never adds minutes.
    expect(agedEvent(event, rangAt, rangAt - 60_000).minutesUntil).toBe(10);
  });

  it("counts down the end too, and never says Now once the event is over", () => {
    const event = { title: "Standup", when: "half past nine", minutesUntil: 0, minutesLeft: 15 };
    const rangAt = Date.UTC(2026, 9, 19, 9, 30);
    expect(agedEvent(event, rangAt, rangAt + 5 * 60_000)).toEqual({ ...event, minutesUntil: -5, minutesLeft: 10 });
    const over = agedEvent(event, rangAt, rangAt + 15 * 60_000);
    expect(over.minutesLeft).toBe(0);
    expect(ringCaption("reminder", { event: over, clock: "" })).toBe("Standup.");
  });
});
