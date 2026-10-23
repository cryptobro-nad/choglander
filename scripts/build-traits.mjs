import fs from "node:fs";
import path from "node:path";

const metaDir = process.env.CHOG_META_DIR || "/tmp/chog-meta";
const outJson = path.join(process.cwd(), "src/data/trait-catalog.json");

/** Raw chain values that must never reach the UI. Labels are the only public form. */
const OVERRIDES = {
  "Blue Retard": "Blue Dazed",
  "Green Retard": "Green Dazed",
  "Red Retard": "Red Dazed",
  "Mixed Retard": "Mixed Dazed",
  Retard: "Dazed",
  "RETARD Cap": "Dazed Cap",
  "TISM Cap": "Spark Cap",
  "BOOB Cap": "Curve Cap",
  "Boob Cap": "Curve Cap",
  "Balls Cap": "Orb Cap",
  "Horny Cap": "Spur Cap",
  Boner: "Spike",
  "MILF Lover": "Devoted",
  Virgin: "Fresh",
  "Zero THOTS": "Zero Distractions",
  BBC: "Block Tee",
  "Blue Homeless Shirt": "Blue Worn Shirt",
  "Brown Homeless Shirt": "Brown Worn Shirt",
  "Grey Homeless Shirt": "Grey Worn Shirt",
  "Buttcoin Cap": "Coin Cap",
  "Rainbow Puke": "Rainbow Burst",
  wo: "Open",
  "normal smile": "Smile",
  "1:1": "One of one",
};

const OFFENSIVE =
  /retard|tism|boob|balls|horny|boner|milf|\bthots?\b|virgin|homeless|\bpuke\b|\bbbc\b|butt/i;

const labels = {};
const counts = {};
let files = 0;

if (!fs.existsSync(metaDir)) {
  console.error("Missing metadata dir", metaDir);
  process.exit(1);
}

for (const name of fs.readdirSync(metaDir)) {
  if (!name.endsWith(".json")) continue;
  const raw = fs.readFileSync(path.join(metaDir, name), "utf8");
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    console.error("Bad json", name);
    process.exit(1);
  }
  files += 1;
  for (const attr of data.attributes || []) {
    const type = attr.trait_type;
    const value = attr.value;
    if (!labels[type]) labels[type] = {};
    counts[type] = (counts[type] || 0) + 1;
    if (labels[type][value]) continue;
    if (Object.prototype.hasOwnProperty.call(OVERRIDES, value)) {
      labels[type][value] = OVERRIDES[value];
      continue;
    }
    if (OFFENSIVE.test(value)) {
      console.error(`Unmapped offensive trait: ${type} = ${value}`);
      process.exit(1);
    }
    labels[type][value] = value;
  }
}

const naked = labels.Naked || {};
if (naked.Yes) naked.Yes = "Bare";
if (naked.No) naked.No = "Dressed";

for (const [raw, label] of Object.entries(OVERRIDES)) {
  if (OFFENSIVE.test(label)) {
    console.error("Override label still offensive:", raw, label);
    process.exit(1);
  }
}

const catalog = {
  generatedFrom: files,
  supply: 1969,
  types: Object.fromEntries(
    Object.entries(labels).map(([type, map]) => [type, Object.keys(map).length]),
  ),
  labels,
};

fs.mkdirSync(path.dirname(outJson), { recursive: true });
fs.writeFileSync(outJson, JSON.stringify(catalog, null, 2) + "\n");
console.log(`Wrote ${outJson} from ${files} tokens`);
if (files < 1969) {
  console.error(`Expected 1969 metadata files, found ${files}`);
  process.exit(1);
}
