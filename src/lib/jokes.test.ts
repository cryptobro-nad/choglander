import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
// A plain .mjs script, shared with the command line (node scripts/check-jokes.mjs).
import { checkBank } from "../../scripts/check-jokes.mjs";
import { JOKE_FILES } from "@/lib/jokeFiles";

const dir = path.resolve(__dirname, "../data/jokes");

describe("joke files", () => {
  it("pass the house rules: tied to the moment, mixed with web3, no formula", () => {
    const files = fs.readdirSync(dir).filter((name) => name.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      const archetype = name.replace(/\.json$/, "");
      const bank = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
      expect(checkBank(bank, archetype), name).toEqual([]);
    }
  });

  it("are all wired into the app", () => {
    const files = fs.readdirSync(dir).filter((name) => name.endsWith(".json")).map((name) => name.replace(/\.json$/, ""));
    expect(Object.keys(JOKE_FILES).sort()).toEqual(files.sort());
  });
});
