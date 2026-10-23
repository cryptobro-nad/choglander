import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JUDGE_KEY, KEY, SEED_VERSION, cleanEvents, defaultSaved, loadSaved, prepareSaved, recallMeta, rememberMeta, seedEvents } from "@/lib/persist";
import type { CalEvent, SavedState } from "@/lib/types";

const now = new Date(2026, 9, 18, 9, 0);

function mine(id: string): CalEvent {
  return {
    id,
    title: "Dentist",
    start: new Date(2026, 9, 20, 15, 0).toISOString(),
    end: new Date(2026, 9, 20, 16, 0).toISOString(),
    allDay: false,
    recurrence: "none",
    reminderMin: 10,
    color: "rose",
    notes: "",
  };
}

describe("seeding", () => {
  it("adds the demo day once and keeps the person's own events", () => {
    const first = prepareSaved({ ...defaultSaved(), events: [mine("ev-1")] }, now);
    expect(first.state.seeded).toBe(true);
    expect(first.changed).toBe(true);
    expect(first.state.events.some((item) => item.id === "ev-1")).toBe(true);
    expect(first.state.events.filter((item) => item.id.startsWith("seed-")).length).toBe(seedEvents(now).length);
  });

  it("never brings the demo calendar back after the person deleted it", () => {
    const emptied: SavedState = { ...defaultSaved(), seeded: true, events: [] };
    const again = prepareSaved(emptied, now, { seedVersion: SEED_VERSION });
    expect(again.state.events).toEqual([]);
    expect(again.changed).toBe(false);
    // Even an older install that predates the marker keeps an emptied calendar empty.
    expect(prepareSaved(emptied, now, { seedVersion: 0 }).state.events).toEqual([]);
  });

  it("refreshes stale demo blocks once, leaving the person's events alone", () => {
    const old = seedEvents(new Date(2026, 9, 4, 9, 0)).slice(0, 3);
    const stale: SavedState = { ...defaultSaved(), seeded: true, events: [...old, mine("ev-1")] };
    const upgraded = prepareSaved(stale, now, { seedVersion: 0 });
    expect(upgraded.changed).toBe(true);
    expect(upgraded.seedVersion).toBe(SEED_VERSION);
    expect(upgraded.state.events.some((item) => item.id === "ev-1")).toBe(true);
    expect(upgraded.state.events.filter((item) => item.id.startsWith("seed-")).length).toBe(seedEvents(now).length);
    const settled = prepareSaved(upgraded.state, now, { seedVersion: upgraded.seedVersion });
    expect(settled.changed).toBe(false);
    expect(settled.state).toBe(upgraded.state);
  });

  it("renames the v2 week's market in place, so no sample block mentions a market and nothing else changes", () => {
    // The v2 week had a "Farmers market" on Saturdays; the pitch says the app never talks markets.
    const v2 = seedEvents(new Date(2026, 9, 4, 9, 0)).map((item) => ({
      ...item,
      id: item.id.replace(/^seed-v\d+-/, "seed-v2-").replace("bakery", "market"),
      title: item.title === "Bakery run" ? "Farmers market" : item.title === "Book club" ? "Book club with Ana" : item.title,
    }));
    // The person had deleted the gym blocks and renamed the book club.
    const kept = v2.filter((item) => !item.id.includes("gym"));
    const stale: SavedState = { ...defaultSaved(), seeded: true, events: [...kept, mine("ev-1")] };
    const upgraded = prepareSaved(stale, now, { seedVersion: 2 });
    expect(SEED_VERSION).toBe(3);
    expect(upgraded.changed).toBe(true);
    expect(upgraded.seedVersion).toBe(SEED_VERSION);
    expect(upgraded.state.events.some((item) => item.id === "ev-1")).toBe(true);
    expect(upgraded.state.events.some((item) => /market/i.test(item.title))).toBe(false);
    expect(upgraded.state.events.find((item) => item.title === "Bakery run")?.id).toBe("seed-v3-bakery");
    expect(upgraded.state.events.some((item) => item.id.includes("gym"))).toBe(false);
    expect(upgraded.state.events.some((item) => item.title === "Book club with Ana")).toBe(true);
    expect(upgraded.state.events.length).toBe(stale.events.length);
    const settled = prepareSaved(upgraded.state, now, { seedVersion: upgraded.seedVersion });
    expect(settled.changed).toBe(false);
  });

  it("lays the sample week out at its own hours again after a move to another time zone", () => {
    // Seeded where clocks read 14 hours later: here every sample block sits at the wrong hour.
    const shift = (iso: string) => new Date(Date.parse(iso) - 14 * 3_600_000).toISOString();
    const away = seedEvents(now)
      .filter((item) => !item.id.includes("gym"))
      .map((item) => ({ ...item, start: shift(item.start), end: shift(item.end) }));
    const state: SavedState = { ...defaultSaved(), seeded: true, events: [...away, mine("ev-1")] };
    const moved = prepareSaved(state, now, { seedVersion: SEED_VERSION });
    expect(moved.changed).toBe(true);
    const standup = moved.state.events.find((item) => item.id === `seed-v${SEED_VERSION}-standup`);
    expect(standup && [new Date(standup.start).getHours(), new Date(standup.start).getMinutes()]).toEqual([9, 30]);
    // Deleted samples stay deleted, and the person's own event is untouched.
    expect(moved.state.events.some((item) => item.id.includes("gym"))).toBe(false);
    expect(moved.state.events.find((item) => item.id === "ev-1")).toEqual(mine("ev-1"));
    expect(moved.state.events.length).toBe(state.events.length);
    expect(prepareSaved(moved.state, now, { seedVersion: SEED_VERSION }).changed).toBe(false);
    // A later week in the same zone moves nothing.
    expect(prepareSaved(moved.state, new Date(2026, 10, 2, 8, 0), { seedVersion: SEED_VERSION }).changed).toBe(false);
  });

  it("gives the judge desk its sample week back once its calendar is left empty, and only then", () => {
    const emptied: SavedState = { ...defaultSaved(), seeded: true, onboarded: true, events: [] };
    const back = prepareSaved(emptied, now, { judge: true, seedVersion: SEED_VERSION });
    expect(back.changed).toBe(true);
    expect(back.state.events.map((item) => item.id)).toEqual(seedEvents(now).map((item) => item.id));
    expect(prepareSaved(back.state, now, { judge: true, seedVersion: SEED_VERSION }).changed).toBe(false);
    // A judge who cleared the sample week and added their own block keeps just that.
    const own: SavedState = { ...emptied, events: [mine("ev-1")] };
    expect(prepareSaved(own, now, { judge: true, seedVersion: SEED_VERSION }).state.events).toEqual([mine("ev-1")]);
  });

  it("opens the judge desk onboarded with Chog #642, the Hype Man, keeping a name already given", () => {
    const judge = prepareSaved(defaultSaved(), now, { judge: true });
    expect(judge.state.onboarded).toBe(true);
    expect(judge.state.artId).toBe(642);
    expect(judge.state.userName).toBe("Judge");
    const named = prepareSaved({ ...defaultSaved(), userName: "Mara" }, now, { judge: true });
    expect(named.state.userName).toBe("Mara");
    expect(prepareSaved(defaultSaved(), now).state.onboarded).toBe(false);
  });
});

