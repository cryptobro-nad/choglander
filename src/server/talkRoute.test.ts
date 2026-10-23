import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OPTIONS, POST } from "@/app/api/talk/route";
import { AGENTS } from "@/lib/agents";
import type { TalkPass } from "@/lib/talkPass";
import { resetTalkCounts, TALK_IP_DAILY, TRIES_PER_CALL } from "@/server/talkLine";
import { signTalkPass } from "@/server/talkPass";

const SECRET = "test-secret-not-real-0123456789abcdef";
const KEY = "test-key-not-real";
const SIGNED = "wss://api.elevenlabs.io/v1/convai/conversation?agent_id=x&conversation_signature=sig";

const inHours = (hours: number) => Math.floor(Date.now() / 1000) + hours * 3600;
const passOf = (partial: Partial<TalkPass> = {}): TalkPass => ({ id: "Ab3dEf9h", name: "Alex", kind: "guest", exp: inHours(48), calls: 5, ...partial });

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://choglander.vercel.app/api/talk", {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": "203.0.113.7", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** ElevenLabs as a mock: a token for /token, a signed URL for /get-signed-url, or a given failure. */
function elevenLabs(status = 200, answer?: unknown) {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = answer ?? (url.includes("/get-signed-url") ? { signed_url: SIGNED } : { token: "lk-token-123" });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

const switchOn = () => {
  vi.stubEnv("ELEVENLABS_API_KEY", KEY);
  vi.stubEnv("TALK_PASS_SECRET", SECRET);
};

beforeEach(() => {
  resetTalkCounts();
  vi.stubEnv("ELEVENLABS_API_KEY", "");
  vi.stubEnv("TALK_PASS_SECRET", "");
  vi.stubEnv("TALK_PASS_REVOKED", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("/api/talk while invites are off", () => {
  it("vouches for a good pass once the secret is set, so a team pass lifts the daily cap, and ignores a bad one", async () => {
    vi.stubEnv("TALK_PASS_SECRET", SECRET);
    const fetcher = elevenLabs();
    const team = signTalkPass(passOf({ id: "Team0001", kind: "team", calls: null }), SECRET);
    const good = await POST(post({ archetype: "hype", connection: "webrtc", pass: team }));
    expect(good.status).toBe(200);
    expect(await good.json()).toMatchObject({ mode: "public", pass: { id: "Team0001", kind: "team", calls: null } });
    const forged = signTalkPass(passOf({ kind: "team" }), "another-secret-0123456789abcdefgh");
    expect(await (await POST(post({ archetype: "hype", connection: "webrtc", pass: forged }))).json()).toEqual({ mode: "public" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("says public, asks ElevenLabs nothing, and is never cached", async () => {
    const fetcher = elevenLabs();
    const res = await POST(post({ archetype: "hype", connection: "webrtc" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ mode: "public" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("stays public with only one of the two settings", async () => {
    vi.stubEnv("TALK_PASS_SECRET", SECRET);
    expect(await (await POST(post({ archetype: "hype", connection: "webrtc" }))).json()).toEqual({ mode: "public" });
    vi.stubEnv("TALK_PASS_SECRET", "");
    vi.stubEnv("ELEVENLABS_API_KEY", KEY);
    expect(await (await POST(post({ archetype: "hype", connection: "websocket", pass: "anything" }))).json()).toEqual({ mode: "public" });
  });

  it("answers the APK across origins, and only the app's origins", async () => {
    const res = await POST(post({ archetype: "golden", connection: "webrtc" }, { origin: "https://localhost" }));
    expect(res.headers.get("access-control-allow-origin")).toBe("https://localhost");
    const pre = OPTIONS(
      new Request("https://choglander.vercel.app/api/talk", {
        method: "OPTIONS",
        headers: { origin: "https://localhost", "access-control-request-method": "POST", "access-control-request-headers": "content-type" },
      }),
    );
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-methods")).toContain("POST");
    expect(pre.headers.get("access-control-allow-headers")).toContain("content-type");
    const evil = OPTIONS(new Request("https://choglander.vercel.app/api/talk", { method: "OPTIONS", headers: { origin: "https://evil.example" } }));
    expect(evil.status).toBe(403);
  });

  it("takes only JSON the app would send", async () => {
    const plain = new Request("https://choglander.vercel.app/api/talk", { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" });
    expect((await POST(plain)).status).toBe(415);
    expect((await POST(post("{nope"))).status).toBe(400);
    expect((await POST(post({ archetype: "villain", connection: "webrtc" }))).status).toBe(400);
    expect((await POST(post({ archetype: "hype", connection: "carrier-pigeon" }))).status).toBe(400);
    expect((await POST(post({ archetype: "toString", connection: "webrtc" }))).status).toBe(400);
    expect((await POST(post({ archetype: "hype", connection: "webrtc", pass: "x".repeat(5000) }))).status).toBe(413);
  });
});

describe("/api/talk with invites on", () => {
  beforeEach(switchOn);

  it("turns away a caller with no pass, a forged one, or one from another secret, without asking ElevenLabs", async () => {
    const fetcher = elevenLabs();
    const real = signTalkPass(passOf(), SECRET);
    const forged = `${Buffer.from(JSON.stringify(passOf({ kind: "team", calls: null }))).toString("base64url")}.${real.split(".")[1]}`;
    for (const pass of [undefined, "", "not-a-pass", forged, signTalkPass(passOf(), "another-secret-not-real-0123456789ab")]) {
      const res = await POST(post({ archetype: "hype", connection: "webrtc", pass }));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ reason: "no-pass" });
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("says when a pass has ended, or been revoked", async () => {
    const fetcher = elevenLabs();
    const old = signTalkPass(passOf({ exp: inHours(-1) }), SECRET);
    expect(await (await POST(post({ archetype: "hype", connection: "webrtc", pass: old }))).json()).toEqual({ reason: "expired" });
    vi.stubEnv("TALK_PASS_REVOKED", "Ab3dEf9h");
    const res = await POST(post({ archetype: "hype", connection: "webrtc", pass: signTalkPass(passOf(), SECRET) }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ reason: "expired" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("hands a pass holder a WebRTC token for that Chog's agent, asked for with the key", async () => {
    const fetcher = elevenLabs();
    const res = await POST(post({ archetype: "professor", connection: "webrtc", pass: signTalkPass(passOf(), SECRET) }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ mode: "private", token: "lk-token-123", pass: { id: "Ab3dEf9h", kind: "guest", calls: 5, exp: passOf().exp } });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(data)).not.toContain(KEY);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${AGENTS.professor}`);
    expect(init.headers).toEqual({ "xi-api-key": KEY });
    expect(init.cache).toBe("no-store");
  });

  it("hands over a signed websocket URL for the fallback route", async () => {
    const fetcher = elevenLabs();
    const res = await POST(post({ archetype: "legend", connection: "websocket", pass: signTalkPass(passOf({ kind: "team", calls: null }), SECRET) }));
    expect(await res.json()).toMatchObject({ mode: "private", signedUrl: SIGNED, pass: { kind: "team", calls: null } });
    expect(String(fetcher.mock.calls[0][0])).toBe(`https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${AGENTS.legend}`);
  });

  it("passes on an ElevenLabs refusal as a bad gateway, with its status", async () => {
    elevenLabs(401, { detail: { status: "invalid_api_key" } });
    const res = await POST(post({ archetype: "hype", connection: "webrtc", pass: signTalkPass(passOf(), SECRET) }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "upstream", status: 401 });
  });

  it("never hands over a websocket URL off ElevenLabs' hosts, or an empty token", async () => {
    elevenLabs(200, { signed_url: "wss://evil.example/socket" });
    const pass = signTalkPass(passOf(), SECRET);
    expect((await POST(post({ archetype: "hype", connection: "websocket", pass }))).status).toBe(502);
    elevenLabs(200, { token: "" });
    expect((await POST(post({ archetype: "hype", connection: "webrtc", pass }))).status).toBe(502);
  });

  it("says a guest's invite is used up once it has taken its share of lines on this server", async () => {
    const fetcher = elevenLabs();
    const pass = signTalkPass(passOf({ calls: 2 }), SECRET);
    for (let i = 0; i < 2 * TRIES_PER_CALL; i++) {
      expect((await POST(post({ archetype: "hype", connection: "webrtc", pass }))).status).toBe(200);
    }
    const res = await POST(post({ archetype: "hype", connection: "webrtc", pass }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ reason: "used-up" });
    expect(fetcher).toHaveBeenCalledTimes(2 * TRIES_PER_CALL);
  });

  it("limits how many lines one IP takes in a day", async () => {
    elevenLabs();
    const pass = signTalkPass(passOf({ kind: "judge", calls: null }), SECRET);
    for (let i = 0; i < TALK_IP_DAILY; i++) await POST(post({ archetype: "hype", connection: "webrtc", pass }));
    const res = await POST(post({ archetype: "hype", connection: "webrtc", pass }));
    expect(res.status).toBe(429);
    const other = await POST(post({ archetype: "hype", connection: "webrtc", pass }, { "x-real-ip": "198.51.100.2" }));
    expect(other.status).toBe(200);
  });

  it("puts no limit on the team's pass, not even the IP's day", async () => {
    elevenLabs();
    const pass = signTalkPass(passOf({ kind: "team", calls: null }), SECRET);
    for (let i = 0; i < TALK_IP_DAILY + 5; i++) {
      const res = await POST(post({ archetype: "hype", connection: "webrtc", pass }));
      expect(res.status).toBe(200);
    }
  });
});
