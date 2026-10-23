import { afterEach, describe, expect, it, vi } from "vitest";
import {
  allowance,
  askForLine,
  countCall,
  InviteOnly,
  LIVE_CALLS_PER_DAY,
  logCall,
  logInviteCall,
  readCallLog,
  readInviteLog,
  refundInviteCall,
  troubleOf,
  uncountCall,
  writeCallLog,
  writeInviteLog,
  type HeldPass,
} from "@/lib/liveCall";

const NOW = new Date(2026, 9, 21, 8, 0);
const guest: HeldPass = { id: "Ab3dEf9h", kind: "guest", calls: 5 };
const judge: HeldPass = { id: "Jd3dEf9h", kind: "judge", calls: null };
const team: HeldPass = { id: "Tm3dEf9h", kind: "team", calls: null };
const usedToday = (count: number) => Array.from({ length: count }).reduce<ReturnType<typeof logCall> | null>((log) => logCall(log, NOW), null);

describe("what counts a caller's live calls", () => {
  it("is the day's count without a pass, or with a judge's", () => {
    expect(allowance(null, null, {}, NOW)).toEqual({ left: LIVE_CALLS_PER_DAY, on: "today" });
    expect(allowance(null, usedToday(5), {}, NOW)).toEqual({ left: 0, on: "today" });
    expect(allowance(judge, usedToday(2), {}, NOW)).toEqual({ left: 3, on: "today" });
    expect(allowance(judge, usedToday(5), {}, NOW)).toEqual({ left: 0, on: "today" });
  });

  it("lets the team past the daily cap", () => {
    expect(allowance(team, usedToday(9), {}, NOW)).toEqual({ left: Number.POSITIVE_INFINITY, on: "unlimited" });
    expect(allowance({ ...team, calls: 20 }, usedToday(9), { [team.id]: 4 }, NOW)).toEqual({ left: 16, on: "invite" });
  });

  it("counts a guest's invite and the day together, whichever runs out first", () => {
    expect(allowance(guest, null, {}, NOW)).toEqual({ left: 5, on: "invite" });
    expect(allowance(guest, usedToday(1), { [guest.id]: 1 }, NOW)).toEqual({ left: 4, on: "invite" });
    expect(allowance(guest, usedToday(4), {}, NOW)).toEqual({ left: 1, on: "today" });
    expect(allowance(guest, usedToday(5), { [guest.id]: 5 }, NOW)).toEqual({ left: 0, on: "invite" });
    expect(allowance(guest, null, { other: 5 }, NOW)).toEqual({ left: 5, on: "invite" });
  });
});

describe("an invite's call count on the device", () => {
  it("counts calls by pass, gives one back, and never goes below none", () => {
    let log = logInviteCall({}, guest.id);
    log = logInviteCall(log, guest.id);
    expect(log).toEqual({ [guest.id]: 2 });
    expect(refundInviteCall(log, guest.id)).toEqual({ [guest.id]: 1 });
    expect(refundInviteCall({}, guest.id)).toEqual({});
    expect(refundInviteCall({ [guest.id]: 0 }, guest.id)).toEqual({ [guest.id]: 0 });
  });

  it("keeps the newest twenty invites", () => {
    let log = {};
    for (let i = 0; i < 25; i += 1) log = logInviteCall(log, `pass-${i}`);
    expect(log).not.toHaveProperty("pass-4");
    log = logInviteCall(log, "pass-5");
    expect(Object.keys(log)).toHaveLength(20);
    expect(Object.keys(log).at(-1)).toBe("pass-5");
    log = logInviteCall(log, "pass-new");
    expect(log).toHaveProperty("pass-5", 2);
    expect(log).not.toHaveProperty("pass-6");
  });

  it("keeps the count on the device, and in memory when the device won't", () => {
    const saved = new Map<string, string>();
    const storage = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => void saved.set(key, value) };
    writeInviteLog({ [guest.id]: 3 }, storage);
    expect(readInviteLog(storage)).toEqual({ [guest.id]: 3 });
    saved.set([...saved.keys()][0], JSON.stringify({ [guest.id]: 3, bad: "x", worse: -1 }));
    expect(readInviteLog(storage)).toEqual({ [guest.id]: 3 });
    const blocked = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(() => writeInviteLog({ [guest.id]: 4 }, blocked)).not.toThrow();
    expect(readInviteLog(blocked)).toEqual({ [guest.id]: 4 });
  });
});

