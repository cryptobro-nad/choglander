import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const exporting = process.env.CHOG_EXPORT === "1";

const DAY = 86_400;

/**
 * Browser caching for the files in public/ (Next already gives /_next/static a year, immutable).
 * They keep their names when their content changes: a studio clip is named for its line, so a
 * retake of the same line keeps its URL, and the icons are plain names. So each is fresh for a day,
 * then served from the cache at once while the browser checks for a newer one. The demo art is
 * fixed in place too (/chog/375.webp), and a day-old face is worse than a day-old icon: it is
 * checked on every visit, the cached copy still showing at once and any new one the next time.
 * Pages, /api and sw.js keep the default (always revalidated).
 */
const STATIC_CACHE = [
  { source: "/voice/:path*", value: `public, max-age=${DAY}, stale-while-revalidate=${30 * DAY}` },
  { source: "/chog/:path*", value: `public, max-age=0, stale-while-revalidate=${7 * DAY}` },
  { source: "/:dir(icons|fonts)/:path*", value: `public, max-age=${DAY}, stale-while-revalidate=${7 * DAY}` },
];

const nextConfig: NextConfig = {
  // The Android export moves the API routes aside; its type check skips tests that import them.
  ...(exporting ? { output: "export" as const, distDir: ".next-export", typescript: { tsconfigPath: "tsconfig.export.json" } } : {}),
  images: { unoptimized: true },
  devIndicators: false,
  cacheComponents: !exporting,
  partialPrefetching: !exporting,
  serverExternalPackages: ["kokoro-js", "@huggingface/transformers"],
  // The share-card images (/c/<art>/<line>/opengraph-image) read their fonts and the demo portraits from disk.
  ...(exporting ? {} : { outputFileTracingIncludes: { "/c/**": ["./public/fonts/card/*.woff", "./public/chog/*.webp"] } }),
  // A static export has no server to send headers: the APK reads these files from the phone.
  ...(exporting
    ? {}
    : {
        headers: async () => [
          ...STATIC_CACHE.map(({ source, value }) => ({ source, headers: [{ key: "Cache-Control", value }] })),
          // Plain hardening for every response: no type sniffing, no framing by other sites, a short
          // referrer, and only the microphone (live Talk) among the powerful features.
          {
            source: "/:path*",
            headers: [
              { key: "X-Content-Type-Options", value: "nosniff" },
              { key: "X-Frame-Options", value: "DENY" },
              { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
              { key: "Permissions-Policy", value: "microphone=(self), camera=(), geolocation=(), payment=(), usb=()" },
            ],
          },
        ],
      }),
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

// The web app keeps closed-tab rings in workflows (src/workflows). The phone app has no server, so
// its static export builds without them.
export default exporting ? nextConfig : withWorkflow(nextConfig);
