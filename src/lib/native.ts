import { App } from "@capacitor/app";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import type { AlarmStyle } from "@/lib/ringtones";

// The bridge to the Android shell. Every function is safe to call in a browser: it does
// nothing there and reports that it did nothing, so callers can fall back to web behaviour.

/** The daily alarm the native side re-arms by itself after every ring. */
export type NativeRepeat = { hour: number; minute: number; days: number[] };

export type NativePermissions = {
  /** POST_NOTIFICATIONS on Android 13+; always true below that. */
  notifications: boolean;
  /** The call screen over the lock screen (USE_FULL_SCREEN_INTENT, revocable on Android 14+). */
  fullScreen: boolean;
  /** Exact alarms (SCHEDULE_EXACT_ALARM / USE_EXACT_ALARM). */
  exact: boolean;
};

/** Why a ring stopped without the page: the notification's Decline or Snooze, or three minutes unanswered. */
export type NativeEndReason = "declined" | "snoozed" | "timeout";

/**
 * What the native side tells the page. `nonce` names one ring. A ring is delivered once, and may
 * be followed by one "answered" delivery (the notification's Answer) and one "ended" delivery.
 *  - alarm, test: the daily wake-up or "Ring me in 30 s" is ringing.
 *  - snooze: the snooze alarm is ringing, once a snooze is up. A wake-up call, not a snooze.
 *  - ended: that ring stopped without the page (`why`).
 */
export type NativeEvent =
  | { kind: "alarm" | "snooze" | "test"; nonce: string; answered?: boolean }
  | { kind: "ended"; nonce: string; why: NativeEndReason };

type AlarmPlugin = {
  schedule: (options: { at: number; title: string; repeat?: NativeRepeat }) => Promise<void>;
  cancel: () => Promise<void>;
  openExactSettings: () => Promise<void>;
  stopRing: () => Promise<void>;
  callOver: (options: { nonce?: string }) => Promise<void>;
  scheduleTest: (options: { at: number; title: string }) => Promise<void>;
  snooze: (options: { minutes: number; title: string; test: boolean }) => Promise<void>;
  ringStyle: (options: { tone: string; volume: string; rise: boolean; vibrate: boolean; snooze: number }) => Promise<void>;
  cancelSnooze: () => Promise<void>;
  permissions: (options: { request: boolean }) => Promise<NativePermissions>;
  openSettings: (options: { which: "exact" | "notifications" | "fullscreen" }) => Promise<void>;
  speak: (options: { text: string; pitch: number; rate: number; alarm: boolean }) => Promise<void>;
  stopSpeaking: () => Promise<void>;
};

const ChogAlarm = registerPlugin<AlarmPlugin>("ChogAlarm");

export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Android's Back button and gesture (the APK only). `close` closes whatever is on top and returns
 * true; when nothing was open the app goes to the background, as Back does on a home screen.
 * Returns the unsubscribe.
 */
export function onBackButton(close: () => boolean): () => void {
  if (!isNative()) return () => undefined;
  const handle = App.addListener("backButton", () => {
    if (!close()) void App.minimizeApp().catch(() => undefined);
  });
  return () => void handle.then((listener) => listener.remove()).catch(() => undefined);
}

export async function buzz(kind: "light" | "medium" | "heavy" = "light") {
  if (!isNative()) return;
  const style = kind === "heavy" ? ImpactStyle.Heavy : kind === "medium" ? ImpactStyle.Medium : ImpactStyle.Light;
  try {
    await Haptics.impact({ style });
  } catch {
    /* no vibrator, or the browser shell */
  }
}

export async function openExactAlarmSettings() {
  await openNativeAlarmSettings("exact");
}

export async function openNativeAlarmSettings(which: "exact" | "notifications" | "fullscreen") {
  if (!isNative()) return;
  try {
    await ChogAlarm.openSettings({ which });
  } catch {
    /* settings screen unavailable */
  }
}

/** Schedules (or with `at: null` cancels) the native wake-up. `repeat` lets the native side re-arm it. */
export async function syncNativeAlarm(at: number | null, title: string, repeat?: NativeRepeat) {
  if (!isNative()) return;
  try {
    if (at == null) await ChogAlarm.cancel();
    else await ChogAlarm.schedule({ at, title, repeat });
  } catch {
    /* plugin missing in the browser shell */
  }
}

/** Silences the native ringtone and vibration. Call when the call is answered, declined, snoozed or ends. */
export async function stopNativeRing(): Promise<void> {
  if (!isNative()) return;
  try {
    await ChogAlarm.stopRing();
  } catch {
    /* nothing ringing */
  }
}

/**
 * The call screen is gone (End, a voicemail, Back to sleep): the phone drops the lock-screen bypass
 * the ring put up, so the app is behind the keyguard again. Not at Answer: that call goes on.
 * `nonce` is the ring that call was; a different ring still going is one the page has not shown yet.
 */
export async function nativeCallOver(nonce?: string): Promise<void> {
  if (!isNative()) return;
  try {
    await ChogAlarm.callOver(nonce ? { nonce } : {});
  } catch {
    /* an older APK without it */
  }
}

/** "Ring me in 30 s" through the real alarm path. Returns false in a browser (use the page timer). */
export async function scheduleNativeTest(at: number, title: string): Promise<boolean> {
  if (!isNative()) return false;
  try {
    await ChogAlarm.scheduleTest({ at, title });
    return true;
  } catch {
    return false;
  }
}

