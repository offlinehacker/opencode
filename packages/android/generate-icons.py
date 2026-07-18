#!/usr/bin/env python3
"""Generate Android app icon PNGs for OpenCode.

Draws the OpenCode mark and resizes it into all 5 mipmap densities for:
  - ic_launcher_foreground.png (tinted icon on transparent bg, 108dp adaptive canvas)
  - ic_launcher.png (dark icon, standard launcher)
  - ic_launcher_round.png (dark icon, round launcher)

Also generates adaptive icon XML files under the Tauri Android project.
"""

from PIL import Image
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(
    SCRIPT_DIR,
    "src-tauri",
    "gen",
    "android",
    "app",
    "src",
    "main",
    "res",
)
SOURCE = os.path.join(SCRIPT_DIR, "..", "identity", "mark-512x512.png")
BACKGROUND = (19, 16, 16)

# Android adaptive icons: 108dp canvas, 72dp visible area, 66dp safe zone
FOREGROUND_SIZES = {
    "mdpi": 108,
    "hdpi": 162,
    "xhdpi": 216,
    "xxhdpi": 324,
    "xxxhdpi": 432,
}

# Standard icon sizes per density (48dp)
ICON_SIZES = {
    "mdpi": 48,
    "hdpi": 72,
    "xhdpi": 96,
    "xxhdpi": 144,
    "xxxhdpi": 192,
}

ADAPTIVE_ICON_XML = """\
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
  <background android:drawable="@color/ic_launcher_background"/>
</adaptive-icon>"""

IC_LAUNCHER_BACKGROUND_XML = """\
<?xml version="1.0" encoding="utf-8"?>
<resources>
  <color name="ic_launcher_background">#131010</color>
</resources>"""


def transparent_mark(image):
    image = image.copy()
    pixels = image.load()
    for y in range(image.height):
        for x in range(image.width):
            red, green, blue, _ = pixels[x, y]
            if (red, green, blue) == BACKGROUND:
                pixels[x, y] = (red, green, blue, 0)
    return image


def make_foreground(src_img, size):
    """Create adaptive icon foreground: place the icon art within the 108dp canvas.

    The visible area is 72/108 of the canvas. We resize the source to fit
    the visible area and paste it centered on a transparent canvas.
    """
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    visible = int(size * 72 / 108)
    resized = src_img.resize((visible, visible), Image.LANCZOS)
    offset = (size - visible) // 2
    canvas.paste(resized, (offset, offset), resized)
    return canvas


def generate_icons(res_dir, dark, tinted, label):
    """Generate all icon PNGs and XML files into a single res directory."""
    print(f"\n--- {label} ---")
    print(f"  Output: {res_dir}")

    for density, size in FOREGROUND_SIZES.items():
        out_dir = os.path.join(res_dir, f"mipmap-{density}")
        os.makedirs(out_dir, exist_ok=True)

        fg = make_foreground(tinted, size)
        fg.save(os.path.join(out_dir, "ic_launcher_foreground.png"))
        print(f"  mipmap-{density}/ic_launcher_foreground.png ({size}x{size})")

    for density, size in ICON_SIZES.items():
        out_dir = os.path.join(res_dir, f"mipmap-{density}")
        os.makedirs(out_dir, exist_ok=True)

        icon = dark.resize((size, size), Image.LANCZOS)
        icon.save(os.path.join(out_dir, "ic_launcher.png"))
        icon.save(os.path.join(out_dir, "ic_launcher_round.png"))
        print(
            f"  mipmap-{density}/ic_launcher.png + ic_launcher_round.png ({size}x{size})"
        )

    # Adaptive icon XML (API 26+)
    anydpi_dir = os.path.join(res_dir, "mipmap-anydpi-v26")
    os.makedirs(anydpi_dir, exist_ok=True)
    for name in ("ic_launcher.xml", "ic_launcher_round.xml"):
        with open(os.path.join(anydpi_dir, name), "w") as f:
            f.write(ADAPTIVE_ICON_XML)
        print(f"  mipmap-anydpi-v26/{name}")

    # Background color resource
    values_dir = os.path.join(res_dir, "values")
    os.makedirs(values_dir, exist_ok=True)
    with open(os.path.join(values_dir, "ic_launcher_background.xml"), "w") as f:
        f.write(IC_LAUNCHER_BACKGROUND_XML)
    print(f"  values/ic_launcher_background.xml")


def main():
    dark = Image.open(SOURCE).convert("RGBA")
    tinted = transparent_mark(dark)
    generate_icons(OUTPUT_DIR, dark, tinted, "Android Tauri project")
    print("\nDone! Android icons generated.")


if __name__ == "__main__":
    main()
