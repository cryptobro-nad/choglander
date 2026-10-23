import { describe, expect, it } from "vitest";
import { OPTIONS, POST } from "@/app/api/speak/route";
import * as voiceRoute from "@/app/api/voice/route";
import { corsHeaders } from "@/server/cors";

const context = {
  name: "Sam",
  artId: 375,
  archetype: "hype",
  traits: [],
  intent: "reminder",
  phase: "day",
  weekday: "Monday",
  clock: "9:10 am",
  spokenClock: "ten past nine",
  weather: null,
  nextEvent: { title: "Standup", when: "half past nine", minutesUntil: 20 },
  pastEvent: null,
  memory: [],
  streak: 0,
  nonce: 3,
  recentIds: [],
};

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/speak", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("/api/speak CORS", () => {
  it.each(["https://localhost", "http://localhost", "capacitor://localhost"])("answers the preflight from %s", (origin) => {
    const res = OPTIONS(
      new Request("http://localhost/api/speak", {
        method: "OPTIONS",
        headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "content-type, x-chog-device" },
      }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(origin);
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
    expect(res.headers.get("access-control-allow-headers")).toContain("x-chog-device");
    expect(res.headers.get("vary")).toBe("Origin");
  });

  it("refuses the preflight from any other origin", () => {
    const res = OPTIONS(new Request("http://localhost/api/speak", { method: "OPTIONS", headers: { origin: "https://evil.example" } }));
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("adds the allow-origin header to the app's POST", async () => {
    const res = await POST(post({ context }, { origin: "https://localhost" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://localhost");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const data = (await res.json()) as { caption: string; engine: string };
    expect(data.engine).toBe("mock");
    expect(data.caption.length).toBeGreaterThan(8);
  });

  it("allows extra origins only from CHOG_CORS_ORIGINS", () => {
    expect(corsHeaders("https://preview.example", { CHOG_CORS_ORIGINS: "https://preview.example/" })["Access-Control-Allow-Origin"]).toBe(
      "https://preview.example",
    );
    expect(corsHeaders("https://preview.example", {})["Access-Control-Allow-Origin"]).toBeUndefined();
  });
});

describe("/api/speak content type", () => {
  const raw = (headers: Record<string, string>) =>
    new Request("http://localhost/api/speak", { method: "POST", headers, body: JSON.stringify({ context }) });

  it.each([
    ["text/plain", { "content-type": "text/plain;charset=UTF-8", origin: "https://evil.example" }],
    ["a form", { "content-type": "application/x-www-form-urlencoded", origin: "https://evil.example" }],
    ["multipart", { "content-type": "multipart/form-data; boundary=x" }],
    ["a bare string body (typed text/plain by fetch)", {}],
  ])("refuses %s with 415 before writing a line", async (_label, headers) => {
    const res = await POST(raw(headers));
    expect(res.status).toBe(415);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(((await res.json()) as { caption?: string }).caption).toBeUndefined();
  });

  it("accepts JSON with a charset", async () => {
    const res = await POST(raw({ "content-type": "Application/JSON; charset=utf-8" }));
    expect(res.status).toBe(200);
  });
});

describe("/api/speak input", () => {
  it("rejects a bad body, a bad enum and an oversized payload", async () => {
    expect((await POST(post("not json"))).status).toBe(400);
    expect((await POST(post({}))).status).toBe(400);
    expect((await POST(post({ context: { ...context, archetype: "pirate" } }))).status).toBe(400);
    expect((await POST(post({ context: { ...context, intent: "monologue" } }))).status).toBe(400);
    expect((await POST(post({ context: { ...context, padding: "x".repeat(20_000) } }))).status).toBe(413);
  });

  it("never speaks more than the clamped title", async () => {
    const title = `Board review ${"and then some more words ".repeat(80)}`;
    const res = await POST(post({ context: { ...context, nextEvent: { title, when: "soon", minutesUntil: 10 } } }));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { caption: string; text: string };
    expect(data.text.length).toBeLessThanOrEqual(320);
    expect(data.caption).not.toContain("and then some more words and then some more words and then some more words");
  });
});

describe("/api/voice route", () => {
  it("answers the app's preflight, and refuses a request without a valid ticket", async () => {
    const pre = voiceRoute.OPTIONS(new Request("http://localhost/api/voice", { method: "OPTIONS", headers: { origin: "https://localhost" } }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS");
    const res = await voiceRoute.GET(new Request("http://localhost/api/voice?t=forged.ticket", { headers: { origin: "https://localhost" } }));
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://localhost");
    expect((await voiceRoute.HEAD(new Request("http://localhost/api/voice", { method: "HEAD" }))).status).toBe(403);
    expect(voiceRoute.maxDuration).toBeGreaterThanOrEqual(25);
  });
});
