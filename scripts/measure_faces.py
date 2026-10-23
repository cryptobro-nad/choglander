#!/usr/bin/env python3
"""Measure Chog faces by trait group and write public/chog/face-groups.json.

The Chog art is assembled from trait layers that sit at fixed positions for each Side, so a
(Side, Mouth) group shares one mouth layer and a (Side, Eyes) group shares one eye layer. This
script samples a few tokens per group, finds the layer, checks that the samples agree, and writes
a table the app reads through rigFor(). Groups that disagree, one-of-ones (no Side) and "?"
mouths are left out, so the app paints nothing on them.

    python -I scripts/measure_faces.py fetch    # download samples (outside the repo)
    python -I scripts/measure_faces.py measure  # write face-groups.json and contact sheets

Run it with -I: the art is downloaded data, and -I keeps this directory off sys.path.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_TOKENS = ROOT.parent / "chog-alive" / "src" / "data" / "tokens.json"
DEFAULT_ART = ROOT / "evidence" / "engine" / "art"
DEFAULT_SHEETS = ROOT / "evidence" / "engine" / "sheets"
OUT_JSON = ROOT / "public" / "chog" / "face-groups.json"
GATEWAYS = ["https://gateway.pinata.cloud/ipfs/", "https://ipfs.io/ipfs/", "https://w3s.link/ipfs/"]


def load_tokens(path: Path) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    return data["tokens"]


def spread(items: list, n: int, seed: str) -> list:
    """n items spread evenly through a sorted list, with a stable jitter."""
    if len(items) <= n:
        return list(items)
    rnd = random.Random(seed)
    step = len(items) / n
    return [items[min(len(items) - 1, int(i * step + rnd.random() * step))] for i in range(n)]


def pick_samples(tokens: list[dict], per_mouth: int, per_eyes: int) -> list[dict]:
    """Origin-base samples for every (Side, Mouth) group and every (Side, Eyes) group of 15 or more."""
    chosen: dict[int, dict] = {}
    origin = [t for t in tokens if t["traits"].get("Base") == "Origin" and "Side" in t["traits"]]
    groups: dict[tuple, list] = {}
    for t in origin:
        groups.setdefault(("mouth", t["traits"]["Side"], t["traits"].get("Mouth", "?")), []).append(t)
        groups.setdefault(("eyes", t["traits"]["Side"], t["traits"].get("Eyes", "?")), []).append(t)
    for key, members in sorted(groups.items()):
        kind = key[0]
        if key[2] == "?":
            continue
        if kind == "eyes" and len(members) < 15:
            continue
        n = per_mouth if kind == "mouth" else per_eyes
        members = sorted(members, key=lambda t: t["metaId"])
        for t in spread(members, n, "|".join(key)):
            chosen[t["metaId"]] = t
    # A few of the other bases, to decide whether they share the face position.
    for base in ("Skull", "Radioactive"):
        others = sorted((t for t in tokens if t["traits"].get("Base") == base), key=lambda t: t["metaId"])
        for t in spread(others, 6, base):
            chosen[t["metaId"]] = t
    return sorted(chosen.values(), key=lambda t: t["metaId"])


def download(token: dict, art: Path) -> str:
    target = art / f"{token['metaId']}.webp"
    if target.exists() and target.stat().st_size > 1000:
        return "cached"
    last = ""
    for attempt in range(4):
        for gateway in GATEWAYS:
            try:
                req = urllib.request.Request(gateway + token["image"], headers={"User-Agent": "chog-face-measure"})
                with urllib.request.urlopen(req, timeout=60) as res:
                    body = res.read()
                if len(body) < 1000 or body[:4] != b"RIFF":
                    last = f"{gateway}: not a webp"
                    continue
                target.write_bytes(body)
                return "ok"
            except Exception as exc:  # network noise; try the next gateway
                last = f"{gateway}: {exc}"
        time.sleep(2 + attempt * 3)
    return f"failed {last}"


def cmd_fetch(args) -> None:
    tokens = load_tokens(args.tokens)
    samples = pick_samples(tokens, args.per_mouth, args.per_eyes)
    args.art.mkdir(parents=True, exist_ok=True)
    print(f"{len(samples)} samples -> {args.art}")
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        results = list(pool.map(lambda t: (t["metaId"], download(t, args.art)), samples))
    bad = [r for r in results if not r[1] in ("ok", "cached")]
    print(f"ok {len(results) - len(bad)}, failed {len(bad)}")
    for meta_id, why in bad:
        print(" ", meta_id, why)


# ---------------------------------------------------------------------------------------------
# Measurement. The pixel rules below mirror src/lib/facePaint.ts, so the contact sheets show what
# the app paints: the same skin distance, hole rule, fill, viseme and lid shapes.
# ---------------------------------------------------------------------------------------------

NONSKIN = 60  # |dr|+|dg|+|db| from the skin above which a pixel is a feature (facePaint.NONSKIN)
SOURCE = 36  # fill sources must be this close to the skin (facePaint.SOURCE)
PAD = 16  # mouth patch padding (facePaint.MOUTH_PAD)
EYE_PAD = 8  # eye check padding (facePaint.EYE_PAD)
SIDES = ("Left", "Right")
# Where skin probes may sit, and where each feature is looked for (window) and centred (anchor).
FACE = {"Left": (110, 380, 930, 830), "Right": (250, 240, 1000, 820)}
MOUTH = {
    "Left": {"window": (470, 540, 960, 890), "anchor": (735, 655), "reach": 95},
    "Right": {"window": (300, 540, 860, 890), "anchor": (550, 680), "reach": 95},
}
EYES = {
    "Left": {
        "near": {"window": (200, 380, 660, 720), "anchor": (420, 552), "reach": 90, "split": True, "trait": "All"},
        "far": {"window": (720, 280, 940, 570), "anchor": (842, 427), "reach": 60, "split": True, "trait": "All"},
    },
    "Right": {
        "far": {"window": (240, 180, 600, 520), "anchor": (422, 360), "reach": 90, "split": True, "trait": "All"},
        "near": {"window": (590, 340, 1000, 680), "anchor": (830, 512), "reach": 100, "split": True, "trait": "All"},
    },
}


def load_art(path: Path):
    import numpy as np
    from PIL import Image

    return np.asarray(Image.open(path).convert("RGB")).astype(np.int16)


def dist(arr, color):
    import numpy as np

    return np.abs(arr - np.asarray(color, dtype=np.int16)).sum(axis=2)


def crop(arr, rect):
    x0, y0, x1, y1 = rect
    return arr[y0:y1, x0:x1]


def rough_skin(arr, side: str):
    """First pass: the most common colour on the face, ignoring lines, white and the background."""
    import numpy as np

    reg = crop(arr, FACE[side])[::3, ::3].reshape(-1, 3).astype(int)
    bg = arr[4, 4].astype(int)
    keep = (reg.sum(1) > 150) & (np.abs(reg - bg).sum(1) > 40) & ~((reg > 242).all(1))
    reg = reg[keep]
    q = reg // 12
    keys = q[:, 0] * 10000 + q[:, 1] * 100 + q[:, 2]
    vals, counts = np.unique(keys, return_counts=True)
    return np.median(reg[keys == vals[counts.argmax()]], axis=0)


def probe_skin(arr, probes):
    """facePaint.sampleSkin: median of the probe tiles, skipping lines and the background colour."""
    import numpy as np

    px = np.concatenate([arr[y : y + h : 2, x : x + w : 2].reshape(-1, 3) for x, y, w, h in probes]).astype(int)
    keep = px.sum(1) > 150
    for color in (arr[4, 4], arr[4, 995]):
        keep &= np.abs(px - color.astype(int)).sum(1) > 40
    if keep.sum() < 20:
        return None
    return np.median(px[keep], axis=0)


def border_labels(lab):
    import numpy as np

    return set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]])).tolist()) - {0}


def feature_hole(arr, box, skin, pad):
    """facePaint.featureHole: the non-skin components inside box+pad that do not reach its edge.

    Anything that touches the edge (the jaw, hair, a hand, a laser) is left alone. Also returns
    the share of skin in the ring between the box and the padded rect.
    """
    import numpy as np
    import scipy.ndimage as nd

    x, y, w, h = box
    x0, y0 = max(0, x - pad), max(0, y - pad)
    x1, y1 = min(arr.shape[1], x + w + pad), min(arr.shape[0], y + h + pad)
    nonskin = dist(arr[y0:y1, x0:x1], skin) > NONSKIN
    lab, _ = nd.label(nonskin)
    edge = border_labels(lab)
    hole = nonskin & ~np.isin(lab, list(edge)) if edge else nonskin.copy()
    ring = np.ones_like(nonskin)
    ring[y - y0 : y - y0 + h, x - x0 : x - x0 + w] = False
    band = float((~nonskin[ring]).mean()) if ring.any() else 1.0
    return hole, (x0, y0, x1, y1), int(hole.sum()), band


def bbox(mask, offset=(0, 0)):
    import numpy as np

    ys, xs = np.where(mask)
    if not len(xs):
        return None
    return (int(xs.min()) + offset[0], int(ys.min()) + offset[1], int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1))


def iou(a, b):
    if not a or not b:
        return 0.0
    ix = max(0, min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]))
    inter = ix * iy
    return inter / float(a[2] * a[3] + b[2] * b[3] - inter)


def layer(arr, skin, base, spec):
    """One sample's trait layer: non-skin, not a fixed Side feature, enclosed by the window, near the anchor."""
    import numpy as np
    import scipy.ndimage as nd

    x0, y0, x1, y1 = spec["window"]
    ax, ay = spec["anchor"]
    win_base = crop(base[spec.get("trait", "Mouth")], spec["window"])
    m = dist(crop(arr, spec["window"]), skin) > NONSKIN
    if spec.get("split", False):
        m &= ~win_base  # eyes: cut the layer free of the outline it may touch
    lab, n = nd.label(m, structure=np.ones((3, 3)))
    edge = border_labels(lab)
    out = np.zeros_like(m)
    for i, sl in enumerate(nd.find_objects(lab), start=1):
        if sl is None or i in edge:
            continue
        comp = lab[sl] == i
        if comp.sum() < 80 or win_base[sl][comp].mean() > 0.5:
            continue
        bx0, bx1 = sl[1].start + x0, sl[1].stop + x0
        by0, by1 = sl[0].start + y0, sl[0].stop + y0
        dx = max(bx0 - ax, 0, ax - bx1)
        dy = max(by0 - ay, 0, ay - by1)
        if (dx * dx + dy * dy) ** 0.5 > spec["reach"]:
            continue
        out[sl] |= comp
    full = np.zeros(arr.shape[:2], dtype=bool)
    full[y0:y1, x0:x1] = out
    return full