describe("asking /api/talk for a way onto the line", () => {
  afterEach(() => vi.unstubAllGlobals());

  const answer = (status: number, body: unknown) => {
    const fetcher = vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));
    vi.stubGlobal("fetch", fetcher);
    return fetcher;
  };
  const ask = (route: "webrtc" | "websocket" = "webrtc", pass: string | null = "the.pass") => askForLine("hype", route, pass, { origin: "https://chog.example", native: false });

  it("sends the archetype, the route and the pass, as JSON, to the API origin", async () => {
    const fetcher = answer(200, { mode: "public" });
    expect(await ask()).toEqual({ mode: "public", reached: true });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://chog.example/api/talk");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(String(init.body))).toEqual({ archetype: "hype", connection: "webrtc", pass: "the.pass" });
    await ask("websocket", null);
    expect(JSON.parse(String((fetcher.mock.calls[1] as unknown as [string, RequestInit])[1].body))).toEqual({ archetype: "hype", connection: "websocket" });
  });

  it("asks nothing in an APK built without a server", async () => {
    const fetcher = answer(200, { mode: "public" });
    expect(await askForLine("hype", "webrtc", null, { origin: "", native: true })).toEqual({ mode: "public", reached: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("takes the credential for the route it asked about, with the pass the server vouched for", async () => {
    answer(200, { mode: "private", token: "lk-token", pass: { id: "Ab3dEf9h", kind: "guest", calls: 5, exp: 1 } });
    expect(await ask()).toEqual({ mode: "private", token: "lk-token", pass: guest });
    answer(200, { mode: "private", signedUrl: "wss://api.elevenlabs.io/x?sig=1", pass: { id: "Tm3dEf9h", kind: "team", calls: null } });
    expect(await ask("websocket")).toEqual({ mode: "private", signedUrl: "wss://api.elevenlabs.io/x?sig=1", pass: team });
    answer(200, { mode: "private", signedUrl: "wss://api.elevenlabs.io/x", pass: guest });
    await expect(ask("webrtc")).rejects.toThrow(/no way in/);
  });

  it("hears an invite-only answer for each reason", async () => {
    for (const reason of ["no-pass", "expired", "used-up"]) {
      answer(403, { reason });
      expect(await ask()).toEqual({ mode: "invite", reason });
    }
  });

  it("words a refusal on the server's side so the call screen names it", async () => {
    answer(429, { error: "busy" });
    expect(troubleOf(await ask().catch((error) => error))).toBe("busy");
    answer(502, { error: "upstream", status: 401 });
    expect(troubleOf(await ask().catch((error) => error))).toBe("refused");
    answer(502, { error: "upstream", status: 429 });
    expect(troubleOf(await ask().catch((error) => error))).toBe("busy");
    answer(502, { error: "upstream" });
    expect(troubleOf(await ask().catch((error) => error))).toBe("dropped");
  });

  it("dials as before when the server can't be reached or answers something else", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    expect(await ask()).toEqual({ mode: "public", reached: false });
    for (const [status, body] of [
      [404, "<html>Not found</html>"],
      [500, { error: "oops" }],
      [403, "<html>Forbidden</html>"],
      [200, { mode: "something-new" }],
    ] as const) {
      answer(status, body);
      expect(await ask()).toEqual({ mode: "public", reached: false });
    }
  });

  it("gives up waiting after its timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))),
      ),
    );
    const pending = askForLine("hype", "webrtc", null, { origin: "https://chog.example", native: false, timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toEqual({ mode: "public", reached: false });
    vi.useRealTimers();
  });

  it("names an invite refusal raised mid-dial apart from a dropped line", () => {
    const refusal = new InviteOnly("used-up");
    expect(refusal.reason).toBe("used-up");
    expect(refusal).toBeInstanceOf(Error);
  });
});

describe("counting a call, or a typed chat, as it connects", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** A device whose storage starts with no calls counted. */
  const onDevice = () => {
    const saved = new Map<string, string>();
    vi.stubGlobal("window", { localStorage: { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => void saved.set(key, value) } });
    writeCallLog({ day: "", count: 0 });
    writeInviteLog({});
    return saved;
  };

  it("takes one of today's calls for each, a chat the same as a call", () => {
    onDevice();
    expect(countCall(null, NOW)).toEqual({ left: LIVE_CALLS_PER_DAY - 1, on: "today" });
    expect(countCall(null, NOW)).toEqual({ left: LIVE_CALLS_PER_DAY - 2, on: "today" });
    expect(readCallLog()?.count).toBe(2);
    expect(readInviteLog()).toEqual({});
  });

  it("takes one of a guest's invite calls too, and none from a judge's", () => {
    onDevice();
    expect(countCall(guest, NOW)).toEqual({ left: 4, on: "invite" });
    expect(readInviteLog()).toEqual({ [guest.id]: 1 });
    expect(countCall(judge, NOW)).toEqual({ left: LIVE_CALLS_PER_DAY - 2, on: "today" });
    expect(readInviteLog()).toEqual({ [guest.id]: 1 });
    expect(countCall(team, NOW)).toEqual({ left: Number.POSITIVE_INFINITY, on: "unlimited" });
  });

  it("gives a call back on the day and on the invite when the line turned it away", () => {
    onDevice();
    countCall(guest, NOW);
    countCall(guest, NOW);
    expect(uncountCall(guest, NOW)).toEqual({ left: 4, on: "invite" });
    expect(readCallLog()?.count).toBe(1);
    expect(readInviteLog()).toEqual({ [guest.id]: 1 });
    uncountCall(guest, NOW);
    expect(uncountCall(guest, NOW)).toEqual({ left: 5, on: "invite" });
    expect(readCallLog()?.count).toBe(0);
  });

  it("keeps the counts on the device, where the next call reads them", () => {
    const saved = onDevice();
    countCall(guest, NOW);
    expect(JSON.parse(saved.get("chog-calls-v1:live-calls") ?? "{}").count).toBe(1);
    expect(JSON.parse(saved.get("chog-calls-v1:invite-calls") ?? "{}")).toEqual({ [guest.id]: 1 });
    expect(allowance(guest, readCallLog(), readInviteLog(), NOW)).toEqual({ left: 4, on: "invite" });
  });
});
