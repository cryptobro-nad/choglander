import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  native: false,
  plugin: {
    schedule: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    openExactSettings: vi.fn(async () => {}),
    stopRing: vi.fn(async () => {}),
    callOver: vi.fn(async () => {}),
    scheduleTest: vi.fn(async () => {}),
    snooze: vi.fn(async () => {}),
    cancelSnooze: vi.fn(async () => {}),
    permissions: vi.fn(async () => ({ notifications: true, fullScreen: false, exact: true })),
    openSettings: vi.fn(async () => {}),
    speak: vi.fn(async () => {}),
    stopSpeaking: vi.fn(async () => {}),
  },
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => state.native },
  registerPlugin: () => state.plugin,
}));
vi.mock("@capacitor/haptics", () => ({
  Haptics: { impact: vi.fn(async () => {}) },
  ImpactStyle: { Heavy: "HEAVY", Medium: "MEDIUM", Light: "LIGHT" },
}));

import {
  cancelNativeSnooze,
  ensureNativeAlarmPermissions,
  isTestNonce,
  nativeCallOver,
  nativeSpeak,
  onNativeEvent,
  scheduleNativeTest,
  snoozeNative,
  stopNativeRing,
  syncNativeAlarm,
  type NativeEvent,
} from "./native";

// The exact script MainActivity evaluates, read from the Java source so the two sides can't drift.
const javaSource = readFileSync(
  path.resolve(__dirname, "../../android/app/src/main/java/com/chog/calls/NativeEvents.java"),
  "utf8",
);
const template = /DELIVERY_SCRIPT =\s*"([^"]*)";/.exec(javaSource)?.[1];

type StubWindow = EventTarget & { __CHOG_NATIVE_QUEUE?: unknown[] };
let win: StubWindow;
let protocol = "https:";

/**
 * Runs MainActivity's delivery script in the stub window; returns what Java's callback would get.
 * The event is the JSON NativeEvents.script / endedScript build (NativeEventsTest pins that shape).
 */
function deliverEvent(event: Record<string, unknown>): unknown {
  if (!template) throw new Error("DELIVERY_SCRIPT not found in NativeEvents.java");
  const script = template.replace("__EVENT__", JSON.stringify(event));
  const run = new Function("window", "location", "CustomEvent", `return ${script};`);
  return run(win, { protocol }, CustomEvent);
}

function deliverFromJava(kind: string, nonce: string): unknown {
  return deliverEvent({ kind, nonce });
}

beforeEach(() => {
  win = new EventTarget() as StubWindow;
  protocol = "https:";
  vi.stubGlobal("window", win);
});

afterEach(() => {
  vi.unstubAllGlobals();
  state.native = false;
  vi.clearAllMocks();
});