def largest(mask):
    import numpy as np
    import scipy.ndimage as nd

    lab, n = nd.label(mask, structure=np.ones((3, 3)))
    if not n:
        return mask
    sizes = nd.sum(mask, lab, range(1, n + 1))
    return lab == (int(np.argmax(sizes)) + 1)


def to_box(t):
    return {"x": t[0], "y": t[1], "w": t[2], "h": t[3]}


def viseme_box(lips):
    """The open mouth is centred on the drawn lips, about as wide, within sane limits."""
    x, y, w, h = lips
    vw = min(220, max(96, w + 28))
    vh = min(134, max(76, h + 28))
    return {"x": int(round(x + w / 2 - vw / 2)), "y": int(round(y + h / 2 - vh / 2)), "w": int(vw), "h": int(vh)}


# --- paint ports (facePaint.ts) ---------------------------------------------------------------


def paint_patch(arr, patch_box, skin, pad=PAD, grain=None):
    """facePaint.mouthPatch: erase the enclosed layer; fill each column from the skin above and below
    (each end averaged over 7 columns), then lay the art's grain back on top."""
    import numpy as np
    import scipy.ndimage as nd

    x, y, w, h = patch_box
    x0, y0 = max(0, x - pad), max(0, y - pad)
    x1, y1 = min(arr.shape[1], x + w + pad), min(arr.shape[0], y + h + pad)
    hole, _, _, _ = feature_hole(arr, patch_box, skin, pad)
    nonskin = dist(arr[y0:y1, x0:x1], skin) > NONSKIN
    outside = nonskin & ~hole
    disk = np.array([[dx * dx + dy * dy <= 10 for dx in range(-3, 4)] for dy in range(-3, 4)])
    grown = nd.binary_dilation(hole, structure=disk) & ~outside | hole
    sub = arr[y0:y1, x0:x1].astype(float).copy()
    src = (dist(arr[y0:y1, x0:x1], skin) <= SOURCE) & ~grown
    hh, ww = grown.shape
    skin_f = np.asarray(skin, dtype=float)
    mean = grain.reshape(-1, 3).mean(axis=0) if grain is not None else None

    def source_at(cx, cy):
        if not src[cy, cx]:
            return None
        lo, hi = max(0, cx - 3), min(ww, cx + 4)
        sel = src[cy, lo:hi]
        return sub[cy, lo:hi][sel].mean(axis=0)

    for cx in np.where(grown.any(axis=0))[0]:
        col = grown[:, cx]
        edges = np.flatnonzero(np.diff(np.concatenate([[0], col.astype(int), [0]])))
        for ys, ye in zip(edges[::2], edges[1::2] - 1):
            above = next((v for v in (source_at(cx, ys - k) for k in range(1, 65) if ys - k >= 0) if v is not None), None)
            below = next((v for v in (source_at(cx, ye + k) for k in range(1, 65) if ye + k < hh) if v is not None), None)
            a = above if above is not None else (below if below is not None else skin_f)
            b = below if below is not None else a
            t = (np.arange(ys, ye + 1) - ys) / max(1, ye - ys)
            fill = a + (b - a) * t[:, None]
            if grain is not None:
                fill = fill + grain[y0 + ys : y0 + ye + 1, x0 + cx] - mean
            sub[ys : ye + 1, cx] = fill
    out = arr.copy()
    out[y0:y1, x0:x1] = np.clip(np.round(sub), 0, 255).astype(np.int16)
    return out


