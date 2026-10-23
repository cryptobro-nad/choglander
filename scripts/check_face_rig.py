#!/usr/bin/env python3
"""Overlay the demo Chogs' mouths and lids on their art and fail if anything misses.

The demo rigs (public/chog/face-rig.json) take their mouth and eyes from the measured trait groups
(public/chog/face-groups.json, written by scripts/measure_faces.py). This check finds the painted
mouth and eyes on each demo art independently of both files and confirms the rig covers them:

- the mouth patch covers the painted mouth, the viseme sits inside its box, and the head warp stays
  rigid below every painted pixel;
- 375 and 242 have a lid on BOTH eyes (the far eye used to be left open, so every blink was a wink);
- 642 (closed arcs) and 821 (glasses) get no lids;
- nothing is painted on the blush;
- each demo passes the same per-token check the app runs before painting (facePaint.fits).

Overlays are written to $RIG_CHECK_OUT (default: <temp>/rig/check).
"""

import json
import os
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import measure_faces as mf  # noqa: E402  (shared pixel rules, mirrors src/lib/facePaint.ts)

RIGS = json.loads((ROOT / "public" / "chog" / "face-rig.json").read_text())
GROUPS = json.loads((ROOT / "public" / "chog" / "face-groups.json").read_text())
ART = ROOT / "public" / "chog"
OUT = Path(os.environ.get("RIG_CHECK_OUT", Path(tempfile.gettempdir()) / "rig" / "check"))
BACKGROUND = {375: (182, 242, 90), 242: (255, 229, 106), 642: (215, 198, 245), 821: (183, 240, 210)}  # traits.BACKGROUND

# Painted features measured on the square art, independent of the rig files.
MOUTH_WINDOW = {375: (640, 590, 820, 740), 242: (640, 590, 820, 740), 642: (450, 620, 680, 740), 821: (470, 610, 670, 735)}
EYE_WINDOWS = {
    375: [(280, 460, 560, 640), (780, 340, 900, 510)],
    242: [(280, 440, 620, 620), (760, 380, 884, 520)],  # the far eye touches the hood outline at x≈886
}
NO_LIDS = {642, 821}
BLUSH = {375: (275, 632, 416, 759), 242: (275, 632, 416, 759), 642: (475, 525, 532, 573)}
WARP_MARGIN = 24  # faceRig.WARP_MARGIN


def rig_for(art):
    """faceRig.rigFor for a demo Chog: its groups, its own warp, the rigid band pushed below the paint."""
    demo = RIGS[str(art)]
    t = demo["traits"]
    mouth = GROUPS["mouths"].get(f"{t['side']}|{t['mouth']}")
    eyes = GROUPS["eyes"].get(f"{t['side']}|{t['eyes']}")
    rig = {"head": list(demo["head"]), "body": list(demo["body"]), "eyes": eyes["eyes"] if eyes else [], "skin": GROUPS["sides"][t["side"]]["skin"]}
    if mouth:
        rig.update(mouth=mouth["mouth"], patch=mouth["patch"], mouthExpect={"area": mouth["area"], "band": mouth["band"]})
    if eyes:
        rig["eyeExpect"] = [{"area": a, "band": b} for a, b in zip(eyes["area"], eyes["band"])]
    painted = rig["eyes"] + ([rig["mouth"], rig["patch"]] if mouth else [])
    if painted:
        lowest = max(b["y"] + b["h"] for b in painted) + WARP_MARGIN
        rig["head"][0] = max(rig["head"][0], lowest)
        rig["body"][0] = max(rig["body"][0], lowest)
    return rig


def dark(arr, t=48):
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    return (r < t) & (g < t) & (b < t + 8)


def components(mask, min_n):
    import scipy.ndimage as nd

    lab, n = nd.label(mask)
    found = [np.argwhere(lab == i) for i in range(1, n + 1)]
    return sorted((c for c in found if len(c) >= min_n), key=len, reverse=True)


def window_mask(mask, box):
    x0, y0, x1, y1 = box
    sub = np.zeros_like(mask)
    sub[y0:y1, x0:x1] = mask[y0:y1, x0:x1]
    return sub


def covered(pixels, boxes):
    hit = 0
    for py, px in pixels:
        if any(b["x"] <= px < b["x"] + b["w"] and b["y"] <= py < b["y"] + b["h"] for b in boxes):
            hit += 1
    return hit / max(1, len(pixels))


