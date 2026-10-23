"""Builds the launcher icons from the Chog art (public/chog/375.webp), replacing Capacitor's stock ones.

    python android/tools/make_icons.py

Writes, for every density:
  mipmap-*/ic_launcher_foreground.png   adaptive foreground: the Chog's face, full bleed
  mipmap-*/ic_launcher_monochrome.png   Android 13+ themed icon: the face's ink lines only
  mipmap-*/ic_launcher.png              legacy (Android 7.x) rounded-square icon
  mipmap-*/ic_launcher_round.png        legacy round icon
  drawable-nodpi/chog_caller.png        the caller photo on the ringing call notification
The adaptive background is the vector drawable/ic_launcher_background.xml (a soft periwinkle).
Needs Pillow and NumPy.
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
RES = ROOT / "android" / "app" / "src" / "main" / "res"
ART = ROOT / "public" / "chog" / "375.webp"

DENSITIES = {"mdpi": 1.0, "hdpi": 1.5, "xhdpi": 2.0, "xxhdpi": 3.0, "xxxhdpi": 4.0}
# The art (1000 px) drawn 100 dp wide with the face centre (600, 560) on the icon centre: eyes,
# blush and smirk fill the 72 dp mask, and every hard edge of the art stays outside it.
SCALE_DP_PER_PX = 0.10
FACE_CENTRE = (600, 560)
INNER = (226, 232, 248)
OUTER = (185, 198, 234)


def art():
    return Image.open(ART).convert("RGBA")


def foreground(source, size_px):
    px = size_px / 108.0
    width = int(round(1000 * SCALE_DP_PER_PX * px))
    scaled = source.resize((width, width), Image.LANCZOS)
    canvas = Image.new("RGBA", (size_px, size_px), (0, 0, 0, 0))
    ox = int(round(54 * px - FACE_CENTRE[0] * SCALE_DP_PER_PX * px))
    oy = int(round(54 * px - FACE_CENTRE[1] * SCALE_DP_PER_PX * px))
    canvas.paste(scaled, (ox, oy), scaled)
    return canvas


def monochrome(fg):
    """The ink: dark, opaque pixels. The system tints this layer for themed icons."""
    a = np.asarray(fg).astype(np.float32)
    luminance = 0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]
    # Only near-black ink: the blue beanie (luminance ~70) would otherwise turn into grain.
    ink = np.clip((60.0 - luminance) / 20.0, 0.0, 1.0) * (a[..., 3] / 255.0)
    out = np.zeros(a.shape, dtype=np.uint8)
    out[..., 0:3] = 255
    out[..., 3] = (ink * 255).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def background(size_px):
    yy, xx = np.mgrid[0:size_px, 0:size_px].astype(np.float32)
    r = np.sqrt((xx - size_px * 0.45) ** 2 + (yy - size_px * 0.35) ** 2) / (size_px * 0.75)
    t = np.clip(r, 0, 1)[..., None]
    rgb = (np.array(INNER) * (1 - t) + np.array(OUTER) * t).astype(np.uint8)
    alpha = np.full((size_px, size_px, 1), 255, np.uint8)
    return Image.fromarray(np.concatenate([rgb, alpha], axis=2), "RGBA")


def legacy(source, size_px, round_icon):
    """The 72 dp visible part of the adaptive icon, shrunk into a 48 dp legacy icon with a 2 dp margin."""
    big = size_px * 4
    visible = big * 44 // 48  # the adaptive icon's 72 dp window, drawn 44 dp wide
    full = int(round(visible * 108 / 72))
    comp = background(full)
    comp.alpha_composite(foreground(source, full))
    inset = (full - visible) // 2
    crop = comp.crop((inset, inset, inset + visible, inset + visible))
    mask = Image.new("L", crop.size, 0)
    draw = ImageDraw.Draw(mask)
    if round_icon:
        draw.ellipse((0, 0, crop.size[0] - 1, crop.size[1] - 1), fill=255)
    else:
        draw.rounded_rectangle((0, 0, crop.size[0] - 1, crop.size[1] - 1), radius=crop.size[0] // 5, fill=255)
    icon = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    margin = (big - crop.size[0]) // 2
    icon.paste(crop, (margin, margin), mask)
    return icon.resize((size_px, size_px), Image.LANCZOS)


def main():
    source = art()
    for name, factor in DENSITIES.items():
        folder = RES / f"mipmap-{name}"
        folder.mkdir(parents=True, exist_ok=True)
        fg = foreground(source, int(round(108 * factor)))
        fg.save(folder / "ic_launcher_foreground.png", optimize=True)
        monochrome(fg).save(folder / "ic_launcher_monochrome.png", optimize=True)
        legacy(source, int(round(48 * factor)), False).save(folder / "ic_launcher.png", optimize=True)
        legacy(source, int(round(48 * factor)), True).save(folder / "ic_launcher_round.png", optimize=True)
        print(f"mipmap-{name}: done")
    caller(source).save(RES / "drawable-nodpi" / "chog_caller.png", optimize=True)
    print("drawable-nodpi/chog_caller.png: done")


def caller(source, size_px=256):
    """The caller photo on the incoming-call notification: the icon's visible face, square (Android crops it round)."""
    full = int(round(size_px * 108 / 72))
    comp = background(full)
    comp.alpha_composite(foreground(source, full))
    inset = (full - size_px) // 2
    (RES / "drawable-nodpi").mkdir(parents=True, exist_ok=True)
    return comp.crop((inset, inset, inset + size_px, inset + size_px))


if __name__ == "__main__":
    main()
