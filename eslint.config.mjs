import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Build output of the Android export and the native project.
    ".next-export/**",
    ".next-web-stash/**",
    ".chog-api-stash/**",
    "android/**",
    // Routes the workflow build writes (withWorkflow in next.config.ts), and its SWC plugin cache.
    "src/app/.well-known/**",
    ".swc/**",
  ]),
]);

export default eslintConfig;
