// Builds the Android shell: a static export of the app into out/, then `cap sync android`.
//
//   node scripts/export-android.mjs                 static export + cap sync
//   node scripts/export-android.mjs --apk           ...then assemble the debug APK and print its path
//   node scripts/export-android.mjs --api-origin=https://chog-calls.example.app
//   node scripts/export-android.mjs --site-url=https://chog-calls.example.app   (share links; default: the api origin)
//
// The APK has no server of its own (route handlers cannot be exported). When
// NEXT_PUBLIC_CHOG_API_ORIGIN (or --api-origin) is set, the exported page calls that deployed
// server for real voices; without it the APK speaks with the phone's own text-to-speech.
// NEXT_PUBLIC_CHOG_EXPORT=1 is always set so client code can keep server-only work out of the APK.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";

const root = process.cwd();
const isWindows = process.platform === "win32";
// Server-only routes a static export cannot hold: the API, the share-card pages (/c/...) whose link
// previews are drawn on the server, and the home page's link images (crawlers read those from the
// website, never from the APK), and the APK download the website offers, which must not end up
// inside the next APK. Each waits beside src/app or public while the export builds. So does the
// proxy that turns away forged share links, which needs a server too, and the workflows that send
// the web app's closed-tab rings, with the routes the workflow build writes for them.
const SERVER_ROUTES = [
  { dir: path.join(root, "src/app/api"), stash: path.join(root, ".chog-api-stash") },
  { dir: path.join(root, "src/app/c"), stash: path.join(root, ".chog-share-stash") },
  { dir: path.join(root, "src/proxy.ts"), stash: path.join(root, ".chog-proxy-stash") },
  { dir: path.join(root, "src/app/opengraph-image.tsx"), stash: path.join(root, ".chog-og-stash") },
  { dir: path.join(root, "src/app/twitter-image.tsx"), stash: path.join(root, ".chog-twitter-stash") },
  { dir: path.join(root, "public/choglander.apk"), stash: path.join(root, ".chog-apk-stash") },
  { dir: path.join(root, "src/workflows"), stash: path.join(root, ".chog-workflows-stash") },
  { dir: path.join(root, "src/app/.well-known"), stash: path.join(root, ".chog-well-known-stash") },
];

/** Reads `--name` or `--name=value` from argv: undefined when absent, "" for a bare flag. */
export function option(argv, name) {
  const hit = argv.find((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`));
  if (hit === undefined) return undefined;
  const eq = hit.indexOf("=");
  return eq === -1 ? "" : hit.slice(eq + 1);
}

/** The deployed server the APK should call, as a bare origin, or "" for on-device voice only. */
export function resolveApiOrigin(raw, name = "NEXT_PUBLIC_CHOG_API_ORIGIN") {
  const value = (raw ?? "").trim();
  if (!value) return "";
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} is not a URL: "${value}"`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${name} must be http(s): "${value}"`);
  }
  return url.origin;
}

/** The environment of the export build. The origin is always set, empty when there is none. */
export function exportEnv(origin, site = "") {
  return { CHOG_EXPORT: "1", NEXT_PUBLIC_CHOG_EXPORT: "1", NEXT_PUBLIC_CHOG_API_ORIGIN: origin, NEXT_PUBLIC_SITE_URL: site };
}

function run(cmd, args, { env = {}, cwd = root } = {}) {
  // npx and gradlew are .cmd/.bat files on Windows, which Node only starts through a shell.
  const options = { cwd, stdio: "inherit", env: { ...process.env, ...env } };
  const result = isWindows
    ? spawnSync([cmd, ...args].join(" "), { ...options, shell: true })
    : spawnSync(cmd, args, options);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited ${result.status}`);
  }
}

function stashApi() {
  for (const { dir, stash } of SERVER_ROUTES) {
    if (!fs.existsSync(dir)) continue;
    fs.rmSync(stash, { recursive: true, force: true });
    fs.renameSync(dir, stash);
  }
}

function restoreApi() {
  for (const { dir, stash } of SERVER_ROUTES) {
    if (!fs.existsSync(stash)) continue;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.renameSync(stash, dir);
  }
}

