import { describe, expect, it } from "vitest";
import { MAX_RINGS, nextRing, readRingLink, readRingPlan, ringPayload, RING_LATE_MS, type RingPush } from "@/lib/ringPush";

const NOW = Date.UTC(2026, 9, 22, 6, 0);
const MIN = 60_000;
const subscription = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
  keys: { p256dh: "B".repeat(87), auth: "c".repeat(22) },
};

function ring(id: string, at: number): RingPush {
  return { id, at, title: "Chog #375 is calling", body: "Tap to answer." };
}

describe("nextRing", () => {
  it("picks the earliest ring not sent yet", () => {
    const rings = [ring("alarm:b", NOW + 20 * MIN), ring("test:a", NOW + 5 * MIN), ring("later:c", NOW + 10 * MIN)];
    expect(nextRing(rings, [], NOW)?.id).toBe("test:a");
    expect(nextRing(rings, ["test:a"], NOW)?.id).toBe("later:c");
    expect(nextRing(rings, ["test:a", "later:c", "alarm:b"], NOW)).toBeNull();
  });

  it("still sends one a little late, but drops one too late to be news", () => {
    expect(nextRing([ring("alarm:x", NOW - MIN)], [], NOW)?.id).toBe("alarm:x");
    expect(nextRing([ring("alarm:x", NOW - RING_LATE_MS - 1)], [], NOW)).toBeNull();
  });
});

describe("readRingPlan", () => {
  it("accepts a plan and sorts its rings", () => {
    const plan = readRingPlan({ desk: "home", subscription, rings: [ring("alarm:b", NOW + 20 * MIN), ring("test:a", NOW + MIN)] }, NOW);
    expect(plan?.desk).toBe("home");
    expect(plan?.subscription).toEqual(subscription);
    expect(plan?.rings.map((item) => item.id)).toEqual(["test:a", "alarm:b"]);
  });

  it("refuses what is not a push subscription or a ring it knows", () => {
    const good = { desk: "judge", subscription, rings: [] };
    expect(readRingPlan(good, NOW)).not.toBeNull();
    expect(readRingPlan({ ...good, desk: "other" }, NOW)).toBeNull();
    expect(readRingPlan({ ...good, subscription: { ...subscription, endpoint: "http://example.com/push" } }, NOW)).toBeNull();
    // Only the browsers' own push services: never an address someone made up, an odd port or a login.
    for (const endpoint of ["https://example.com/push", "https://10.0.0.1/push", "https://fcm.googleapis.com:8443/fcm/send/x", "https://u:p@fcm.googleapis.com/fcm/send/x", "https://fcm.googleapis.com.evil.example/x"]) {
      expect(readRingPlan({ ...good, subscription: { ...subscription, endpoint } }, NOW), endpoint).toBeNull();
    }
    for (const endpoint of ["https://updates.push.services.mozilla.com/wpush/v2/x", "https://wns2-db5p.notify.windows.com/w/?token=x", "https://web.push.apple.com/x"]) {
      expect(readRingPlan({ ...good, subscription: { ...subscription, endpoint } }, NOW), endpoint).not.toBeNull();
    }
    expect(readRingPlan({ ...good, subscription: { ...subscription, keys: { p256dh: "x", auth: "y" } } }, NOW)).toBeNull();
    expect(readRingPlan({ ...good, rings: [ring("rm -rf:/", NOW + MIN)] }, NOW)).toBeNull();
    expect(readRingPlan({ ...good, rings: [{ ...ring("test:a", NOW + MIN), title: "" }] }, NOW)).toBeNull();
    expect(readRingPlan({ ...good, rings: Array.from({ length: MAX_RINGS + 1 }, (_, i) => ring(`test:${i}`, NOW + i * MIN)) }, NOW)).toBeNull();
    expect(readRingPlan(null, NOW)).toBeNull();
  });

  it("drops rings far outside the week and trims long words", () => {
    const plan = readRingPlan(
      { desk: "home", subscription, rings: [ring("alarm:far", NOW + 30 * 24 * 60 * MIN), { ...ring("test:a", NOW + MIN), title: `  ${"x".repeat(300)}  ` }] },
      NOW,
    );
    expect(plan?.rings.map((item) => item.id)).toEqual(["test:a"]);
    expect(plan?.rings[0].title).toHaveLength(120);
  });
});

describe("ring links", () => {
  it("reads the ring a tapped notification names", () => {
    expect(readRingLink(`?ring=${encodeURIComponent("reminder:ev-1@2026-10-22T06:30:00.000Z")}&at=${NOW}`)).toEqual({
      id: "reminder:ev-1@2026-10-22T06:30:00.000Z",
      at: NOW,
    });
    expect(readRingLink("?ring=alarm:2026-10-22-7:30")).toBeNull();
    expect(readRingLink(`?ring=other:1&at=${NOW}`)).toBeNull();
    expect(readRingLink("?chog=375")).toBeNull();
  });

  it("sends the judge desk's rings back to the judge desk", () => {
    expect(ringPayload(ring("test:1", NOW), "judge")).toMatchObject({ path: "/judge", tag: "chog:test:1", ring: "test:1", at: NOW });
    expect(ringPayload(ring("test:1", NOW), "home").path).toBe("/");
  });
});
