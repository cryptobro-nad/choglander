import type { WeatherKind, WeatherNow } from "@/lib/types";

type OpenMeteo = {
  current?: {
    temperature_2m?: number;
    weather_code?: number;
    wind_speed_10m?: number;
  };
};

export function weatherFromCode(code: number, tempC: number, wind: number): WeatherKind {
  if (wind >= 35) return "wind";
  if (tempC >= 30) return "hot";
  if (tempC <= 0) return "cold";
  if (code === 45 || code === 48) return "fog";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return "snow";
  if (code === 0) return "clear";
  if (code >= 1 && code <= 3) return "cloud";
  if (code >= 95) return "rain";
  return "cloud";
}

export function weatherPhrase(kind: WeatherKind, tempC: number): string {
  const n = Math.round(tempC);
  const t = Math.abs(n) === 1 ? `${n} degree` : `${n} degrees`;
  const phrases: Record<WeatherKind, string> = {
    clear: `clear and ${t}`,
    cloud: `cloudy and ${t}`,
    rain: `raining and ${t}`,
    snow: `snowing and ${t}`,
    fog: `fogged in at ${t}`,
    wind: `windy and ${t}`,
    hot: `too hot at ${t}`,
    cold: `cold at ${t}`,
  };
  return phrases[kind];
}

export function parseOpenMeteo(data: OpenMeteo, place: string): WeatherNow | null {
  const temp = data.current?.temperature_2m;
  const code = data.current?.weather_code;
  if (typeof temp !== "number" || typeof code !== "number") return null;
  const wind = data.current?.wind_speed_10m ?? 0;
  const kind = weatherFromCode(code, temp, wind);
  return { kind, tempC: temp, phrase: weatherPhrase(kind, temp), place };
}

export async function fetchWeather(lat: number, lon: number, place = "here"): Promise<WeatherNow | null> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m&timezone=auto`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = (await res.json()) as OpenMeteo;
  return parseOpenMeteo(data, place);
}

export type WeatherQuery = { lat: number; lon: number; place: string };

/** A latitude or longitude, or null when it is missing, not a number, or off the globe. */
function coordinate(raw: string | null, limit: number): number | null {
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && Math.abs(value) <= limit ? value : null;
}

/** Vercel sends the city percent-encoded ("S%C3%A3o%20Paulo"). */
function cityName(raw: string | null): string {
  if (!raw) return "";
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return raw.trim();
  }
}

/**
 * Where /api/weather reads the weather for a request: the visitor's rough position from the host's
 * IP geolocation (Vercel sets x-vercel-ip-latitude, -longitude and -city on every request), so the
 * browser never asks a third party where it is. Only there: the route is no open proxy for any
 * coordinates and name a caller makes up (a typed city goes to Open-Meteo from the app itself).
 * Null when there is no position (a local server, or a coordinate that is not one).
 */
export function weatherQuery(headers: Headers): WeatherQuery | null {
  const lat = coordinate(headers.get("x-vercel-ip-latitude"), 90);
  const lon = coordinate(headers.get("x-vercel-ip-longitude"), 180);
  if (lat === null || lon === null) return null;
  return { lat, lon, place: cityName(headers.get("x-vercel-ip-city")) || "here" };
}

/**
 * The weather where the visitor is, from this app's own server (origin "" on the web, the deployed
 * server in an APK). Null when the server can't tell or can't be reached: the sky still follows the time.
 */
export async function fetchWeatherHere(origin = ""): Promise<WeatherNow | null> {
  const res = await fetch(`${origin.replace(/\/+$/, "")}/api/weather`).catch(() => null);
  if (!res?.ok) return null;
  return asWeather(await res.json().catch(() => null));
}

const KINDS: ReadonlySet<string> = new Set<WeatherKind>(["clear", "cloud", "rain", "snow", "fog", "wind", "hot", "cold"]);

/** A reading as this app writes it, or null for anything else (an error, a page, an old shape). */
function asWeather(data: unknown): WeatherNow | null {
  const value = data as Partial<WeatherNow> | null;
  if (typeof value?.kind !== "string" || !KINDS.has(value.kind) || typeof value.tempC !== "number" || typeof value.phrase !== "string") return null;
  return { kind: value.kind, tempC: value.tempC, phrase: value.phrase, place: typeof value.place === "string" ? value.place : "here" };
}

/** The way an APK with no server of ours to ask has always done it: ipwho.is for where, Open-Meteo for the weather. */
async function weatherByIp(): Promise<WeatherNow | null> {
  try {
    const res = await fetch("https://ipwho.is/");
    if (!res.ok) return null;
    const data = (await res.json()) as { success?: boolean; latitude?: unknown; longitude?: unknown; city?: unknown };
    if (data.success === false || typeof data.latitude !== "number" || typeof data.longitude !== "number") return null;
    return await fetchWeather(data.latitude, data.longitude, typeof data.city === "string" && data.city ? data.city : "here");
  } catch {
    return null;
  }
}

/** The last reading here, kept beside the app's saved state (persist.ts KEY). */
const LAST_KEY = "chog-calls-v1:weather";
/** How old that reading may be and still be shown first on a fresh start. */
export const WEATHER_KEEP_MS = 30 * 60_000;

/**
 * The weather where the visitor is, when they haven't typed a city. The web asks this app's own
 * server, which knows the rough position from the request's IP, so no third party learns it; when
 * the server can't tell (a local dev server), the sky just follows the time. An APK (`native`) asks
 * the deployed server at `origin`, and when it was built without one, or that server can't answer,
 * asks ipwho.is and Open-Meteo itself, so it keeps the weather it always had. The reading is kept
 * for lastWeatherHere.
 */
export async function weatherHere({ origin = "", native = false }: { origin?: string; native?: boolean } = {}): Promise<WeatherNow | null> {
  const server = origin.replace(/\/+$/, "");
  // An APK built without an API origin has no /api to ask: https://localhost only serves the bundle.
  let weather = native && !server ? null : await fetchWeatherHere(server);
  if (!weather && native) weather = await weatherByIp();
  if (weather) {
    try {
      localStorage.setItem(LAST_KEY, JSON.stringify({ at: Date.now(), weather }));
    } catch {
      /* no storage (a private window): the next start waits for the server instead */
    }
  }
  return weather;
}

/**
 * The last weather read here while it is under half an hour old, so a fresh start paints that sky
 * at once and weatherHere replaces it when it answers. Null when there is none, it is older, or
 * storage is off.
 */
export function lastWeatherHere(now = Date.now()): WeatherNow | null {
  try {
    const kept = JSON.parse(localStorage.getItem(LAST_KEY) ?? "null") as { at?: unknown; weather?: unknown } | null;
    if (typeof kept?.at !== "number" || kept.at > now || now - kept.at > WEATHER_KEEP_MS) return null;
    return asWeather(kept.weather);
  } catch {
    return null;
  }
}