// The static build also writes .next, which would leave `npm start` serving a site with no API
// routes. The web build is set aside for the export and put back after it.
const webBuild = path.join(root, ".next");
const webStash = path.join(root, ".next-web-stash");

function stashWebBuild() {
  fs.rmSync(webStash, { recursive: true, force: true });
  if (fs.existsSync(webBuild)) fs.renameSync(webBuild, webStash);
}

function restoreWebBuild() {
  if (!fs.existsSync(webStash)) return;
  fs.rmSync(webBuild, { recursive: true, force: true });
  fs.renameSync(webStash, webBuild);
}

/** Gradle needs a JDK and the SDK; fall back to Android Studio's defaults when they aren't set. */
function gradleEnv() {
  const env = {};
  if (!process.env.JAVA_HOME) {
    const jbr = isWindows
      ? "C:/Program Files/Android/Android Studio/jbr"
      : process.platform === "darwin"
        ? "/Applications/Android Studio.app/Contents/jbr/Contents/Home"
        : "";
    if (jbr && fs.existsSync(jbr)) env.JAVA_HOME = jbr;
  }
  const hasSdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || fs.existsSync(path.join(root, "android/local.properties"));
  if (!hasSdk) {
    const sdk = isWindows
      ? path.join(process.env.LOCALAPPDATA ?? "", "Android/Sdk")
      : path.join(process.env.HOME ?? "", process.platform === "darwin" ? "Library/Android/sdk" : "Android/Sdk");
    if (fs.existsSync(sdk)) env.ANDROID_HOME = sdk;
  }
  return env;
}

function main(argv) {
  // Read .env files the way `next build` will, so the origin we report is the one that ships.
  nextEnv.loadEnvConfig(root, false, { info: () => {}, error: console.error });
  const origin = resolveApiOrigin(option(argv, "api-origin") ?? process.env.NEXT_PUBLIC_CHOG_API_ORIGIN);
  // Where shared cards link (their page unfurls on X as the card). Defaults to the voice server.
  const site = resolveApiOrigin(option(argv, "site-url") ?? process.env.NEXT_PUBLIC_SITE_URL, "NEXT_PUBLIC_SITE_URL") || origin;
  const env = exportEnv(origin, site);
  console.log(
    origin
      ? `APK voice server: ${origin} (it must allow CORS from https://localhost)`
      : "APK voice server: none. The Chog speaks with the phone's own text-to-speech.",
  );
  console.log(
    site
      ? `APK share links: ${site}/c/... (X shows the card from that page)`
      : "APK share links: none. Post to X sends the card through the phone's share sheet instead.",
  );

  try {
    stashApi();
    // A previous dev or production typecheck can still point at the stashed API routes, so the
    // export starts from an empty .next; the web build waits beside it.
    stashWebBuild();
    run("npx", ["next", "build"], { env });
  } finally {
    restoreApi();
    restoreWebBuild();
  }

  const exported = path.join(root, ".next-export");
  const webDir = path.join(root, "out");
  if (!fs.existsSync(path.join(exported, "index.html"))) {
    throw new Error("Static export did not produce index.html");
  }
  fs.rmSync(webDir, { recursive: true, force: true });
  fs.cpSync(exported, webDir, { recursive: true });

  // capacitor.config.ts reads the origin too: mixed content is allowed only for an http server.
  run("npx", ["cap", fs.existsSync(path.join(root, "android")) ? "sync" : "add", "android"], { env });

  if (option(argv, "apk") === undefined) {
    console.log("Web assets synced into android/. Assemble with: node scripts/export-android.mjs --apk");
    return;
  }

  const androidDir = path.join(root, "android");
  // An absolute, quoted path: Windows shells may refuse to run a script from the current directory.
  const gradlew = path.join(androidDir, isWindows ? "gradlew.bat" : "gradlew");
  run(isWindows ? `"${gradlew}"` : gradlew, ["assembleDebug"], { cwd: androidDir, env: gradleEnv() });
  const apk = path.join(androidDir, "app/build/outputs/apk/debug/app-debug.apk");
  if (!fs.existsSync(apk)) throw new Error(`Gradle finished but ${apk} is missing`);
  const mb = (fs.statSync(apk).size / (1024 * 1024)).toFixed(1);
  console.log(`Debug APK: ${apk} (${mb} MB)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
