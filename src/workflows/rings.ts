import webpush from "web-push";
import { createHook, FatalError, sleep } from "workflow";
import { nextRing, ringPayload, RING_LATE_MS, type PushTarget, type RingPayload, type RingPlan } from "@/lib/ringPush";

// One run per browser and desk keeps that desk's rings for when its tab is closed (see
// src/lib/ringPush.ts). It sleeps until the next ring, sends it as a Web Push notification, and
// sleeps again. The page sends a fresh plan whenever its rings change; it comes in through the hook,
// whose token names the desk and the browser (src/app/api/push/route.ts), and wakes the run early.
// The Android export has no server, so it leaves this folder out (scripts/export-android.mjs).

/** A desk with nothing left to ring for this long lets its run end; its next plan starts another. */
const IDLE_MS = 8 * 24 * 60 * 60_000;
/** Every turn adds to the run's event log, so a run ends after this many; the next plan starts afresh. */
const MAX_TURNS = 400;
/** The rings sent lately, by id, so a plan that still lists one (the page hasn't heard) never sends it twice. */
const SENT_KEPT = 64;

export async function deskRings(token: string, first: RingPlan) {
  "use workflow";

  const hook = createHook<RingPlan>({ token });
  // Two plans at once can start two runs: one gets the token, and the other ends here. The route
  // hands its plan to whichever run holds the token.
  const owner = await hook.getConflict();
  if (owner) return { outcome: "duplicate", owner: owner.runId };

  const plans = hook[Symbol.asyncIterator]();
  // One wait for the next plan stays open across every race below, so a plan that arrives while a
  // push is going out is not lost: it wins the next race.
  let incoming = plans.next();
  let plan = first;
  const sent: string[] = [];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const ring = nextRing(plan.rings, sent, Date.now());
    if (!ring || ring.at > Date.now()) {
      const woke = await Promise.race([
        incoming.then((next) => ({ next })),
        (ring ? sleep(new Date(ring.at)) : sleep(IDLE_MS)).then(() => null),
      ]);
      if (woke) {
        if (woke.next.done) return { outcome: "closed" };
        plan = woke.next.value;
        incoming = plans.next();
        continue;
      }
      if (!ring) return { outcome: "idle" };
    }
    sent.push(ring.id);
    if (sent.length > SENT_KEPT) sent.shift();
    try {
      if ((await sendRing(plan.subscription, ringPayload(ring, plan.desk))) === "gone") return { outcome: "unsubscribed" };
    } catch {
      // Out of retries, or refused: that one ring is lost, and the next still goes out.
    }
  }
  return { outcome: "full" };
}

/** Sends one ring to the browser's push service. "gone": the browser has dropped this subscription. */
async function sendRing(target: PushTarget, payload: RingPayload): Promise<"sent" | "gone"> {
  "use step";

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) throw new FatalError("Web Push keys are not set");
  try {
    await webpush.sendNotification(target, JSON.stringify(payload), {
      vapidDetails: { subject: process.env.VAPID_SUBJECT?.trim() || "https://choglander.vercel.app", publicKey, privateKey },
      // A call is only worth showing while it could still be answered; a phone that was off gets nothing stale.
      TTL: Math.round(RING_LATE_MS / 1000),
      // High urgency wakes a phone that is dozing, as an alarm should.
      urgency: "high",
      timeout: 10_000,
    });
    return "sent";
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) return "gone";
    // Any other refusal (a bad key, a payload too large) would only be refused again.
    if (status && status >= 400 && status < 500 && status !== 429) throw new FatalError(`Push refused with ${status}`);
    throw error;
  }
}
