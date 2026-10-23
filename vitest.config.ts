import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The joke-bank sweeps render thousands of lines; under a loaded machine they need more than 5 s.
  test: { environment: "node", testTimeout: 20_000 },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
