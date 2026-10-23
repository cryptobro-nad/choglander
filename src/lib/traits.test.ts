import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { BACKGROUND, displayTraits, labelFor, traitCatalog } from "@/lib/traits";

const OFFENSIVE = /retard|tism|boob|balls|horny|boner|milf|\bthots?\b|virgin|homeless|\bpuke\b|\bbbc\b|butt/i;

describe("traits", () => {
  it("maps every catalog value to a clean label", () => {
    const catalog = traitCatalog();
    expect(catalog.generatedFrom).toBe(1969);
    for (const [type, values] of Object.entries(catalog.labels)) {
      for (const [raw, label] of Object.entries(values)) {
        const shown = labelFor(type, raw);
        expect(shown.toLowerCase()).toBe(label.toLowerCase());
        // Every word but a small one starts with a capital, whatever the metadata's casing.
        expect(shown).not.toMatch(/(^|\s)(?!(?:a|an|and|of|on|in|the|to)\b)[a-z]/);
        expect(OFFENSIVE.test(label)).toBe(false);
      }
    }
  });

  it("gives labels the same capitals whatever the metadata's casing", () => {
    expect(labelFor("Body", "Toad green Suit")).toBe("Toad Green Suit");
    expect(labelFor("Body", "toad blue suit")).toBe("Toad Blue Suit");
    expect(labelFor("Head", "10k TPS Cap")).toBe("10k TPS Cap");
    expect(labelFor("Base", "1:1")).toBe("One of One");
  });

  it("hides known offensive raw values", () => {
    expect(labelFor("Eyes", "Retard")).toBe("Dazed");
    expect(labelFor("Eyes", "Red Retard")).toBe("Red Dazed");
    expect(labelFor("Body", "Boner")).toBe("Spike");
    expect(labelFor("Body", "MILF Lover")).toBe("Devoted");
    expect(labelFor("Naked", "Yes")).toBe("Bare");
    const shown = displayTraits([
      { trait_type: "Eyes", value: "Blue Retard" },
      { trait_type: "Head", value: "RETARD Cap" },
    ]).map((trait) => trait.label);
    expect(shown.join(" ")).not.toMatch(OFFENSIVE);
  });

  it("has a color for every background", () => {
    for (const name of Object.keys(traitCatalog().labels.Background)) {
      expect(BACKGROUND[name], name).toBeTruthy();
    }
  });

  it("covers the on-chain snapshot when it is present", () => {
    const dir = process.env.CHOG_META_DIR || "/tmp/chog-meta";
    if (!existsSync(dir)) return;
    const files = readdirSync(dir).filter((name) => name.endsWith(".json"));
    expect(files.length).toBe(1969);
    for (const file of files) {
      const data = JSON.parse(readFileSync(join(dir, file), "utf8")) as {
        attributes: { trait_type: string; value: string }[];
      };
      for (const attr of data.attributes) {
        const label = labelFor(attr.trait_type, attr.value);
        expect(traitCatalog().labels[attr.trait_type]?.[attr.value], `${attr.trait_type}:${attr.value}`).toBeTruthy();
        expect(OFFENSIVE.test(label)).toBe(false);
      }
    }
  });
});
