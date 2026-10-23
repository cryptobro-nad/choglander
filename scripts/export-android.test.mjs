import { describe, expect, it } from "vitest";
import { exportEnv, option, resolveApiOrigin } from "./export-android.mjs";

describe("export-android", () => {
  it("reduces the voice server to a bare origin", () => {
    expect(resolveApiOrigin("https://choglander.vercel.app/")).toBe("https://choglander.vercel.app");
    expect(resolveApiOrigin("  https://chog.example.app/api/speak?x=1 ")).toBe("https://chog.example.app");
    expect(resolveApiOrigin("http://192.168.1.20:43123")).toBe("http://192.168.1.20:43123");
  });

  it("treats a missing origin as on-device voice only", () => {
    expect(resolveApiOrigin(undefined)).toBe("");
    expect(resolveApiOrigin("   ")).toBe("");
  });

  it("refuses an origin the APK could not call", () => {
    expect(() => resolveApiOrigin("choglander.vercel.app")).toThrow(/not a URL/);
    expect(() => resolveApiOrigin("ftp://chog.example.app")).toThrow(/http\(s\)/);
  });

  it("always marks the build as the export and passes the origin and the share address through", () => {
    expect(exportEnv("https://chog.example.app", "https://chog.example.app")).toEqual({
      CHOG_EXPORT: "1",
      NEXT_PUBLIC_CHOG_EXPORT: "1",
      NEXT_PUBLIC_CHOG_API_ORIGIN: "https://chog.example.app",
      NEXT_PUBLIC_SITE_URL: "https://chog.example.app",
    });
    expect(exportEnv("").NEXT_PUBLIC_CHOG_API_ORIGIN).toBe("");
    expect(exportEnv("").NEXT_PUBLIC_SITE_URL).toBe("");
  });

  it("names the variable it refuses", () => {
    expect(() => resolveApiOrigin("chog.example", "NEXT_PUBLIC_SITE_URL")).toThrow(/NEXT_PUBLIC_SITE_URL is not a URL/);
  });

  it("reads flags with and without values", () => {
    const argv = ["--apk", "--api-origin=https://a.example/b=c"];
    expect(option(argv, "apk")).toBe("");
    expect(option(argv, "api-origin")).toBe("https://a.example/b=c");
    expect(option(argv, "missing")).toBeUndefined();
  });
});