def viseme_points(box, shape=(46, 62, 0.15, 0)):
    """facePaint.traceViseme for the open shape."""
    import numpy as np

    sx = (box["w"] - 18) / 92
    sy = (box["h"] - 16) / 74
    cx = box["x"] + box["w"] / 2
    top = box["y"] + 6
    w, h, r = shape[0] * sx, shape[1] * sy, shape[2]
    hu = h * (0.06 + 0.5 * r)
    hd = h * (1.15 - 0.6 * r)
    yc = top + hu
    p = 1 - 0.45 * (1 - r)
    pts = []
    for i in range(49):
        th = np.pi + (i / 48) * 2 * np.pi
        cs, sn = np.cos(th), np.sin(th)
        x = cx + w * np.sign(cs) * (abs(cs) ** (p if sn > 0 else 1))
        y = yc + (sn * hu if sn < 0 else (sn**p) * hd)
        pts.append((float(x), float(y)))
    return pts


LID_CLOSE = 0.88  # facePaint.LID_CLOSE: a shut lid rests here, so the lower lash line still shows


def lid_shapes(eye, amount):
    """facePaint.paintLid: the lid fill (from above the eye down to a sagging curve) and its line."""
    import numpy as np
    from PIL import Image, ImageDraw

    sag = eye.get("sag", 8)
    x, y, w, h = eye["x"], eye["y"], eye["w"], eye["h"]
    ly = y + h * amount * LID_CLOSE
    cx, cy = x + w / 2, ly + sag * amount

    def quad(t, a, c, b):
        return (1 - t) ** 2 * a + 2 * (1 - t) * t * c + t**2 * b

    curve = [(quad(i / 24, x + w + 8, cx, x - 8), quad(i / 24, ly, cy, ly)) for i in range(25)]
    fill = Image.new("L", (1000, 1000), 0)
    ImageDraw.Draw(fill).polygon([(x - 8, y - 8), (x + w + 8, y - 8)] + curve, fill=255)
    line = Image.new("L", (1000, 1000), 0)
    ImageDraw.Draw(line).line(curve[::-1], fill=255, width=8, joint="curve")
    return np.asarray(fill) > 0, np.asarray(line) > 0


