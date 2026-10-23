import catalogJson from "@/data/trait-catalog.json";
import type { DisplayTrait, RawTrait } from "@/lib/types";

type Catalog = {
  generatedFrom: number;
  labels: Record<string, Record<string, string>>;
};

const catalog = catalogJson as Catalog;

const OFFENSIVE =
  /retard|tism|boob|balls|horny|boner|milf|\bthots?\b|virgin|homeless|\bpuke\b|\bbbc\b|butt/i;

export const BACKGROUND: Record<string, string> = {
  Aqua: "#7ed6d2",
  "Aqua Blue": "#6ec8e0",
  "Aqua Mint": "#7ddec8",
  "Blood Red": "#c23b4a",
  "Bright Yellow": "#ffe14a",
  "Coral Pink": "#ff8d7a",
  "Afternoon Orange": "#ffb067",
  "Deep Aqua": "#1f8a96",
  "Deep Blue": "#243f8f",
  "Deep Purple": "#4a2d86",
  "Fresh Green": "#7dce6a",
  Gold: "#e6b84d",
  Lemon: "#f3e36b",
  "Lemon Yellow": "#ffe56a",
  "Light Magenta": "#f3a0d8",
  "Light Purple": "#c7b6f2",
  "Lime Green": "#b6f25a",
  Magenta: "#e453b0",
  Mint: "#b7f0d2",
  Mon: "#836EF9",
  "Peach Pink": "#ffc2b3",
  Radioactive: "#c6f54a",
  "Red Sky": "#ff6b6b",
  "Noble Blue": "#6d8dff",
  "Rose Pink": "#ffb3c7",
  Rosie: "#ff9eb5",
  "Rosy Pink": "#ffb7c8",
  "Royal Blue": "#3a5bdc",
  "Sky Blue": "#8fd4ff",
  "Soft Lavender": "#d7c6f5",
  Sunlight: "#ffe1a8",
  "Supreme Purple": "#7a4fd0",
};

export const SKIN: Record<string, string> = {
  Origin: "rgb(237,226,212)",
  Beige: "rgb(232,204,174)",
  Black: "rgb(58,42,36)",
  Blue: "rgb(126,176,214)",
  Green: "rgb(146,196,132)",
  Grey: "rgb(186,186,188)",
  Jade: "rgb(126,196,168)",
  Metal: "rgb(196,202,210)",
  "Multi Colored": "rgb(232,210,196)",
  Pink: "rgb(244,180,196)",
  Purple: "rgb(196,166,224)",
  Red: "rgb(214,96,96)",
  White: "rgb(246,242,236)",
  Yellow: "rgb(244,214,96)",
};

export function traitCatalog() {
  return catalog;
}

export function labelFor(type: string, value: string): string {
  const mapped = catalog.labels[type]?.[value];
  if (mapped) return titled(mapped);
  if (OFFENSIVE.test(value)) return "Classic";
  return titled(value);
}

const SMALL_WORDS = new Set(["a", "an", "and", "of", "on", "in", "the", "to"]);

/** Every word starts with a capital, so labels read alike whatever the metadata's casing ("toad blue suit"). */
function titled(label: string): string {
  return label.replace(/(^|\s)([a-z]+)/g, (whole: string, gap: string, word: string) =>
    gap && SMALL_WORDS.has(word) ? whole : gap + word[0].toUpperCase() + word.slice(1),
  );
}

export function displayTraits(traits: RawTrait[]): DisplayTrait[] {
  return traits.map((trait) => ({
    type: trait.trait_type,
    value: trait.value,
    label: labelFor(trait.trait_type, trait.value),
  }));
}

export function traitLabel(traits: DisplayTrait[], type: string): string | null {
  return traits.find((trait) => trait.type === type)?.label ?? null;
}

export function backgroundColor(name: string): string {
  return BACKGROUND[name] ?? hashColor(name);
}

export function skinColor(name: string): string {
  return SKIN[name] ?? SKIN.Origin;
}

function hashColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 33 + name.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue} 62% 72%)`;
}

export function assertLabelsClean(labels: string[]) {
  for (const label of labels) {
    if (OFFENSIVE.test(label)) {
      throw new Error(`Offensive label leaked: ${label}`);
    }
  }
}
