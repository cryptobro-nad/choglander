// The Android app is a static bundle served from https://localhost inside the WebView, so its
// calls to the deployed /api/speak and /api/voice are cross-origin. Only the app's own origins are allowed.
export const APP_ORIGINS = ["https://localhost", "http://localhost", "capacitor://localhost"] as const;

type Env = Record<string, string | undefined>;

function allowedOrigins(env: Env): string[] {
  const extra = (env.CHOG_CORS_ORIGINS || "")
    .split(",")
    .map((item) => item.trim().replace(/\/+$/, ""))
    .filter((item) => /^[a-z][a-z0-9+.-]*:\/\/[^\s/]+$/i.test(item));
  return [...APP_ORIGINS, ...extra];
}

export function originAllowed(origin: string | null, env: Env = process.env): boolean {
  return Boolean(origin) && allowedOrigins(env).includes(origin as string);
}

/**
 * Headers to add to every response of a cross-origin route. Same-origin callers need none of them.
 * `method` is what the route answers: POST for /api/speak, GET for /api/voice. The audio route also
 * exposes its length and range headers to a CORS-mode <audio crossOrigin="anonymous">.
 */
export function corsHeaders(origin: string | null, env: Env = process.env, method: "POST" | "GET" = "POST"): Record<string, string> {
  const headers: Record<string, string> = { Vary: "Origin" };
  if (!originAllowed(origin, env)) return headers;
  headers["Access-Control-Allow-Origin"] = origin as string;
  headers["Access-Control-Allow-Methods"] = `${method}, OPTIONS`;
  headers["Access-Control-Allow-Headers"] = method === "GET" ? "range" : "content-type, x-chog-device";
  if (method === "GET") headers["Access-Control-Expose-Headers"] = "Content-Length, Content-Range, Accept-Ranges";
  headers["Access-Control-Max-Age"] = "86400";
  return headers;
}

/** The answer to a CORS preflight: 204 for the app's origins, 403 for anyone else. */
export function preflight(request: Request, env: Env = process.env, method: "POST" | "GET" = "POST"): Response {
  const origin = request.headers.get("origin");
  return new Response(null, { status: originAllowed(origin, env) ? 204 : 403, headers: corsHeaders(origin, env, method) });
}
