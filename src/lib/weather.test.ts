import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWeatherHere, lastWeatherHere, WEATHER_KEEP_MS, weatherHere, weatherQuery } from "@/lib/weather";
import { GET, OPTIONS } from "@/app/api/weather/route";

const SUNNY = { current: { temperature_2m: 18.4, weather_code: 0, wind_speed_10m: 6 } };

function stubFetch(handler: (url: string) => Response | Promise<Response>) {
  const spy = vi.fn(async (input: string | URL | Request) => handler(String(input)));
  vi.stubGlobal("fetch", spy);
  return spy;
}

/** The geolocation headers Vercel adds to every request. */
function geo(lat: string, lon: string, city?: string) {
  const headers = new Headers({ "x-vercel-ip-latitude": lat, "x-vercel-ip-longitude": lon });
  if (city !== undefined) headers.set("x-vercel-ip-city", city);
  return headers;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("weatherQuery", () => {
  it("reads the visitor's IP position, with the city decoded", () => {
    expect(weatherQuery(geo("-23.55", "-46.63", "S%C3%A3o%20Paulo"))).toEqual({ lat: -23.55, lon: -46.63, place: "São Paulo" });
    expect(weatherQuery(geo("51.5", "-0.12"))).toEqual({ lat: 51.5, lon: -0.12, place: "here" });
    expect(weatherQuery(geo("51.5", "-0.12", "%E0%A4%A"))?.place).toBe("%E0%A4%A");
  });

  it("knows nowhere without it, and never reads a missing coordinate as 0", () => {
    expect(weatherQuery(new Headers())).toBeNull();
    expect(weatherQuery(geo("", ""))).toBeNull();
    expect(weatherQuery(geo("95", "2"))).toBeNull();
    expect(weatherQuery(geo("abc", "2"))).toBeNull();
  });
});

describe("GET /api/weather", () => {
  it("reads the weather where the visitor is when no coordinates are given", async () => {
    const spy = stubFetch(() => Response.json(SUNNY));
    const res = await GET(new Request("http://localhost/api/weather", { headers: geo("52.52", "13.4", "Berlin") }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ kind: "clear", tempC: 18.4, phrase: "clear and 18 degrees", place: "Berlin" });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toContain("latitude=52.52&longitude=13.4");
    // It depends on who asks: a shared cache must never hand it to someone else.
    expect(res.headers.get("cache-control")).toBe("private, max-age=900");
  });

  it("is no proxy: coordinates and a place in the address are ignored, never echoed", async () => {
    const spy = stubFetch(() => Response.json(SUNNY));
    const res = await GET(new Request("http://localhost/api/weather?lat=40.7&lon=-74&place=%3Cb%3Ehi%3C%2Fb%3E", { headers: geo("1", "2", "Elsewhere") }));
    expect((await res.json()).place).toBe("Elsewhere");
    expect(spy.mock.calls[0][0]).toContain("latitude=1&longitude=2");
    expect((await GET(new Request("http://localhost/api/weather?lat=40.7&lon=-74"))).status).toBe(400);
  });

  it("answers 400 with no position at all, and 502 when the weather can't be read", async () => {
    const spy = stubFetch(() => Response.json(SUNNY));
    const lost = await GET(new Request("http://localhost/api/weather"));
    expect(lost.status).toBe(400);
    expect(await lost.json()).toEqual({ error: "position unknown" });
    expect(spy).not.toHaveBeenCalled();

    stubFetch(() => {
      throw new Error("offline");
    });
    expect((await GET(new Request("http://localhost/api/weather", { headers: geo("52.52", "13.4") }))).status).toBe(502);
    stubFetch(() => new Response("busy", { status: 503 }));
    expect((await GET(new Request("http://localhost/api/weather", { headers: geo("52.52", "13.4") }))).status).toBe(502);
  });

  it("answers the APK's origin, and its preflight, but no other site", async () => {
    stubFetch(() => Response.json(SUNNY));
    const asked = (origin: string, headers = geo("52.52", "13.4", "Berlin")) => {
      headers.set("origin", origin);
      return GET(new Request("https://choglander.vercel.app/api/weather", { headers }));
    };
    const apk = await asked("https://localhost");
    expect(apk.headers.get("access-control-allow-origin")).toBe("https://localhost");
    expect(apk.headers.get("vary")).toContain("Origin");
    expect(apk.headers.get("cache-control")).toBe("private, max-age=900");
    // Its errors too, so the app reads a 400 as "no weather" rather than a blocked request.
    expect((await asked("capacitor://localhost", new Headers())).headers.get("access-control-allow-origin")).toBe("capacitor://localhost");
    expect((await asked("https://elsewhere.example")).headers.get("access-control-allow-origin")).toBeNull();

    const preflightFrom = (origin: string) =>
      OPTIONS(new Request("https://choglander.vercel.app/api/weather", { method: "OPTIONS", headers: { origin, "access-control-request-method": "GET" } }));
    expect(preflightFrom("https://localhost").status).toBe(204);
    expect(preflightFrom("https://localhost").headers.get("access-control-allow-methods")).toBe("GET, OPTIONS");
    expect(preflightFrom("https://elsewhere.example").status).toBe(403);
  });
});

describe("fetchWeatherHere", () => {
  it("asks this app's own server, on the origin it is given", async () => {
    const spy = stubFetch(() => Response.json({ kind: "rain", tempC: 9, phrase: "raining and 9 degrees", place: "Leeds" }));
    expect(await fetchWeatherHere()).toEqual({ kind: "rain", tempC: 9, phrase: "raining and 9 degrees", place: "Leeds" });
    expect(spy.mock.calls[0][0]).toBe("/api/weather");
    await fetchWeatherHere("https://choglander.example/");
    expect(spy.mock.calls[1][0]).toBe("https://choglander.example/api/weather");
  });

  it("is null when the server can't tell", async () => {
    stubFetch(() => Response.json({ error: "position unknown" }, { status: 400 }));
    expect(await fetchWeatherHere()).toBeNull();
    stubFetch(() => Response.json({ error: "nope" }));
    expect(await fetchWeatherHere()).toBeNull();
    stubFetch(() => Response.json({ kind: "meteors", tempC: 9, phrase: "raining rocks" }));
    expect(await fetchWeatherHere()).toBeNull();
    stubFetch(() => new Response("<html>not found</html>", { status: 200 }));
    expect(await fetchWeatherHere()).toBeNull();
    stubFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    expect(await fetchWeatherHere()).toBeNull();
  });
});

describe("weatherHere", () => {
  const LEEDS = { kind: "rain", tempC: 9, phrase: "raining and 9 degrees", place: "Leeds" };

  /** A phone's localStorage. */
  function stubStorage() {
    const items = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, String(value)),
    });
    return items;
  }

  /** Our server answers `server`; ipwho.is says Lyon; Open-Meteo says it's sunny. */
  function stubServices(server: () => Response) {
    return stubFetch((url) => {
      if (url.endsWith("/api/weather")) return server();
      if (url.startsWith("https://ipwho.is/")) return Response.json({ success: true, latitude: 45.76, longitude: 4.84, city: "Lyon" });
      if (url.startsWith("https://api.open-meteo.com/")) return Response.json(SUNNY);
      throw new TypeError("Failed to fetch");
    });
  }

  it("on the web asks only our own server, never a third party, even when it can't tell", async () => {
    stubStorage();
    let spy = stubServices(() => Response.json(LEEDS));
    expect(await weatherHere()).toEqual(LEEDS);
    expect(spy.mock.calls.map(([url]) => url)).toEqual(["/api/weather"]);

    spy = stubServices(() => Response.json({ error: "position unknown" }, { status: 400 }));
    expect(await weatherHere()).toBeNull();
    expect(spy.mock.calls.map(([url]) => url)).toEqual(["/api/weather"]);
  });

  it("in an APK asks the deployed server, and still finds the weather when it can't", async () => {
    stubStorage();
    let spy = stubServices(() => Response.json(LEEDS));
    expect(await weatherHere({ origin: "https://choglander.example/", native: true })).toEqual(LEEDS);
    expect(spy.mock.calls.map(([url]) => url)).toEqual(["https://choglander.example/api/weather"]);

    // A blocked or failed request: the way it always worked.
    spy = stubServices(() => {
      throw new TypeError("Failed to fetch");
    });
    expect(await weatherHere({ origin: "https://choglander.example", native: true })).toEqual({ kind: "clear", tempC: 18.4, phrase: "clear and 18 degrees", place: "Lyon" });
    expect(spy).toHaveBeenCalledTimes(3);

    // Built without a server: no doomed request to https://localhost/api/weather.
    spy = stubServices(() => Response.json(LEEDS));
    expect((await weatherHere({ native: true }))?.place).toBe("Lyon");
    expect(spy.mock.calls.some(([url]) => String(url).endsWith("/api/weather"))).toBe(false);

    stubFetch(() => {
      throw new TypeError("offline");
    });
    expect(await weatherHere({ native: true })).toBeNull();
  });

  it("keeps the last reading for half an hour, for a fresh start to paint at once", async () => {
    const items = stubStorage();
    expect(lastWeatherHere()).toBeNull();
    stubServices(() => Response.json(LEEDS));
    const before = Date.now();
    await weatherHere();
    expect(lastWeatherHere()).toEqual(LEEDS);
    expect(lastWeatherHere(before + WEATHER_KEEP_MS - 1_000)).toEqual(LEEDS);
    expect(lastWeatherHere(Date.now() + WEATHER_KEEP_MS + 1_000)).toBeNull();

    // A failed read keeps the last good one.
    stubServices(() => new Response("busy", { status: 503 }));
    await weatherHere();
    expect(lastWeatherHere()).toEqual(LEEDS);

    for (const kept of ["not json", JSON.stringify({ at: "now", weather: LEEDS }), JSON.stringify({ at: Date.now(), weather: { kind: "rain" } })]) {
      items.set("chog-calls-v1:weather", kept);
      expect(lastWeatherHere()).toBeNull();
    }
    vi.stubGlobal("localStorage", undefined);
    expect(lastWeatherHere()).toBeNull();
    stubServices(() => Response.json(LEEDS));
    expect(await weatherHere()).toEqual(LEEDS);
  });
});