describe("onNativeEvent", () => {
  it("hands over a ring that arrived before the page subscribed, then empties the queue", () => {
    expect(deliverFromJava("alarm", "alarm-1")).toBe(true);
    expect(win.__CHOG_NATIVE_QUEUE).toHaveLength(1);
    const seen: NativeEvent[] = [];
    onNativeEvent((event) => seen.push(event));
    expect(seen).toEqual([{ kind: "alarm", nonce: "alarm-1" }]);
    expect(win.__CHOG_NATIVE_QUEUE).toEqual([]);
  });

  it("handles a live delivery once, although it is both queued and dispatched", () => {
    const seen: NativeEvent[] = [];
    onNativeEvent((event) => seen.push(event));
    deliverFromJava("snooze", "snooze-7");
    expect(seen).toEqual([{ kind: "snooze", nonce: "snooze-7" }]);
    expect(win.__CHOG_NATIVE_QUEUE).toEqual([]);
  });

  it("ignores a nonce it has already handled", () => {
    const handler = vi.fn();
    onNativeEvent(handler);
    deliverFromJava("alarm", "alarm-2");
    deliverFromJava("alarm", "alarm-2");
    win.__CHOG_NATIVE_QUEUE = [{ kind: "alarm", nonce: "alarm-2" }];
    win.dispatchEvent(new CustomEvent("chog-native", { detail: { kind: "alarm", nonce: "alarm-2" } }));
    expect(handler).toHaveBeenCalledTimes(1);
    deliverFromJava("alarm", "alarm-3");
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("drains several queued rings in order, skipping duplicates and junk", () => {
    win.__CHOG_NATIVE_QUEUE = [
      { kind: "alarm", nonce: "a" },
      { kind: "alarm", nonce: "a" },
      { kind: "party", nonce: "b" },
      { kind: "test" },
      null,
      "alarm",
      { kind: "test", nonce: "c" },
    ];
    const seen: string[] = [];
    onNativeEvent((event) => seen.push(`${event.kind}:${event.nonce}`));
    expect(seen).toEqual(["alarm:a", "test:c"]);
  });

  it("delivers nothing into about:blank, the page a cold-starting WebView shows first", () => {
    protocol = "about:";
    expect(deliverFromJava("alarm", "alarm-early")).toBe(false);
    expect(win.__CHOG_NATIVE_QUEUE).toBeUndefined();
    // Java retries; once the app page has committed the same script delivers.
    protocol = "https:";
    expect(deliverFromJava("alarm", "alarm-early")).toBe(true);
    const handler = vi.fn();
    onNativeEvent(handler);
    expect(handler).toHaveBeenCalledWith({ kind: "alarm", nonce: "alarm-early" });
  });

  it("stops after unsubscribe and leaves later rings queued for the next subscriber", () => {
    const first = vi.fn();
    const off = onNativeEvent(first);
    off();
    deliverFromJava("test", "test-1");
    expect(first).not.toHaveBeenCalled();
    expect(win.__CHOG_NATIVE_QUEUE).toHaveLength(1);
    const second = vi.fn();
    onNativeEvent(second);
    expect(second).toHaveBeenCalledWith({ kind: "test", nonce: "test-1" });
  });

  it("gives every live subscriber the ring", () => {
    const a = vi.fn();
    const b = vi.fn();
    onNativeEvent(a);
    onNativeEvent(b);
    deliverFromJava("alarm", "alarm-9");
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("keeps draining when a handler throws", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    win.__CHOG_NATIVE_QUEUE = [
      { kind: "alarm", nonce: "x" },
      { kind: "alarm", nonce: "y" },
    ];
    const seen: string[] = [];
    onNativeEvent((event) => {
      seen.push(event.nonce);
      if (event.nonce === "x") throw new Error("boom");
    });
    expect(seen).toEqual(["x", "y"]);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("hands over a ring's Answer and its end once each, although they carry the ring's nonce", () => {
    const seen: NativeEvent[] = [];
    onNativeEvent((event) => seen.push(event));
    deliverFromJava("alarm", "alarm-5");
    deliverEvent({ kind: "alarm", nonce: "alarm-5", answered: true });
    deliverEvent({ kind: "alarm", nonce: "alarm-5", answered: true });
    deliverEvent({ kind: "ended", nonce: "alarm-5", why: "declined" });
    deliverEvent({ kind: "ended", nonce: "alarm-5", why: "declined" });
    deliverFromJava("alarm", "alarm-5");
    expect(seen).toEqual([
      { kind: "alarm", nonce: "alarm-5" },
      { kind: "alarm", nonce: "alarm-5", answered: true },
      { kind: "ended", nonce: "alarm-5", why: "declined" },
    ]);
  });

  it("delivers an Answer that arrives before its ring (the app opened from Answer)", () => {
    const seen: NativeEvent[] = [];
    deliverEvent({ kind: "test", nonce: "test-4", answered: true });
    onNativeEvent((event) => seen.push(event));
    deliverFromJava("test", "test-4");
    expect(seen).toEqual([
      { kind: "test", nonce: "test-4", answered: true },
      { kind: "test", nonce: "test-4" },
    ]);
  });

  it("takes every way a ring can end, and nothing it doesn't know", () => {
    const seen: string[] = [];
    win.__CHOG_NATIVE_QUEUE = [
      { kind: "ended", nonce: "a", why: "snoozed" },
      { kind: "ended", nonce: "b", why: "timeout" },
      { kind: "ended", nonce: "c" },
      { kind: "ended", nonce: "d", why: "exploded" },
      { kind: "alarm", nonce: "e", answered: "yes" },
    ];
    onNativeEvent((event) => seen.push(JSON.stringify(event)));
    expect(seen).toEqual([
      JSON.stringify({ kind: "ended", nonce: "a", why: "snoozed" }),
      JSON.stringify({ kind: "ended", nonce: "b", why: "timeout" }),
      // A malformed "answered" is just the ring.
      JSON.stringify({ kind: "alarm", nonce: "e" }),
    ]);
  });

  it("is a no-op without a window (server render)", () => {
    vi.unstubAllGlobals();
    const off = onNativeEvent(() => {});
    expect(() => off()).not.toThrow();
  });
});

describe("plugin wrappers", () => {
  it("report 'not native' in a browser without touching the plugin", async () => {
    expect(await scheduleNativeTest(Date.now() + 30_000, "Chog is calling")).toBe(false);
    expect(await snoozeNative(9, "Chog is calling")).toBe(false);
    expect(await nativeSpeak("hello", { pitch: 1, rate: 1 })).toBe(false);
    expect(await cancelNativeSnooze()).toBe(false);
    expect(await ensureNativeAlarmPermissions(true)).toEqual({ notifications: true, fullScreen: true, exact: true });
    await syncNativeAlarm(Date.now(), "Chog is calling");
    await stopNativeRing();
    await nativeCallOver("alarm-1");
    expect(state.plugin.schedule).not.toHaveBeenCalled();
    expect(state.plugin.stopRing).not.toHaveBeenCalled();
    expect(state.plugin.callOver).not.toHaveBeenCalled();
  });

  it("pass the alarm and its repeat rule through on the phone", async () => {
    state.native = true;
    const repeat = { hour: 7, minute: 30, days: [1, 2, 3, 4, 5] };
    await syncNativeAlarm(1_800_000_000_000, "Gremlin is calling", repeat);
    expect(state.plugin.schedule).toHaveBeenCalledWith({ at: 1_800_000_000_000, title: "Gremlin is calling", repeat });
    await syncNativeAlarm(null, "Gremlin is calling");
    expect(state.plugin.cancel).toHaveBeenCalledTimes(1);
    expect(await scheduleNativeTest(1_800_000_030_000, "Test")).toBe(true);
    expect(state.plugin.scheduleTest).toHaveBeenCalledWith({ at: 1_800_000_030_000, title: "Test" });
    expect(await snoozeNative(9, "Gremlin is calling")).toBe(true);
    expect(state.plugin.snooze).toHaveBeenCalledWith({ minutes: 9, title: "Gremlin is calling", test: false });
    // A snoozed test ring calls back as a test, never as a real wake.
    expect(await snoozeNative(9, "Gremlin is calling", true)).toBe(true);
    expect(state.plugin.snooze).toHaveBeenLastCalledWith({ minutes: 9, title: "Gremlin is calling", test: true });
    // The call is over: the phone drops the lock-screen bypass the ring put up (not for a new ring).
    await nativeCallOver("alarm-1");
    expect(state.plugin.callOver).toHaveBeenCalledWith({ nonce: "alarm-1" });
    await nativeCallOver();
    expect(state.plugin.callOver).toHaveBeenLastCalledWith({});
    expect(await nativeSpeak("Morning.", { pitch: 1.28, rate: 1.06 })).toBe(true);
    expect(state.plugin.speak).toHaveBeenCalledWith({ text: "Morning.", pitch: 1.28, rate: 1.06, alarm: false });
    // The wake-up line plays on the alarm stream, like the ring.
    await nativeSpeak("Up.", { pitch: 1, rate: 1, alarm: true });
    expect(state.plugin.speak).toHaveBeenLastCalledWith({ text: "Up.", pitch: 1, rate: 1, alarm: true });
    expect(await cancelNativeSnooze()).toBe(true);
    expect(state.plugin.cancelSnooze).toHaveBeenCalledTimes(1);
    expect(await ensureNativeAlarmPermissions(true)).toEqual({ notifications: true, fullScreen: false, exact: true });
    expect(state.plugin.permissions).toHaveBeenCalledWith({ request: true });
  });

  it("turn a plugin failure into a quiet false", async () => {
    state.plugin.callOver.mockRejectedValueOnce(new Error("an older APK"));
    state.native = true;
    await expect(nativeCallOver("alarm-1")).resolves.toBeUndefined();
    state.native = true;
    state.plugin.speak.mockRejectedValueOnce(new Error("No text-to-speech engine on this phone"));
    state.plugin.permissions.mockRejectedValueOnce(new Error("missing"));
    state.plugin.cancelSnooze.mockRejectedValueOnce(new Error("an older APK"));
    expect(await nativeSpeak("Morning.", { pitch: 1, rate: 1 })).toBe(false);
    expect(await cancelNativeSnooze()).toBe(false);
    expect(await ensureNativeAlarmPermissions(false)).toEqual({ notifications: false, fullScreen: false, exact: false });
  });
});

describe("ring ids", () => {
  it("tell a test ring by its id, as the phone names them", () => {
    // A ring's end arrives alone when the page never saw the ring; its id still says what it was.
    expect(isTestNonce("test-mgx2k3h1-5f3a9c0e1d2b4a69")).toBe(true);
    expect(isTestNonce("alarm-mgx2k3h1-5f3a9c0e1d2b4a69")).toBe(false);
    expect(isTestNonce("snooze-mgx2k3h1-5f3a9c0e1d2b4a69")).toBe(false);
    expect(isTestNonce("testy")).toBe(false);
    // NativeEvents.newNonce: the ring's kind, a dash, then the rest.
    expect(javaSource).toMatch(/return kind\(kind\) \+ "-" \+/);
  });
});