def skin_texture(arr, probes, skin):
    """facePaint.skinSwatch: real skin from this token's probe tiles, tiled, so lids keep the grain."""
    import numpy as np

    def clean(t):
        chroma = t.max(axis=2) - t.min(axis=2)
        skin_chroma = max(skin) - min(skin)
        return (dist(t, skin) <= NONSKIN).mean() >= 0.97 and chroma.max() <= skin_chroma + 30

    good = [arr[y : y + h, x : x + w] for x, y, w, h in probes if clean(arr[y : y + h, x : x + w])]
    if not good:
        return np.broadcast_to(np.asarray(skin, dtype=np.int16), arr.shape)
    tile = np.concatenate(good[:4], axis=1)
    reps = (1000 // tile.shape[0] + 1, 1000 // tile.shape[1] + 1, 1)
    return np.tile(tile, reps)[:1000, :1000]


def rle(mask):
    """Row-major run lengths of a boolean mask, starting with a run of False (facePaint.unrle)."""
    flat = mask.astype(bool).ravel()
    runs, current, n = [], False, 0
    for v in flat.tolist():
        if v == current:
            n += 1
        else:
            runs.append(n)
            current, n = v, 1
    runs.append(n)
    return runs


def unrle(runs, w, h):
    import numpy as np

    out = np.zeros(w * h, dtype=bool)
    i, v = 0, False
    for n in runs:
        out[i : i + n] = v
        i += n
        v = not v
    return out.reshape(h, w)


def eye_mask_entry(vote, box, grow=4):
    """The group's eye silhouette: the convex hull of the eye layer, a little dilated.

    The hull takes in the eye whites (close to the cream skin) and the parts of the eye that sit
    where most other eye traits sit too, which the layer vote can miss.
    """
    import numpy as np
    import scipy.ndimage as nd
    from PIL import Image, ImageDraw
    from scipy.spatial import ConvexHull

    x, y, w, h = box
    x0, y0 = max(0, x - grow), max(0, y - grow)
    x1, y1 = min(1000, x + w + grow), min(1000, y + h + grow)
    ys, xs = np.nonzero(vote[y0:y1, x0:x1])
    pts = np.stack([xs, ys], axis=1)
    hull = pts[ConvexHull(pts).vertices]
    img = Image.new("L", (x1 - x0, y1 - y0), 0)
    ImageDraw.Draw(img).polygon([tuple(map(float, p)) for p in hull], fill=255)
    m = nd.binary_dilation(np.asarray(img) > 0, iterations=2)
    return {"x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0, "rle": rle(m)}


def lid_mask(arr, eye):
    """facePaint.lidMask: a lid paints only the group's eye pixels, and only where they are black or
    white in this token, so the outline, blush, hair and hats are never painted over, and the skin
    around the eye keeps its grain."""
    import numpy as np

    m = eye["mask"]
    x0, y0, w, h = m["x"], m["y"], m["w"], m["h"]
    sub = arr[y0 : y0 + h, x0 : x0 + w]
    chroma = sub.max(axis=2) - sub.min(axis=2)
    out = np.zeros(arr.shape[:2], dtype=bool)
    shape = np.zeros(arr.shape[:2], dtype=bool)
    shape[y0 : y0 + h, x0 : x0 + w] = unrle(m["rle"], w, h)
    out[y0 : y0 + h, x0 : x0 + w] = shape[y0 : y0 + h, x0 : x0 + w] & (chroma <= 48)
    return out, shape


# --- measurement ------------------------------------------------------------------------------


def side_models(tokens, art_dir):
    """Per Side: skin probes, the fixed features (outline, nose, blush), and each sample's skin."""
    import numpy as np
    import scipy.ndimage as nd

    members = {s: [] for s in SIDES}
    for t in tokens:
        tr = t["traits"]
        if tr.get("Base") == "Origin" and tr.get("Side") in SIDES and (art_dir / f"{t['metaId']}.webp").exists():
            members[tr["Side"]].append(t)
    models = {}
    for side in SIDES:
        x0, y0, x1, y1 = FACE[side]
        tiles = [(tx, ty) for ty in range(y0, y1 - 24, 24) for tx in range(x0, x1 - 24, 24)]
        rough, scores = {}, np.zeros(len(tiles))
        for t in members[side]:
            arr = load_art(art_dir / f"{t['metaId']}.webp")
            skin = rough_skin(arr, side)
            rough[t["metaId"]] = skin
            ok = dist(arr, skin) <= NONSKIN
            scores += [ok[ty : ty + 24, tx : tx + 24].mean() >= 0.9 for tx, ty in tiles]
        scores /= max(1, len(members[side]))
        good = sorted((tiles[i][0], tiles[i][1], 24, 24) for i in np.flatnonzero(scores >= scores.max() - 0.06))
        probes = spread(good, 12, side) if len(good) > 12 else good
        # The fixed features (outline, nose, blush, grain) are non-skin in every group, whichever
        # mouth or eyes it has. A trait layer is non-skin only in its own group.
        counts: dict = {}
        sizes: dict = {}
        skins = {}
        for t in members[side]:
            arr = load_art(art_dir / f"{t['metaId']}.webp")
            skin = probe_skin(arr, probes)
            skins[t["metaId"]] = skin if skin is not None else rough[t["metaId"]]
            ns = (dist(arr, skins[t["metaId"]]) > NONSKIN).astype(np.uint8)
            for trait in ("Mouth", "Eyes"):
                key = (trait, t["traits"].get(trait, "?"))
                counts[key] = counts.get(key, np.zeros((1000, 1000), np.uint8)) + ns
                sizes[key] = sizes.get(key, 0) + 1
        # Judge mouth pixels by the Mouth groups and eye pixels by the Eyes groups: every Eyes
        # group mixes mouths, so the mouth centre is non-skin in most of them.
        everyone = sum(counts[k].astype(np.int32) for k in counts if k[0] == "Mouth")
        base = {"All": nd.binary_dilation(everyone >= 0.9 * len(members[side]), iterations=1)}
        for trait in ("Mouth", "Eyes"):
            votes = np.zeros((1000, 1000))
            groups = 0
            for key, total in counts.items():
                if key[0] == trait and sizes[key] >= 4:
                    votes += total >= 0.6 * sizes[key]
                    groups += 1
            base[trait] = nd.binary_dilation(votes >= 0.85 * max(1, groups), iterations=1)
        models[side] = {"probes": probes, "base": base, "skins": skins, "members": members[side], "best": float(scores.max())}
        print(f"{side}: {len(members[side])} samples, {len(probes)} skin probes (best tile skin in {scores.max():.0%} of samples)")
    return models


def measure_feature(samples, model, spec, pad, eye=False):
    """Group vote, per-sample agreement, inpaint quality and the runtime check statistics."""
    import numpy as np
    import scipy.ndimage as nd

    layers = [layer(s["arr"], s["skin"], model["base"], spec) for s in samples]
    vote = np.mean(layers, axis=0) >= 0.5
    box = bbox(vote)
    if not box:
        return {"ok": False, "why": "no layer near the anchor"}
    per = []
    gx, gy, gw, gh = box
    for s, lay in zip(samples, layers):
        near = np.zeros_like(lay)
        near[max(0, gy - 30) : gy + gh + 30, max(0, gx - 30) : gx + gw + 30] = True
        own = lay & near
        hole, rect, area, band = feature_hole(s["arr"], box, s["skin"], pad)
        lay_r = crop(lay, rect)
        n_layer = max(1, int(lay_r.sum()))
        # Ignore the art's grain specks when measuring spill.
        lab, n = nd.label(hole)
        if n:
            sizes = nd.sum(hole, lab, range(1, n + 1))
            big = np.isin(lab, [i + 1 for i, v in enumerate(sizes) if v >= 12])
        else:
            big = hole
        cover = float((hole & lay_r).sum()) / n_layer
        spill = float((big & ~nd.binary_dilation(lay_r, iterations=4)).sum()) / n_layer
        per.append({"id": s["id"], "iou": round(iou(bbox(own), box), 3), "area": area, "band": round(band, 3), "cover": round(cover, 3), "spill": round(spill, 3)})
    med_band = float(np.median([p["band"] for p in per]))
    clean = [p for p in per if p["band"] >= med_band - 0.05]
    agree = sum(1 for p in clean if p["iou"] >= 0.8)
    return {
        "ok": True,
        "box": box,
        "vote": vote,
        "per": per,
        "clean": len(clean),
        "agree": agree,
        "iou": float(np.median([p["iou"] for p in clean])),
        "area": int(np.median([p["area"] for p in clean])),
        "band": float(np.median([p["band"] for p in clean])),
        "cover": float(np.median([p["cover"] for p in clean])),
        "spill": float(np.median([p["spill"] for p in clean])),
    }


def paintable_skin(skin):
    """facePaint.paintableSkin: the fill was made for the cream face, not dark or bright skins."""
    return sum(skin) >= 450 and max(skin) - min(skin) <= 60


def fits(area, band, expect):
    """facePaint.fits: the token's feature is the measured size and its ring is as clear."""
    if not expect or expect.get("area", 0) <= 0:
        return True
    return expect["area"] * 0.85 - 80 <= area <= expect["area"] * 1.2 + 80 and band >= expect["band"] - 0.06


def render_mouth(s, entry, view, scale):
    """Art with the patch (magenta) and viseme box (cyan), then what the app paints when open."""
    from PIL import Image, ImageDraw

    mouth, patch = entry["mouth"], entry["patch"]
    plain = Image.fromarray(s["arr"].astype("uint8"))
    d = ImageDraw.Draw(plain)
    d.rectangle((patch["x"], patch["y"], patch["x"] + patch["w"], patch["y"] + patch["h"]), outline=(255, 0, 150), width=3)
    d.rectangle((mouth["x"], mouth["y"], mouth["x"] + mouth["w"], mouth["y"] + mouth["h"]), outline=(0, 170, 255), width=3)
    arr = s["arr"]
    _, _, area, band = feature_hole(arr, (patch["x"], patch["y"], patch["w"], patch["h"]), s["skin"], PAD)
    why = "" if paintable_skin(s["skin"]) else "skin: not painted"
    if not why and not fits(area, band, {"area": entry["area"], "band": entry["band"]}):
        why = "check: not painted"
    ok = not why
    if ok and entry.get("inpaint", True):
        grain = skin_texture(arr, s["probes"], s["skin"]) if s.get("probes") else None
        arr = paint_patch(arr, (patch["x"], patch["y"], patch["w"], patch["h"]), s["skin"], grain=grain)
    painted = Image.fromarray(arr.astype("uint8"))
    d2 = ImageDraw.Draw(painted)
    if ok:
        pts = viseme_points(mouth)
        d2.polygon(pts, fill=(91, 23, 48))
        d2.line(pts + [pts[0]], fill=(18, 18, 18), width=10, joint="curve")
    else:
        d2.rectangle((view[0] + 4, view[1] + 4, view[0] + 150, view[1] + 22), fill=(20, 20, 30))
        d2.text((view[0] + 8, view[1] + 8), why, fill=(255, 255, 255))
    out = []
    for im in (plain, painted):
        c = im.crop(view)
        out.append(c.resize((int(c.width * scale), int(c.height * scale))))
    return out


def render_eyes(s, eyes, view, scale, expects=()):
    """Art with the eye boxes, then lids at the sleepy rest and fully shut, as the app paints them."""
    from PIL import Image, ImageDraw

    tex = skin_texture(s["arr"], s["probes"], s["skin"])
    why = "" if paintable_skin(s["skin"]) else "skin: not painted"
    for eye, expect in zip(eyes, expects):
        _, _, area, band = feature_hole(s["arr"], (eye["x"], eye["y"], eye["w"], eye["h"]), s["skin"], EYE_PAD)
        if not why and not fits(area, band, expect):
            why = "check: not painted"
    out = []
    for amount in (None, 0.42, 1.0):
        arr = s["arr"].copy()
        if amount is not None and not why:
            for eye in eyes:
                fill, line = lid_shapes(eye, amount)
                allowed, silhouette = lid_mask(s["arr"], eye)
                arr[fill & allowed] = tex[fill & allowed]
                arr[line & silhouette] = (18, 18, 18)
        im = Image.fromarray(arr.astype("uint8"))
        d = ImageDraw.Draw(im)
        if amount is None:
            for eye in eyes:
                d.rectangle((eye["x"], eye["y"], eye["x"] + eye["w"], eye["y"] + eye["h"]), outline=(0, 170, 255), width=3)
        elif why:
            d.rectangle((view[0] + 4, view[1] + 4, view[0] + 200, view[1] + 26), fill=(20, 20, 30))
            d.text((view[0] + 8, view[1] + 8), why, fill=(255, 255, 255))
        c = im.crop(view)
        out.append(c.resize((int(c.width * scale), int(c.height * scale))))
    return out


def sheet(rows, path, label_h=18):
    """rows: [(label, [tiles])] stacked into one PNG."""
    from PIL import Image, ImageDraw

    width = max(sum(t.width + 4 for t in tiles) for _, tiles in rows)
    height = sum(max(t.height for t in tiles) + label_h + 6 for _, tiles in rows)
    img = Image.new("RGB", (width, height), (250, 248, 244))
    d = ImageDraw.Draw(img)
    y = 0
    for label, tiles in rows:
        d.text((4, y + 3), label, fill=(20, 20, 30))
        y += label_h
        x = 0
        for t in tiles:
            img.paste(t, (x, y))
            x += t.width + 4
        y += max(t.height for t in tiles) + 6
    img.save(path)


# Decisions made by looking at the contact sheets in evidence/engine/sheets. Keys are "Side|Trait".
# Mouth groups are accepted on the numbers alone (agreement, clean erase); every accepted group was
# also checked by eye on mouth_*.png.
MOUTH_REJECT: dict[str, str] = {}
MOUTH_NO_INPAINT: set[str] = set()
# Lids are painted only on open eyes that were looked at, shut and at the sleepy rest, on eyes/*.png.
EYES_REVIEWED: set[str] = {"Left|Base", "Left|Smirk", "Left|Side Eye", "Left|Vertical", "Left|Retard", "Right|Round"}
EYES_REJECT: dict[str, str] = {
    "Left|Happy": "closed arcs: already shut",
    "Right|Happy": "closed arcs: already shut",
    "Left|Flat": "flat lines: already shut",
    "Right|Closed Eye Crying": "already shut",
    "Right|Dead": "X eyes",
    "Right|Heart": "hearts, not eyes",
    "Left|BTC Glass": "glasses",
    "Left|cyan laser": "laser beams",
    "Left|fire laser": "laser beams",
    "Right|Green laser": "laser beams",
    "Right|Purple laser": "laser beams",
    "Left|Clown Eye Mix": "near eye is painted into the clown make-up",
}


def group_by(model, trait, art_dir, limit):
    groups: dict[str, list] = {}
    for t in model["members"]:
        value = t["traits"].get(trait)
        if value:
            groups.setdefault(value, []).append(t)
    for value, members in sorted(groups.items()):
        samples = [{"id": t["metaId"], "arr": load_art(art_dir / f"{t['metaId']}.webp"), "skin": model["skins"][t["metaId"]], "probes": model["probes"]} for t in members[:limit]]
        yield value, samples


def cmd_measure(args) -> None:
    import numpy as np

    tokens = load_tokens(args.tokens)
    args.sheets.mkdir(parents=True, exist_ok=True)
    models = side_models(tokens, args.art)
    table = {"version": 1, "source": "scripts/measure_faces.py", "sides": {}, "mouths": {}, "eyes": {}}
    reports = {}
    for side in SIDES:
        table["sides"][side] = {"skin": [list(p) for p in models[side]["probes"]]}

    only = args.only
    for side in SIDES:
        if only == "eyes":
            break
        rows = []
        for mouth, samples in group_by(models[side], "Mouth", args.art, args.limit):
            key = f"{side}|{mouth}"
            res = measure_feature(samples, models[side], MOUTH[side], PAD)
            if not res["ok"]:
                reports[f"mouth {key}"] = {"n": len(samples), "verdict": res["why"]}
                print(f"{key:26s} n={len(samples):2d} {res['why']}")
                continue
            dark = np.mean([s["arr"].sum(2) < 200 for s in samples], axis=0) >= 0.5
            lips = bbox(largest(res["vote"] & dark)) or res["box"]
            x, y, w, h = res["box"]
            entry = {"mouth": viseme_box(lips), "patch": to_box(res["box"]), "area": res["area"], "band": round(res["band"], 3)}
            inpaint_ok = res["cover"] >= 0.92 and res["spill"] <= 0.2
            if key in MOUTH_NO_INPAINT or not inpaint_ok:
                entry["inpaint"] = False
            reasons = []
            if res["clean"] < 4:
                reasons.append(f"{res['clean']} clean samples")
            if res["agree"] < max(4, round(res["clean"] * 0.8)):
                reasons.append(f"samples disagree ({res['agree']}/{res['clean']} clean at IoU>=0.8)")
            if not inpaint_ok and key not in MOUTH_NO_INPAINT:
                reasons.append(f"inpaint unclean (cover {res['cover']:.2f}, spill {res['spill']:.2f})")
            if w > 460 or h > 190:
                reasons.append(f"layer too large {w}x{h}")
            if key in MOUTH_REJECT:
                reasons.append(MOUTH_REJECT[key])
            verdict = "measured" if not reasons else "; ".join(reasons)
            reports[f"mouth {key}"] = {k: v for k, v in res.items() if k not in ("vote", "ok")} | {"n": len(samples), "verdict": verdict, "entry": entry}
            if not reasons:
                table["mouths"][key] = entry
            print(f"{key:26s} n={len(samples):2d} clean={res['clean']} agree={res['agree']} iou={res['iou']:.2f} cover={res['cover']:.2f} spill={res['spill']:.2f} box={res['box']} -> {verdict}")
            m = entry["mouth"]
            view = (min(x, m["x"]) - 40, min(y, m["y"]) - 40, max(x + w, m["x"] + m["w"]) + 40, max(y + h, m["y"] + m["h"]) + 40)
            scale = min(0.6, 150 / max(1, view[3] - view[1]))
            tiles = []
            for s in samples[:6]:
                tiles += render_mouth(s, entry, view, scale)
            rows.append((f"{key}  n={len(samples)} clean={res['clean']} agree={res['agree']} IoU~{res['iou']:.2f}  -> {verdict}", tiles))
        for i in range(0, len(rows), 4):
            sheet(rows[i : i + 4], args.sheets / f"mouth_{side}_{i // 4 + 1}.png")

    for side in SIDES:
        if only == "mouth":
            break
        for name, samples in group_by(models[side], "Eyes", args.art, args.limit):
            key = f"{side}|{name}"
            if len(samples) < 4:
                continue
            boxes, stats, reasons = [], [], []
            for which, spec in EYES[side].items():
                res = measure_feature(samples, models[side], spec, EYE_PAD, eye=True)
                if not res["ok"]:
                    reasons.append(f"{which} eye: {res['why']}")
                    continue
                if res["clean"] < 4 or res["agree"] < max(4, round(res["clean"] * 0.8)):
                    reasons.append(f"{which} eye: {res['agree']} of {res['clean']} clean samples agree")
                x, y, w, h = res["box"]
                if w < 50 or h < 50:
                    reasons.append(f"{which} eye found only a {w}x{h} fragment (joined to the outline)")
                box = {"x": x, "y": y, "w": w, "h": h, "sag": max(6, min(12, round(h * 0.08))), "mask": eye_mask_entry(res["vote"], res["box"])}
                boxes.append(box)
                stats.append({"which": which, "clean": res["clean"], "agree": res["agree"], "iou": round(res["iou"], 3), "area": res["area"], "band": round(res["band"], 3), "per": res["per"]})
            if key in EYES_REJECT:
                reasons.append(EYES_REJECT[key])
            if not reasons and key not in EYES_REVIEWED:
                reasons.append("not reviewed on a contact sheet yet")
            verdict = "measured" if not reasons else "; ".join(reasons)
            reports[f"eyes {key}"] = {"n": len(samples), "eyes": stats, "verdict": verdict}
            if not reasons:
                table["eyes"][key] = {"eyes": boxes, "area": [s["area"] for s in stats], "band": [s["band"] for s in stats]}
            print(f"{key:26s} n={len(samples):2d} {[(s['which'], s['clean'], s['agree'], s['iou']) for s in stats]} -> {verdict}")
            if len(boxes) == 2:
                view = (min(b["x"] for b in boxes) - 40, min(b["y"] for b in boxes) - 40, max(b["x"] + b["w"] for b in boxes) + 40, max(b["y"] + b["h"] for b in boxes) + 40)
                scale = min(0.6, 230 / max(1, view[3] - view[1]))
                label = f"{key}  n={len(samples)} {[(s['which'], s['agree'], s['clean']) for s in stats]}  -> {verdict}"
                expects = [{"area": st["area"], "band": st["band"]} for st in stats]
                pair = [(label if i == 0 else "", render_eyes(s, boxes, view, scale, expects)) for i, s in enumerate(samples[:4])]
                (args.sheets / "eyes").mkdir(exist_ok=True)
                sheet(pair, args.sheets / "eyes" / f"{side}_{name.replace(' ', '_')}.png")

    if not only:
        args.out.write_text(json.dumps(table, indent=1) + "\n", encoding="utf-8")
    (args.sheets / f"report{'_' + only if only else ''}.json").write_text(json.dumps(reports, indent=1, default=str) + "\n", encoding="utf-8")
    print(f"{len(table['mouths'])} mouth groups, {len(table['eyes'])} eye groups -> {args.out if not only else '(sheets only)'}")


def main(argv: list[str]) -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--tokens", type=Path, default=DEFAULT_TOKENS)
    parser.add_argument("--art", type=Path, default=DEFAULT_ART)
    parser.add_argument("--sheets", type=Path, default=DEFAULT_SHEETS)
    sub = parser.add_subparsers(dest="cmd", required=True)
    fetch = sub.add_parser("fetch")
    fetch.add_argument("--per-mouth", type=int, default=6)
    fetch.add_argument("--per-eyes", type=int, default=4)
    fetch.add_argument("--workers", type=int, default=8)
    fetch.set_defaults(run=cmd_fetch)
    measure = sub.add_parser("measure")
    measure.add_argument("--out", type=Path, default=OUT_JSON)
    measure.add_argument("--only", choices=["mouth", "eyes"], help="sheets for one feature, no JSON written")
    measure.add_argument("--limit", type=int, default=12, help="samples per group")
    measure.set_defaults(run=cmd_measure)
    args = parser.parse_args(argv)
    args.run(args)


if __name__ == "__main__":
    main(sys.argv[1:])
