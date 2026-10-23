import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { artPath, IPFS_GATEWAYS } from "@/lib/ids";

type Handler = (url: string, init?: RequestInit) => Promise<Response>;
type Route = typeof import("@/app/api/art/[artId]/route");

/** A tiny but real-looking webp: RIFF, size, WEBP, then a chunk. */
function webp(seed = 1): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(32);
  bytes.set([0x52, 0x49, 0x46, 0x46, 24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);
  bytes[31] = seed;
  return bytes;
}

function image(seed = 1) {
  return new Response(webp(seed), { status: 200, headers: { "content-type": "image/webp" } });
}

function stubFetch(handler: Handler) {
  const spy = vi.fn(async (input: string | URL | Request, init?: RequestInit) => handler(String(input), init));
  vi.stubGlobal("fetch", spy);
  return spy;
}

/** Never answers until aborted, like a gateway that hangs. */
function hang(init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
  });
}

async function get(route: Route, artId: string) {
  return route.GET(new Request(`http://localhost/api/art/${artId}`), { params: Promise.resolve({ artId }) });
}

describe("GET /api/art/[artId]", () => {
  let route: Route;

  beforeEach(async () => {
    vi.resetModules();
    route = await import("@/app/api/art/[artId]/route");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("answers 404 for anything that is not an art number from 1 to 1969, without asking a gateway", async () => {
    const spy = stubFetch(async () => image());
    for (const bad of ["0", "1970", "9999", "abc", "0375", "1.5", "-1", "", "375.webp", "1e3", "12345"]) {
      const res = await get(route, bad);
      expect(res.status, bad).toBe(404);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("serves the official webp with CORS and a year of immutable caching", async () => {
    const spy = stubFetch(async () => image(7));
    const res = await get(route, "1000");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const cache = res.headers.get("cache-control") ?? "";
    expect(cache).toContain("public");
    expect(cache).toContain("s-maxage=31536000");
    expect(cache).toContain("immutable");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(webp(7));
    expect(spy.mock.calls[0][0]).toBe(`${IPFS_GATEWAYS[0]}/${artPath(1000)}`);
  });

  it("works through 429s and a gateway's HTML error page until one gives a real webp", async () => {
    const spy = stubFetch(async (url) => {
      if (url.startsWith(IPFS_GATEWAYS[0])) return new Response("slow down", { status: 429 });
      if (url.startsWith(IPFS_GATEWAYS[1])) return new Response("<html>gateway error</html>", { status: 200, headers: { "content-type": "text/html" } });
      return image(3);
    });
    const res = await get(route, "1");
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(webp(3));
    expect(spy.mock.calls.map(([url]) => String(url))).toEqual(IPFS_GATEWAYS.slice(0, 3).map((gateway) => `${gateway}/${artPath(1)}`));
  });

  it("starts the next gateway when one hangs, and does not wait for it", async () => {
    vi.useFakeTimers();
    const spy = stubFetch(async (url, init) => (url.startsWith(IPFS_GATEWAYS[0]) ? hang(init) : image(9)));
    const pending = get(route, "1969");
    await vi.advanceTimersByTimeAsync(1500);
    const res = await pending;
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(webp(9));
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("says 502 without caching when every gateway fails or times out", async () => {
    vi.useFakeTimers();
    const spy = stubFetch(async (url, init) => (url.startsWith(IPFS_GATEWAYS[1]) ? hang(init) : new Response("", { status: 429 })));
    const pending = get(route, "500");
    await vi.advanceTimersByTimeAsync(20_000);
    const res = await pending;
    expect(res.status).toBe(502);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(spy).toHaveBeenCalledTimes(IPFS_GATEWAYS.length);
  });

  it("asks the gateways once for a portrait that is requested twice at the same time, then serves it from memory", async () => {
    const spy = stubFetch(async () => image(5));
    const [a, b] = await Promise.all([get(route, "642"), get(route, "642")]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const again = await get(route, "642");
    expect(new Uint8Array(await again.arrayBuffer())).toEqual(webp(5));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("tries again on the next request after a failure", async () => {
    let up = false;
    const spy = stubFetch(async () => (up ? image(2) : new Response("", { status: 503 })));
    expect((await get(route, "77")).status).toBe(502);
    up = true;
    expect((await get(route, "77")).status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(IPFS_GATEWAYS.length + 1);
  });
});
