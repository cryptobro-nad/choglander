import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, OPTIONS } from "@/app/api/live/route";

const ask = (origin = "https://localhost") => GET(new Request("https://choglander.vercel.app/api/live", { headers: { origin } }));

afterEach(() => vi.unstubAllEnvs());

describe("/api/live", () => {
  it("says no live voice without an ElevenLabs key", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    expect(await (await ask()).json()).toEqual({ voice: false });
  });

  it("says yes in production once the key is set, and no when live is switched off", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ELEVENLABS_API_KEY", "test-key-not-real");
    expect(await (await ask()).json()).toEqual({ voice: true });
    vi.stubEnv("CHOG_USE_LIVE", "0");
    expect(await (await ask()).json()).toEqual({ voice: false });
  });

  it("answers the app's own origin for the APK, and its preflight", async () => {
    const res = await ask("capacitor://localhost");
    expect(res.headers.get("access-control-allow-origin")).toBe("capacitor://localhost");
    const pre = OPTIONS(new Request("https://choglander.vercel.app/api/live", { method: "OPTIONS", headers: { origin: "https://localhost", "access-control-request-method": "GET" } }));
    expect(pre.status).toBeLessThan(300);
  });
});
