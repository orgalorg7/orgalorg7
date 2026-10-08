#!/usr/bin/env python3
"""Convert mypic.jpeg into a detailed, softly shaded ASCII portrait."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageOps


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_INPUT = ROOT / "mypic.jpeg"
DEFAULT_OUTPUT = ROOT / "assets" / "ascii-portrait.json"

# Small, tightly spaced glyphs preserve eyes, hair and smile at README scale.
COLUMNS = 132
ROWS = 96
RAMP = " .:-=+*#%@"
BACKGROUND = (16, 21, 29)


def subject_mask(size: tuple[int, int]) -> Image.Image:
    """Feather the subject's outline, excluding the wall and adjacent person.

    Coordinates are specific to the framing of the checked-in 223px portrait.
    Draw at higher resolution so the outline stays smooth after downsampling.
    """
    width, height = size
    supersample = 4
    points = [
        (37, 64), (39, 49), (47, 36), (62, 25), (83, 16),
        (109, 9), (135, 11), (153, 17), (165, 31), (169, 49),
        (169, 76), (166, 94), (171, 101), (169, 120),
        (163, 137), (155, 153), (154, 166), (166, 178),
        (188, 188), (222, 207), (223, 223), (0, 223),
        (0, 210), (22, 193), (51, 182), (59, 171),
        (55, 156), (47, 141), (44, 124), (40, 111),
        (40, 96), (39, 82),
    ]
    scaled = [
        (round(x * width * supersample / 223), round(y * height * supersample / 223))
        for x, y in points
    ]
    mask = Image.new("L", (width * supersample, height * supersample), 0)
    ImageDraw.Draw(mask).polygon(scaled, fill=255)
    return mask.resize(size, Image.Resampling.LANCZOS).filter(
        ImageFilter.GaussianBlur(width / 223 * 0.85)
    )


def convert(source_path: Path) -> dict[str, object]:
    source = ImageOps.exif_transpose(Image.open(source_path)).convert("RGB")
    # Remove JPEG noise before sampling; avoid sharpening that breaks up shading.
    sampled = source.filter(ImageFilter.GaussianBlur(0.45)).resize(
        (COLUMNS, ROWS), Image.Resampling.LANCZOS
    )
    mask = subject_mask(source.size).resize((COLUMNS, ROWS), Image.Resampling.LANCZOS)

    # Lift color gently to compensate for the empty space within each glyph.
    # A photographic palette retains subtle skin/hair tones instead of bands.
    lifted = sampled.point([round(255 * (value / 255) ** 0.6) for value in range(256)] * 3)
    shaded = Image.composite(lifted, Image.new("RGB", lifted.size, BACKGROUND), mask)
    indexed = shaded.quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    rgb_palette = indexed.getpalette()
    palette = [
        "#{:02x}{:02x}{:02x}".format(*rgb_palette[index:index + 3])
        for index in range(0, 128 * 3, 3)
    ]

    lines: list[dict[str, object]] = []
    for y in range(ROWS):
        chars: list[str] = []
        colors: list[int] = []
        for x in range(COLUMNS):
            red, green, blue = sampled.getpixel((x, y))
            alpha = mask.getpixel((x, y)) / 255
            luma = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255
            # Keep enough ink in the midtones to read as a continuous face.
            density = luma ** 0.38 * alpha
            ramp_index = min(len(RAMP) - 1, round(density * (len(RAMP) - 1)))
            chars.append(RAMP[ramp_index] if alpha > 0.04 else " ")
            colors.append(indexed.getpixel((x, y)))
        lines.append({"chars": "".join(chars), "colors": colors})

    return {"columns": COLUMNS, "rows": ROWS, "palette": palette, "lines": lines}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", nargs="?", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    if not args.input.exists():
        raise SystemExit(f"Portrait source not found: {args.input}")
    portrait = convert(args.input)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(portrait, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Wrote {portrait['columns']}x{portrait['rows']} ASCII portrait data to {args.output}")


if __name__ == "__main__":
    main()
