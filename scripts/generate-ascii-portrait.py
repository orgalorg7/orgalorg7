#!/usr/bin/env python3
"""Convert mypic.jpeg into compact, palette-aware ASCII portrait data."""

from __future__ import annotations

import argparse
import colorsys
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageOps


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_INPUT = ROOT / "mypic.jpeg"
DEFAULT_OUTPUT = ROOT / "assets" / "ascii-portrait.json"

COLUMNS = 52
ROWS = 30
RAMP = ".:-=+*#%@"

PALETTE = [
    "#30363d",
    "#484f58",
    "#6e7681",
    "#8b949e",
    "#c9d1d9",
    "#9a624d",
    "#d28b68",
    "#f0b08a",
    "#58a6ff",
    "#79c0ff",
]


def subject_mask(size: tuple[int, int]) -> Image.Image:
    """Return a soft hand-tuned silhouette mask for the supplied portrait framing."""
    width, height = size
    scale_x = width / 223
    scale_y = height / 223
    points = [
        (37, 35), (42, 19), (66, 8), (96, 4), (130, 8),
        (160, 22), (177, 46), (183, 78), (179, 118),
        (169, 148), (159, 164), (191, 178), (222, 201),
        (222, 223), (0, 223), (0, 202), (33, 181), (58, 165),
        (46, 145), (37, 116), (34, 78),
    ]
    scaled = [(round(x * scale_x), round(y * scale_y)) for x, y in points]
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).polygon(scaled, fill=255)
    return mask.filter(ImageFilter.GaussianBlur(max(0.8, width / 260)))


def palette_index(red: int, green: int, blue: int, luma: float) -> int:
    hue, saturation, _ = colorsys.rgb_to_hsv(red / 255, green / 255, blue / 255)
    warm = (
        0.0 <= hue <= 0.115
        and saturation >= 0.18
        and red > green * 1.06
        and red > blue * 1.10
        and luma > 95
    )
    cool = blue > red * 1.04 and blue > green * 1.02

    if warm:
        if luma >= 175:
            return 7
        if luma >= 112:
            return 6
        return 5
    if cool:
        return 9 if luma >= 155 else 8
    if luma >= 190:
        return 4
    if luma >= 125:
        return 3
    if luma >= 72:
        return 2
    return 1


def convert(source_path: Path) -> dict[str, object]:
    source = ImageOps.exif_transpose(Image.open(source_path)).convert("RGB")
    mask = subject_mask(source.size)

    rgba = source.convert("RGBA")
    rgba.putalpha(mask)
    rgba = rgba.resize((COLUMNS, ROWS), Image.Resampling.LANCZOS)

    lines: list[dict[str, str]] = []
    for y in range(ROWS):
        chars: list[str] = []
        colors: list[str] = []
        for x in range(COLUMNS):
            red, green, blue, alpha = rgba.getpixel((x, y))
            if alpha < 42:
                chars.append(" ")
                colors.append("0")
                continue

            luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue
            lifted = (luma / 255) ** 0.82
            ramp_index = max(0, min(len(RAMP) - 1, round(lifted * (len(RAMP) - 1))))
            char = RAMP[ramp_index]
            if alpha < 138:
                char = "." if luma < 150 else ":"

            chars.append(char)
            colors.append(str(palette_index(red, green, blue, luma)))

        lines.append({"chars": "".join(chars), "colors": "".join(colors)})

    return {
        "columns": COLUMNS,
        "rows": ROWS,
        "palette": PALETTE,
        "lines": lines,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", nargs="?", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    if not args.input.exists():
        raise SystemExit(f"Portrait source not found: {args.input}")

    portrait = convert(args.input)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(portrait, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {portrait['columns']}x{portrait['rows']} ASCII portrait data to {args.output}")


if __name__ == "__main__":
    main()
