import type { CapacitorConfig } from "@capacitor/cli";

// The APK loads its pages from https://localhost. The only remote server it talks to is the voice
// server in NEXT_PUBLIC_CHOG_API_ORIGIN (see scripts/export-android.mjs). Mixed content is allowed
// only when that server is plain http, which is a LAN test setup and never a release.
const apiOrigin = process.env.NEXT_PUBLIC_CHOG_API_ORIGIN ?? "";

const config: CapacitorConfig = {
  appId: "com.chog.calls",
  appName: "Choglander",
  webDir: "out",
  // Matches the page background, so a cold start from the alarm never flashes white.
  backgroundColor: "#c9d4ee",
  android: {
    allowMixedContent: apiOrigin.startsWith("http://"),
  },
  server: {
    androidScheme: "https",
  },
};

export default config;
