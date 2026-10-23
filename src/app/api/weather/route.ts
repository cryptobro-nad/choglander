import { fetchWeather, weatherQuery } from "@/lib/weather";
import { corsHeaders, preflight } from "@/server/cors";

// GET /api/weather reads the weather where the visitor is, from the host's IP geolocation headers
// (see weatherQuery). The APK asks it from https://localhost, cross-origin, so it answers the app's
// own origins like /api/live does.
export async function GET(request: Request) {
  const cors = corsHeaders(request.headers.get("origin"), process.env, "GET");
  const query = weatherQuery(request.headers);
  if (!query) {
    return Response.json({ error: "position unknown" }, { status: 400, headers: cors });
  }
  const weather = await fetchWeather(query.lat, query.lon, query.place).catch(() => null);
  if (!weather) return Response.json({ error: "weather unavailable" }, { status: 502, headers: cors });
  // The answer depends on who asks (their IP), so only their own browser may keep it, for 15 minutes.
  return Response.json(weather, { headers: { ...cors, "Cache-Control": "private, max-age=900" } });
}

export function OPTIONS(request: Request) {
  return preflight(request, process.env, "GET");
}