/** Snooze through the real alarm path. `test`: a snoozed test ring, which calls back as a test. Returns false in a browser. */
export async function snoozeNative(minutes: number, title: string, test = false): Promise<boolean> {
  if (!isNative()) return false;
  try {
    await ChogAlarm.snooze({ minutes, title, test });
    return true;
  } catch {
    return false;
  }
}

/**
 * Hands the phone how to ring (Settings > Wake-up call): the ring service and the notification's
 * Snooze read it when the app is closed. An APK from before these settings has no such method and
 * keeps ringing as it did, so that failure is quiet.
 */
export async function syncNativeRingStyle(style: AlarmStyle): Promise<boolean> {
  if (!isNative()) return false;
  try {
    await ChogAlarm.ringStyle({ tone: style.tone, volume: style.volume, rise: style.rise, vibrate: style.vibrate, snooze: style.snoozeMin });
    return true;
  } catch {
    return false;
  }
}

/** Drops a pending snooze (and its "Snoozed until" note): the user is up, or the alarm is off. */
export async function cancelNativeSnooze(): Promise<boolean> {
  if (!isNative()) return false;
  try {
    await ChogAlarm.cancelSnooze();
    return true;
  } catch {
    return false;
  }
}

/** Reads (and with `request` asks for) what the alarm needs. In a browser everything is "true". */
export async function ensureNativeAlarmPermissions(request: boolean): Promise<NativePermissions> {
  if (!isNative()) return { notifications: true, fullScreen: true, exact: true };
  try {
    return await ChogAlarm.permissions({ request });
  } catch {
    return { notifications: false, fullScreen: false, exact: false };
  }
}

/**
 * Speaks with Android's own text-to-speech. Resolves when done; false when not native. `alarm`
 * plays it on the alarm stream, like the ring before it, so a wake-up line is heard at alarm
 * volume on the phone's speaker even with media muted.
 */
export async function nativeSpeak(text: string, opts: { pitch: number; rate: number; alarm?: boolean }): Promise<boolean> {
  if (!isNative()) return false;
  try {
    await ChogAlarm.speak({ text, pitch: opts.pitch, rate: opts.rate, alarm: opts.alarm === true });
    return true;
  } catch {
    return false;
  }
}

export async function stopNativeSpeaking(): Promise<void> {
  if (!isNative()) return;
  try {
    await ChogAlarm.stopSpeaking();
  } catch {
    /* not speaking */
  }
}

/**
 * Whether a ring id is a test ring's. The phone names every ring after its kind
 * ("test-mgx2k3h1-5f3a9c0e1d2b4a69", NativeEvents.newNonce), so an "ended" that arrives on its own,
 * for a ring the page never saw, still says what it was.
 */
export function isTestNonce(nonce: string): boolean {
  return nonce.startsWith("test-");
}

type NativeWindow = Window & { __CHOG_NATIVE_QUEUE?: unknown[] };

const KINDS: ReadonlySet<string> = new Set(["alarm", "snooze", "test", "ended"]);
const END_REASONS: ReadonlySet<string> = new Set(["declined", "snoozed", "timeout"]);

/** A delivery as MainActivity sends it, or null for anything else. */
function asNativeEvent(value: unknown): NativeEvent | null {
  if (!value || typeof value !== "object") return null;
  const { kind, nonce, answered, why } = value as { kind?: unknown; nonce?: unknown; answered?: unknown; why?: unknown };
  if (typeof kind !== "string" || !KINDS.has(kind)) return null;
  if (typeof nonce !== "string" || nonce.length === 0) return null;
  if (kind === "ended") {
    if (typeof why !== "string" || !END_REASONS.has(why)) return null;
    return { kind, nonce, why: why as NativeEndReason };
  }
  const ring = kind as "alarm" | "snooze" | "test";
  return answered === true ? { kind: ring, nonce, answered: true } : { kind: ring, nonce };
}

/** One ring can reach the page three ways (rang, answered, ended); each counts once. */
function deliveryKey(event: NativeEvent): string {
  if (event.kind === "ended") return `${event.nonce}:ended`;
  return event.answered ? `${event.nonce}:answered` : event.nonce;
}

/**
 * Subscribes to ring deliveries from the native side (android/.../NativeEvents.java). MainActivity
 * sends each delivery once: it pushes it onto window.__CHOG_NATIVE_QUEUE, for a page that is not
 * listening yet, and dispatches a "chog-native" CustomEvent, for one that is. A subscriber first
 * drains the queue, then hears every later event; it sees each delivery (the ring, its Answer, its
 * end) at most once however it reaches it. Returns the unsubscribe.
 */
export function onNativeEvent(handler: (event: NativeEvent) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const w = window as NativeWindow;
  const seen = new Set<string>();
  let active = true;
  const take = (value: unknown) => {
    const event = asNativeEvent(value);
    if (!active || !event) return;
    const key = deliveryKey(event);
    if (seen.has(key)) return;
    seen.add(key);
    try {
      handler(event);
    } catch (error) {
      // One bad handler run must not swallow the rest of the queue.
      console.error("onNativeEvent handler failed", error);
    }
  };
  const drain = () => {
    const queue = Array.isArray(w.__CHOG_NATIVE_QUEUE) ? w.__CHOG_NATIVE_QUEUE : [];
    w.__CHOG_NATIVE_QUEUE = [];
    queue.forEach(take);
  };
  const listener = (e: Event) => {
    take((e as CustomEvent<unknown>).detail);
    drain();
  };
  window.addEventListener("chog-native", listener);
  drain();
  return () => {
    active = false;
    window.removeEventListener("chog-native", listener);
  };
}
