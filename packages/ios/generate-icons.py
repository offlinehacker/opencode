#!/usr/bin/env python3
"""Generate 1024x1024 app icon PNGs for WhisperCode.

Draws the pixel-art "W" mark at 2x scale (512→1024) using Pillow.
No SVG rasterizer needed — all shapes are axis-aligned rectangles.
"""

from PIL import Image, ImageDraw

SCALE = 2  # 512 → 1024

# W letter rectangles at 512×512 coordinates: (x1, y1, x2, y2)
W_RECTS = [
    (128, 96, 160, 320),   # Left outer leg
    (352, 96, 384, 320),   # Right outer leg
    (224, 224, 288, 288),  # Center peak
    (192, 256, 224, 288),  # Left upper diag
    (288, 256, 320, 288),  # Right upper diag
    (160, 288, 192, 352),  # Left lower diag
    (320, 288, 352, 352),  # Right lower diag
    (192, 320, 224, 416),  # Left foot
    (288, 320, 320, 416),  # Right foot
]

# Shadow rectangle (below center peak, between diagonals)
SHADOW_RECT = (224, 288, 288, 352)


def scaled(rect):
    """Scale a rect tuple by SCALE factor."""
    return tuple(v * SCALE for v in rect)


def draw_icon(bg_color, letter_color, shadow_color, transparent_bg=False):
    """Draw the W icon and return a PIL Image."""
    size = 512 * SCALE
    if transparent_bg:
        img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    else:
        img = Image.new("RGBA", (size, size), bg_color)
    draw = ImageDraw.Draw(img)

    # Draw shadow first (behind the letter)
    if shadow_color:
        x1, y1, x2, y2 = scaled(SHADOW_RECT)
        draw.rectangle([x1, y1, x2 - 1, y2 - 1], fill=shadow_color)

    # Draw letter rectangles
    for rect in W_RECTS:
        x1, y1, x2, y2 = scaled(rect)
        draw.rectangle([x1, y1, x2 - 1, y2 - 1], fill=letter_color)

    return img


def main():
    import os

    out_dir = os.path.join(
        os.path.dirname(__file__),
        "WhisperCode", "WhisperCode", "Assets.xcassets",
        "AppIcon.appiconset",
    )
    os.makedirs(out_dir, exist_ok=True)

    # Light appearance (default): light bg, dark letter
    light = draw_icon(
        bg_color="#FDFCFC",
        letter_color="#17181C",
        shadow_color="#E6E5E6",
    )
    light.save(os.path.join(out_dir, "AppIcon-light.png"))
    print(f"Saved AppIcon-light.png ({light.size[0]}x{light.size[1]})")

    # Dark appearance: dark bg, white letter
    dark = draw_icon(
        bg_color="#131010",
        letter_color="#FFFFFF",
        shadow_color="#5A5858",
    )
    dark.save(os.path.join(out_dir, "AppIcon-dark.png"))
    print(f"Saved AppIcon-dark.png ({dark.size[0]}x{dark.size[1]})")

    # Tinted appearance: transparent bg, white letter silhouette
    tinted = draw_icon(
        bg_color=None,
        letter_color="#FFFFFF",
        shadow_color=None,
        transparent_bg=True,
    )
    tinted.save(os.path.join(out_dir, "AppIcon-tinted.png"))
    print(f"Saved AppIcon-tinted.png ({tinted.size[0]}x{tinted.size[1]})")


if __name__ == "__main__":
    main()