function fakeBrowser(search = "") {
  const data = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, String(value)),
    removeItem: (key: string) => void data.delete(key),
  };
  const location = { href: `https://chog.test/judge${search}` };
  const history = {
    state: null,
    replaceState: (_state: unknown, _title: string, url: string) => {
      location.href = `https://chog.test${url}`;
    },
  };
  const heard: ((event: { key: string | null; newValue: string | null; storageArea: unknown }) => void)[] = [];
  const addEventListener = (type: string, listener: (typeof heard)[number]) => {
    if (type === "storage") heard.push(listener);
  };
  vi.stubGlobal("window", { localStorage, location, history, addEventListener });
  /** Another tab saving `value` under `key`: the store sees it as the browser's storage event. */
  const otherTab = (key: string, value: string) => {
    data.set(key, value);
    heard.forEach((listener) => listener({ key, newValue: value, storageArea: localStorage }));
  };
  return { data, location, otherTab };
}

describe("saved store", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is empty on the server", async () => {
    const mod = await import("@/lib/persist");
    expect(mod.savedStore(false).get()).toBeNull();
  });

  it("keeps the judge desk apart from the phone and notifies on change", async () => {
    const { data } = fakeBrowser();
    const mod = await import("@/lib/persist");
    const phone = mod.savedStore(false);
    const judge = mod.savedStore(true);
    expect(judge.key).toBe(JUDGE_KEY);
    expect(phone.key).toBe(KEY);
    expect(judge.get()?.artId).toBe(642);
    expect(phone.get()?.onboarded).toBe(false);
    const heard = vi.fn();
    const off = judge.subscribe(heard);
    judge.set({ userName: "Ines" });
    expect(heard).toHaveBeenCalledTimes(1);
    expect(JSON.parse(data.get(JUDGE_KEY) ?? "{}").userName).toBe("Ines");
    expect(JSON.parse(data.get(KEY) ?? "{}").userName).toBe("");
    off();
    judge.set((prev) => ({ ...prev, mute: true }));
    expect(heard).toHaveBeenCalledTimes(1);
    expect(mod.savedStore(true)).toBe(judge);
  });

  it("moves a judge desk saved on #375 over to the Hype Man once, then lets a judge pick #375 again", async () => {
    const { data } = fakeBrowser();
    const first = await import("@/lib/persist");
    first.savedStore(true).set({ artId: 375 });
    data.delete(`${KEY}:flag:judge-main-act`);
    vi.resetModules();
    const second = await import("@/lib/persist");
    expect(second.savedStore(true).get()?.artId).toBe(642);
    second.savedStore(true).set({ artId: 375 });
    vi.resetModules();
    const third = await import("@/lib/persist");
    expect(third.savedStore(true).get()?.artId).toBe(375);
  });

  it("honours ?reset=1 once and drops it from the address", async () => {
    const first = fakeBrowser();
    const mod = await import("@/lib/persist");
    mod.savedStore(true).set({ userName: "Old judge" });
    expect(JSON.parse(first.data.get(JUDGE_KEY) ?? "{}").userName).toBe("Old judge");

    vi.resetModules();
    const { data, location } = fakeBrowser("?reset=1&sky=morning");
    data.set(JUDGE_KEY, first.data.get(JUDGE_KEY) ?? "");
    const fresh = await import("@/lib/persist");
    const state = fresh.savedStore(true).get();
    expect(state?.userName).toBe("Judge");
    expect(location.href).toBe("https://chog.test/judge?sky=morning");
  });

  it("starts over on reset()", async () => {
    fakeBrowser();
    const mod = await import("@/lib/persist");
    const phone = mod.savedStore(false);
    phone.set({ onboarded: true, artId: 642, userName: "Sam" });
    phone.reset();
    expect(phone.get()?.onboarded).toBe(false);
    expect(phone.get()?.userName).toBe("");
    expect(phone.get()?.seeded).toBe(true);
  });

  const PASS = `${"e".repeat(40)}.${"s".repeat(43)}`;

  it("takes a ?pass= invite from the address and leaves the rest of it", async () => {
    const { location } = fakeBrowser(`?pass=${PASS}&sky=night`);
    const mod = await import("@/lib/persist");
    expect(mod.takePassParam()).toBe(PASS);
    expect(location.href).toBe("https://chog.test/judge?sky=night");
    expect(mod.takePassParam()).toBeNull();
    const junk = fakeBrowser("?pass=<script>");
    expect(mod.takePassParam()).toBeNull();
    expect(junk.location.href).toBe("https://chog.test/judge");
  });

  it("keeps the invite through starting over, by reset() or ?reset=1", async () => {
    const first = fakeBrowser();
    const mod = await import("@/lib/persist");
    const judge = mod.savedStore(true);
    judge.set((prev) => mod.withTalkPass({ ...prev, userName: "Old judge" }, PASS));
    judge.reset();
    expect(judge.get()?.userName).toBe("Judge");
    expect(judge.get()?.talkPass).toBe(PASS);

    vi.resetModules();
    const { data } = fakeBrowser("?reset=1");
    data.set(JUDGE_KEY, first.data.get(JUDGE_KEY) ?? "");
    const fresh = await import("@/lib/persist");
    expect(fresh.savedStore(true).get()?.talkPass).toBe(PASS);
    expect(JSON.parse(data.get(JUDGE_KEY) ?? "{}").talkPass).toBe(PASS);
  });

  it("finds an invite kept on the other desk, and ignores one out of shape", async () => {
    const { data } = fakeBrowser();
    const mod = await import("@/lib/persist");
    const phone = mod.savedStore(false);
    expect(mod.heldPass(true, mod.savedStore(true).get())).toBeNull();
    phone.set((prev) => mod.withTalkPass(prev, PASS));
    expect(mod.heldPass(false, phone.get())).toBe(PASS);
    expect(mod.heldPass(true, mod.savedStore(true).get())).toBe(PASS);
    expect(mod.withTalkPass(phone.get() as SavedState, "nope").talkPass).toBe(PASS);
    data.set(KEY, JSON.stringify({ ...phone.get(), talkPass: 42 }));
    expect(mod.heldPass(true, null)).toBeNull();
  });

  it("forgets a removed invite on both desks, and tells this desk's listeners", async () => {
    const { data } = fakeBrowser();
    const mod = await import("@/lib/persist");
    const judge = mod.savedStore(true);
    judge.set((prev) => mod.withTalkPass(prev, PASS));
    // The phone desk kept one too, in another tab: heldPass would find it there.
    data.set(KEY, JSON.stringify({ ...mod.defaultSaved(), talkPass: PASS }));
    const heard = vi.fn();
    judge.subscribe(heard);
    mod.dropTalkPass(true);
    expect(judge.get()?.talkPass).toBeUndefined();
    expect(JSON.parse(data.get(JUDGE_KEY) ?? "{}")).not.toHaveProperty("talkPass");
    expect(JSON.parse(data.get(KEY) ?? "{}")).not.toHaveProperty("talkPass");
    expect(JSON.parse(data.get(KEY) ?? "{}").version).toBe(1);
    expect(mod.heldPass(true, judge.get())).toBeNull();
    expect(heard).toHaveBeenCalledTimes(1);
    // With none held anywhere, it still breaks nothing.
    expect(() => mod.dropTalkPass(true)).not.toThrow();
    expect(mod.heldPass(false, null)).toBeNull();
  });

  it("forgets the invite on the other desk's store when this page has it open", async () => {
    fakeBrowser();
    const mod = await import("@/lib/persist");
    const phone = mod.savedStore(false);
    phone.set((prev) => mod.withTalkPass(prev, PASS));
    mod.dropTalkPass(true);
    expect(phone.get()?.talkPass).toBeUndefined();
    expect(mod.heldPass(true, mod.savedStore(true).get())).toBeNull();
  });

  it("takes another tab's newer save, so its own next save keeps that tab's change", async () => {
    const { data, otherTab } = fakeBrowser();
    const mod = await import("@/lib/persist");
    const judge = mod.savedStore(true);
    const heard = vi.fn();
    judge.subscribe(heard);
    const elsewhere: SavedState = { ...(judge.get() as SavedState), userName: "Alice" };
    otherTab(JUDGE_KEY, JSON.stringify(elsewhere));
    expect(heard).toHaveBeenCalledTimes(1);
    expect(judge.get()?.userName).toBe("Alice");
    judge.set({ city: "Oslo" });
    const saved = JSON.parse(data.get(JUDGE_KEY) ?? "{}") as SavedState;
    expect([saved.userName, saved.city]).toEqual(["Alice", "Oslo"]);
    // Another desk's key changes nothing here.
    otherTab(KEY, JSON.stringify({ ...elsewhere, userName: "Phone" }));
    expect(judge.get()?.userName).toBe("Alice");
  });
});

