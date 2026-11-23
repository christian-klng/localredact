#!/usr/bin/env python3
"""Builds every icon LocalRedact needs from one drawing.

The drawing is source.svg, the "lock-keyhole" icon from Lucide (ISC licence,
see LICENSE-lucide.txt). render-source.js turns it into source.png; this script
draws that in white on a rounded square in the app's primary colour and writes:

  desktop/build/icon.icns        macOS (needs macOS's `iconutil`)
  desktop/build/icon.ico         Windows
  desktop/build/icons/NxN.png    Linux
  desktop/icon.png               window icon on Windows and Linux
  src/app/icon.png, apple-icon.png, favicon.ico and public/logo.png for the UI

Needs Pillow.  After changing source.svg run render-source.js first (see
there), then:  python3 desktop/icons/make-icons.py
"""
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
BUILD = HERE.parent / "build"

PRIMARY = (15, 23, 43, 255)  # --primary in src/app/globals.css: oklch(0.208 0.042 265.755)
MASTER = 1024
SCALE = 4  # shapes are drawn larger and scaled down for smooth edges


def glyph_mask() -> Image.Image:
    """The symbol as an alpha mask (255 where it is drawn), cropped to its bounds."""
    source = Image.open(HERE / "source.png").convert("RGBA")
    red, green, blue, alpha = source.split()
    darkness = ImageChops.invert(Image.merge("RGB", (red, green, blue)).convert("L"))
    mask = ImageChops.multiply(darkness, alpha)
    return mask.crop(mask.getbbox())


def render(size: int, square: float, radius: float, glyph: float, thicken: int = 0) -> Image.Image:
    """One icon. `square` is the rounded square's share of the canvas, `radius`
    its corner radius as a share of the square, `glyph` the symbol's height as a
    share of the square. `thicken` widens the lines, for sizes at which they
    would otherwise fade away."""
    canvas = Image.new("RGBA", (MASTER, MASTER), (0, 0, 0, 0))

    side = round(MASTER * square)
    big = Image.new("L", (side * SCALE, side * SCALE), 0)
    ImageDraw.Draw(big).rounded_rectangle((0, 0, side * SCALE - 1, side * SCALE - 1), radius=round(side * SCALE * radius), fill=255)
    plate = big.resize((side, side), Image.LANCZOS)
    offset = (MASTER - side) // 2
    canvas.paste(Image.new("RGBA", (side, side), PRIMARY), (offset, offset), plate)

    mask = glyph_mask()
    height = round(side * glyph)
    width = round(mask.width * height / mask.height)
    mask = mask.resize((width, height), Image.LANCZOS)
    if thicken:
        mask = mask.filter(ImageFilter.MaxFilter(thicken * 2 + 1))
    canvas.paste(Image.new("RGBA", mask.size, (255, 255, 255, 255)), ((MASTER - mask.width) // 2, (MASTER - mask.height) // 2), mask)

    return canvas if size == MASTER else canvas.resize((size, size), Image.LANCZOS)


def mac(size: int) -> Image.Image:
    # Apple's icon grid: the shape sits inside a transparent margin.
    return render(size, square=824 / 1024, radius=0.2237, glyph=0.60, thicken=2 if size <= 32 else 0)


def plain(size: int) -> Image.Image:
    # Windows and Linux draw the icon edge to edge.
    return render(size, square=0.94, radius=0.20, glyph=0.62 if size > 48 else 0.68, thicken=3 if size <= 48 else 0)


def main() -> None:
    BUILD.mkdir(exist_ok=True)

    # macOS
    iconset = BUILD / "icon.iconset"
    shutil.rmtree(iconset, ignore_errors=True)
    iconset.mkdir()
    for points in (16, 32, 128, 256, 512):
        mac(points).save(iconset / f"icon_{points}x{points}.png")
        mac(points * 2).save(iconset / f"icon_{points}x{points}@2x.png")
    if shutil.which("iconutil"):
        subprocess.run(["iconutil", "-c", "icns", str(iconset), "-o", str(BUILD / "icon.icns")], check=True)
    else:
        print("iconutil not found: icon.icns was not rebuilt (run this on macOS)", file=sys.stderr)
    shutil.rmtree(iconset)

    # Windows
    sizes = [16, 24, 32, 48, 64, 128, 256]
    images = [plain(size) for size in sizes]
    images[-1].save(BUILD / "icon.ico", format="ICO", sizes=[(s, s) for s in sizes], append_images=images[:-1])

    # Linux
    icons = BUILD / "icons"
    shutil.rmtree(icons, ignore_errors=True)
    icons.mkdir()
    for size in (16, 24, 32, 48, 64, 128, 256, 512, 1024):
        plain(size).save(icons / f"{size}x{size}.png")

    # The UI: browser tab, pinned icon, and the logo in the header.
    app = ROOT / "src" / "app"
    plain(256).save(app / "icon.png")
    plain(180).save(app / "apple-icon.png")
    favicon = [plain(size) for size in (16, 32, 48)]
    favicon[-1].save(app / "favicon.ico", format="ICO", sizes=[(16, 16), (32, 32), (48, 48)], append_images=favicon[:-1])
    (ROOT / "public").mkdir(exist_ok=True)
    plain(128).save(ROOT / "public" / "logo.png")
    # Shown by the window itself on Windows and Linux.
    plain(256).save(HERE.parent / "icon.png")

    print(f"Icons written to {BUILD} and {app}")


if __name__ == "__main__":
    main()
