import { isNative } from "@/lib/native";
import type { Desk, PushTarget, RingPush } from "@/lib/ringPush";

// The browser's side of closed-tab rings (ringPush.ts): a push subscription for this browser, and the
// desk's rings sent to /api/push whenever they change. A browser without Web Push, the phone app (it
// arms its own alarms) and a deploy without keys skip all of it: the page rings as before, while open.

const VAPID_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() ?? "";

/** Whether this browser can be sent rings while the tab is closed, once notifications are allowed. */
export function webPushReady(): boolean {
  return (
    VAPID_KEY.length > 0 &&
    process.env.NEXT_PUBLIC_CHOG_EXPORT !== "1" &&
    typeof window !== "undefined" &&
    !isNative() &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(base64url.length / 4) * 4, "=");
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a || a.byteLength !== b.length) return false;
  const bytes = new Uint8Array(a);
  return bytes.every((byte, i) => byte === b[i]);
}

/**
 * This browser's push subscription, made if there is none yet. One made for another server key (an
 * earlier deploy's) is replaced, or every push to it would be refused. Null when push isn't on offer
 * here, notifications aren't allowed, or the push service said no.
 */
export async function pushSubscription(): Promise<PushTarget | null> {
  if (!webPushReady() || Notification.permission !== "granted") return null;
  try {
    const registration = await navigator.serviceWorker.ready;
    const key = keyBytes(VAPID_KEY);
    let subscription = await registration.pushManager.getSubscription();
    if (subscription && !sameKey(subscription.options.applicationServerKey, key)) {
      await subscription.unsubscribe();
      subscription = null;
    }
    subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    const { endpoint, keys } = subscription.toJSON();
    if (!endpoint || !keys?.p256dh || !keys.auth) return null;
    return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
  } catch {
    return null;
  }
}

/**
 * Hands the desk's rings to the server, which sends each at its moment if the tab is closed by then.
 * Kept alive past the page, so a change made just before closing the tab still arrives.
 */
export async function sendRings(desk: Desk, subscription: PushTarget, rings: RingPush[]): Promise<boolean> {
  try {
    const response = await fetch("/api/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ desk, subscription, rings }),
      keepalive: true,
    });
    return response.ok;
  } catch {
    return false;
  }
}