describe("metadata cache", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("remembers the last few Chogs so they open offline", () => {
    fakeBrowser();
    const meta = { name: "CHOG #1000", image: "ipfs://cid/1000.webp", attributes: [{ trait_type: "Side", value: "Right" }] };
    rememberMeta(1000, meta);
    expect(recallMeta(1000)).toEqual(meta);
    for (let art = 1; art <= 9; art++) rememberMeta(art, { ...meta, name: `CHOG #${art}` });
    expect(recallMeta(9)?.name).toBe("CHOG #9");
    expect(recallMeta(1000)).toBeNull();
    expect(recallMeta(5)).not.toBeNull();
  });
});

describe("loading a damaged calendar", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const broken = [
    mine("good"),
    { ...mine("no-title"), title: 42 },
    { ...mine("bad-start"), start: "next Tuesday-ish" },
    { ...mine("bad-end"), end: null },
    { ...mine("x"), id: 7 },
    null,
    "Dentist",
    { id: "bare", title: "Bare", start: mine("bare").start, end: mine("bare").end },
    { ...mine("backwards"), end: new Date(2026, 9, 20, 14, 0).toISOString() },
    { ...mine("good"), title: "A second copy of good" },
  ];

  it("drops events with no string id or title, or a start or end that is not a date", () => {
    const events = cleanEvents(broken);
    expect(events.map((event) => event.id)).toEqual(["good", "bare", "backwards"]);
    expect(events[0]).toEqual(mine("good"));
  });

  it("fills in what an old or partial event is missing", () => {
    const bare = cleanEvents(broken).find((event) => event.id === "bare");
    expect(bare).toMatchObject({ allDay: false, recurrence: "none", reminderMin: null, color: "sky", notes: "" });
    const backwards = cleanEvents(broken).find((event) => event.id === "backwards");
    expect(backwards?.end).toBe(backwards?.start);
    expect(cleanEvents({ not: "a list" })).toEqual([]);
  });

  it("opens the saved state instead of crashing", () => {
    const data = new Map<string, string>();
    data.set(KEY, JSON.stringify({ ...defaultSaved(), onboarded: true, artId: 642, events: broken }));
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => data.set(key, value),
        removeItem: (key: string) => data.delete(key),
      },
    });
    const state = loadSaved(KEY);
    expect(state.onboarded).toBe(true);
    expect(state.artId).toBe(642);
    expect(state.events.map((event) => event.id)).toEqual(["good", "bare", "backwards"]);
  });
});