def fits(hole_area, band, expect):
    """facePaint.fits."""
    if not expect:
        return True
    area_ok = expect["area"] <= 0 or (expect["area"] * 0.85 - 80 <= hole_area <= expect["area"] * 1.2 + 80)
    return area_ok and band >= expect["band"] - 0.06


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    failures = []
    for art_s in RIGS:
        art = int(art_s)
        rig = rig_for(art)
        rgba = Image.open(ART / f"{art}.webp").convert("RGBA")
        plate = Image.new("RGBA", rgba.size, BACKGROUND[art] + (255,))
        im = Image.alpha_composite(plate, rgba).convert("RGB")
        arr = np.asarray(im).astype(np.int16)
        skin = mf.probe_skin(arr, rig["skin"])
        if "mouth" not in rig:
            failures.append(f"{art}: no measured mouth group")
            continue

        mouth_px = next(iter(components(window_mask(dark(arr), MOUTH_WINDOW[art]), 800)), [])
        if not len(mouth_px):
            failures.append(f"{art}: no mouth found on the art")
        elif covered(mouth_px, [rig["patch"]]) < 0.9:
            failures.append(f"{art}: patch covers {covered(mouth_px, [rig['patch']]):.2f} of the mouth")
        p = rig["patch"]
        _, _, area, band = mf.feature_hole(arr, (p["x"], p["y"], p["w"], p["h"]), skin, mf.PAD)
        if not fits(area, band, rig["mouthExpect"]):
            failures.append(f"{art}: mouth fails the per-token check (area {area}, band {band:.2f})")

        if art in EYE_WINDOWS:
            if len(rig["eyes"]) != 2:
                failures.append(f"{art}: expected two eyes, got {len(rig['eyes'])}")
            for window in EYE_WINDOWS[art]:
                comps = components(window_mask(dark(arr), window), 600)
                if not comps:
                    failures.append(f"{art}: no eye in {window}")
                    continue
                ratio = covered(comps[0], rig["eyes"])
                if ratio < 0.9:
                    failures.append(f"{art}: eye in {window} only {ratio:.2f} under a lid")
            for eye, expect in zip(rig["eyes"], rig.get("eyeExpect", [])):
                _, _, area, band = mf.feature_hole(arr, (eye["x"], eye["y"], eye["w"], eye["h"]), skin, mf.EYE_PAD)
                if not fits(area, band, expect):
                    failures.append(f"{art}: eye at {eye['x']},{eye['y']} fails the per-token check (area {area}, band {band:.2f})")
        if art in NO_LIDS and rig["eyes"]:
            failures.append(f"{art}: lids would be painted over closed arcs or glasses")

        if art in BLUSH:
            x0, y0, x1, y1 = BLUSH[art]
            pink = (arr[:, :, 0] > 165) & (arr[:, :, 1] < 140) & (arr[:, :, 0] > arr[:, :, 1] + 35)
            blush_px = np.argwhere(window_mask(pink, (x0, y0, x1 + 1, y1 + 1)))
            if covered(blush_px, [rig["mouth"]]) > 0.02:
                failures.append(f"{art}: viseme over the blush")

        pts = mf.viseme_points(rig["mouth"])
        cx = sum(x for x, _ in pts) / len(pts)
        cy = sum(y for _, y in pts) / len(pts)
        m = rig["mouth"]
        if not (m["x"] <= cx <= m["x"] + m["w"] and m["y"] <= cy <= m["y"] + m["h"]):
            failures.append(f"{art}: viseme centre {cx:.0f},{cy:.0f} outside its box")
        lowest = max(b["y"] + b["h"] for b in rig["eyes"] + [rig["mouth"], rig["patch"]])
        if rig["head"][0] <= lowest or rig["body"][0] <= lowest:
            failures.append(f"{art}: the warp bends above painted pixels")

        vis = Image.fromarray(mf.paint_patch(arr, (p["x"], p["y"], p["w"], p["h"]), skin).astype("uint8"))
        d = ImageDraw.Draw(vis)
        d.polygon(pts, fill=(91, 23, 48), outline=(18, 18, 18))
        for eye in rig["eyes"]:
            d.rectangle((eye["x"], eye["y"], eye["x"] + eye["w"], eye["y"] + eye["h"]), outline=(0, 170, 255), width=3)
        d.rectangle((p["x"], p["y"], p["x"] + p["w"], p["y"] + p["h"]), outline=(255, 140, 0), width=3)
        d.rectangle((m["x"], m["y"], m["x"] + m["w"], m["y"] + m["h"]), outline=(255, 0, 150), width=3)
        vis.save(OUT / f"{art}-overlay.png")
        print(f"{art}: mouth patch {p['w']}x{p['h']}, viseme {m['w']}x{m['h']}, lids on {len(rig['eyes'])} eyes, head band from {rig['head'][0]}")

    if failures:
        print("FAILED")
        for line in failures:
            print(" -", line)
        raise SystemExit(1)
    print("ok", OUT)


if __name__ == "__main__":
    main()
