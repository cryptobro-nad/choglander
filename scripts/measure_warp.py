#!/usr/bin/env python3
"""Write public/chog/face-warp.json: where each Chog's eyes and mouth are, for the warp.

The portrait engine blinks by squashing the eye region of the art itself and talks by stretching
the art around the mouth line (ChogEngine.tsx, faceWarp.ts). It moves the art's own pixels, so it
can never paint a wrong colour, but it needs to know roughly where the eyes and the mouth are on
every one of the 1,969 Chogs. The art is layered on one template per Base and Side, so:

* every (Base, Side) gets eye and mouth boxes read off the median of its samples (BASES);
* plain Origin eye groups get their own boxes, measured here as the pixels that agree within a
  group and differ from the rest of the Side (face-groups.json's reviewed boxes win when present);
* visors and glasses squash as one gentler box (COVER), laser eyes squash just the dark socket
  the beam leaves from, closing from above onto the beam (LASER);
* Origin mouth groups use the measured viseme box when face-groups.json has one, else a box read
  off the group median (MOUTHS);
* the ten one-of-ones (no Side) get boxes read off their own art (ARTS).

    python -I scripts/measure_warp.py            # needs the sample art of measure_faces.py fetch

Run it with -I: the art is downloaded data, and -I keeps this directory off sys.path.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_TOKENS = ROOT.parent / "chog-alive" / "src" / "data" / "tokens.json"
DEFAULT_ART = ROOT / "evidence" / "engine" / "art"
GROUPS_JSON = ROOT / "public" / "chog" / "face-groups.json"
OUT_JSON = ROOT / "public" / "chog" / "face-warp.json"

# Boxes are [x, y, w, h] in the 1000x1000 art, y down. Eyes are listed left to right.
BASES = {
    "Origin|Left": {"eyes": [[295, 430, 280, 210], [780, 355, 130, 195]], "mouth": [640, 615, 180, 100]},
    "Origin|Right": {"eyes": [[325, 245, 180, 205], [690, 372, 265, 250]], "mouth": [470, 620, 170, 90]},
    "Skull|Left": {"eyes": [[285, 450, 195, 180], [770, 410, 120, 160]], "mouth": [600, 700, 250, 70]},
    "Skull|Right": {"eyes": [[325, 290, 165, 150], [710, 420, 220, 190]], "mouth": [560, 650, 290, 80]},
    "Radioactive|Left": {"eyes": [[325, 440, 235, 210], [750, 370, 150, 200]], "mouth": [620, 715, 240, 80], "chin": 70},
}

# Origin mouth groups face-groups.json does not measure, read off the group medians.
MOUTHS = {
    "Left|BTC Coin": [530, 600, 300, 100],
    "Left|Mon coin": [530, 600, 300, 100],
    "Left|Bubblegum": [600, 630, 120, 90],
    "Left|Clown Mouth": [460, 600, 400, 110],
    "Left|Drooling": [610, 606, 190, 110],
    "Left|Grit": [540, 615, 300, 130],
    "Left|Rainbow Puke": [680, 600, 130, 80],
    "Right|Bubblegum": [560, 630, 110, 80],
    "Right|Drooling": [465, 640, 140, 70],
    "Right|Gold Tooth": [380, 560, 440, 170],
    "Right|Rainbow Puke": [410, 595, 120, 70],
}

# Visors and glasses cover both eyes: one box, squashed less (a flick of the lens, not a fold).
COVER_DEPTH = 0.5
COVER = {
    "Left": ([225, 380, 735, 270], ["3D Glass", "BTC Glass", "Chog Viper", "Classic VR", "MOG", "Modern VR", "Thug"]),
    "Right": ([260, 230, 740, 360], ["Anime Glass", "Gradient visor", "Plasma visor", "Sunset visor", "Retro Glass"]),
}
# Laser eyes: the dark socket each beam leaves from (dark pixels shared by the group's samples).
# Only the part above the middle closes, onto the beam: squashing the beam itself would bend it.
LASER_LINE = 0.5
LASER = {
    "Left": ([[310, 488, 205, 132], [807, 363, 72, 126]], ["Purple laser", "cyan laser", "fire laser"]),
    "Right": ([[346, 268, 123, 168], [778, 417, 217, 202]], ["Purple laser", "Green laser", "fire laser"]),
}
# Groups whose measured layer is mostly tears: keep the Side's eye boxes.
EYES_DEFAULT = {"Right|Closed Eye Crying", "Right|Round Crying"}

# The one-of-ones, read off their own art.
ARTS = {
    "53": {"eyes": [[385, 470, 130, 135], [720, 470, 110, 135]], "mouth": [585, 560, 130, 70]},
    "392": {"eyes": [[275, 290, 155, 210], [760, 425, 190, 200]], "mouth": [450, 640, 300, 90]},
    "434": {"eyes": [[370, 370, 125, 135], [745, 370, 120, 135]], "mouth": [585, 640, 80, 110]},
    "494": {"eyes": [[320, 415, 175, 180], [690, 390, 160, 160]], "mouth": [280, 610, 600, 130]},
    "973": {"eyes": [[225, 300, 200, 200], [585, 330, 190, 170]], "mouth": [200, 640, 700, 120]},
    "1006": {"eyes": [[320, 455, 185, 160], [740, 415, 110, 135]], "mouth": [670, 680, 100, 50]},
    "1159": {"eyes": [[330, 510, 160, 125], [785, 445, 80, 100]], "mouth": [720, 705, 110, 70]},
    "1290": {"eyes": [[245, 395, 200, 210], [570, 405, 95, 175]], "mouth": [580, 650, 90, 50]},
    "1373": {"eyes": [[405, 335, 100, 130], [720, 405, 175, 225]], "mouth": [490, 615, 190, 70]},
    "1376": {"eyes": [[95, 395, 185, 210], [745, 395, 160, 185]], "mouth": [630, 625, 110, 55]},
}

# Where a plain eye layer may be found, split into the two eyes at x = SPLIT.
EYE_WINDOW = {"Left": (200, 300, 960, 700), "Right": (240, 180, 1000, 680)}
SPLIT = {"Left": 660, "Right": 600}
MAX_EYE = (320, 300)  # a measured eye larger than this caught something else (a tear, a hat)


def load(path: Path):
    import numpy as np
    from PIL import Image

    return np.asarray(Image.open(path).convert("RGB"), dtype=np.int16)


def measure_eyes(tokens, art: Path) -> dict:
    """Origin eye groups: pixels that agree within the group and not with the rest of the Side."""
    import numpy as np
    import scipy.ndimage as nd

    out = {}
    rng = np.random.default_rng(1)
    for side in ("Left", "Right"):
        members = [t for t in tokens if t["traits"].get("Base") == "Origin" and t["traits"].get("Side") == side and (art / f"{t['metaId']}.webp").exists()]
        groups: dict[str, list] = {}
        for t in members:
            groups.setdefault(t["traits"].get("Eyes", "?"), []).append(t["metaId"])
        x0, y0, x1, y1 = EYE_WINDOW[side]
        for name, ids in sorted(groups.items()):
            if len(ids) < 3:
                continue
            stack = np.stack([load(art / f"{i}.webp")[y0:y1, x0:x1] for i in ids[:12]])
            med = np.median(stack, axis=0)
            agree = (np.abs(stack - med).sum(3) < 50).mean(0)
            others = [t["metaId"] for t in members if t["traits"].get("Eyes") != name]
            picks = rng.choice(others, size=min(40, len(others)), replace=False)
            rest = np.stack([load(art / f"{i}.webp")[y0:y1, x0:x1] for i in picks])
            shared = (np.abs(rest - med).sum(3) < 50).mean(0)
            mask = nd.binary_opening((agree >= 0.75) & (shared <= 0.3), iterations=2)
            lab, n = nd.label(mask)
            if not n:
                continue
            sizes = nd.sum(mask, lab, range(1, n + 1))
            keep = np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s >= max(150, 0.08 * sizes.max())])
            ys, xs = np.where(keep)
            xs, ys = xs + x0, ys + y0
            boxes = []
            for sel in (xs < SPLIT[side], xs >= SPLIT[side]):
                if sel.sum() < 100:
                    boxes.append(None)
                    continue
                bx, by = int(xs[sel].min()), int(ys[sel].min())
                box = [bx, by, int(xs[sel].max()) - bx + 1, int(ys[sel].max()) - by + 1]
                boxes.append(box if box[2] <= MAX_EYE[0] and box[3] <= MAX_EYE[1] else None)
            out[f"{side}|{name}"] = boxes
            print(f"{side}|{name:22s} n={len(ids):2d} {boxes}")
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--tokens", type=Path, default=DEFAULT_TOKENS)
    parser.add_argument("--art", type=Path, default=DEFAULT_ART)
    parser.add_argument("--out", type=Path, default=OUT_JSON)
    args = parser.parse_args()

    tokens = json.loads(args.tokens.read_text(encoding="utf-8"))["tokens"]
    groups = json.loads(GROUPS_JSON.read_text(encoding="utf-8"))
    measured = measure_eyes(tokens, args.art)

    eyes: dict[str, dict] = {}
    for key, boxes in measured.items():
        side, name = key.split("|", 1)
        if key in EYES_DEFAULT or any(name in names for _, names in (COVER[side], LASER[side])):
            continue
        defaults = BASES[f"Origin|{side}"]["eyes"]
        eyes[key] = {"eyes": [box or defaults[i] for i, box in enumerate(boxes)]}
    for key, group in groups["eyes"].items():  # reviewed on contact sheets: these win
        eyes[key] = {"eyes": [[e["x"], e["y"], e["w"], e["h"]] for e in group["eyes"]]}
    for side, (box, names) in COVER.items():
        for name in names:
            eyes[f"{side}|{name}"] = {"eyes": [box], "depth": COVER_DEPTH}
    for side, (boxes, names) in LASER.items():
        for name in names:
            eyes[f"{side}|{name}"] = {"eyes": boxes, "line": LASER_LINE, "lower": 0}

    mouths = {key: [m["mouth"][k] for k in ("x", "y", "w", "h")] for key, m in groups["mouths"].items()}
    mouths.update(MOUTHS)

    table = {
        "version": 1,
        "source": "scripts/measure_warp.py",
        "bases": BASES,
        "eyes": dict(sorted(eyes.items())),
        "mouths": dict(sorted(mouths.items())),
        "arts": ARTS,
    }
    args.out.write_text(json.dumps(table, indent=1) + "\n", encoding="utf-8")
    print(f"{len(eyes)} eye groups, {len(mouths)} mouth groups, {len(ARTS)} one-of-ones -> {args.out}")


if __name__ == "__main__":
    main()
