#!/usr/bin/env python3
"""Convert mypic.jpeg into a detailed, softly shaded ASCII portrait."""

from __future__ import annotations

import argparse
import base64
import io
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageOps


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_INPUT = ROOT / "mypic.jpeg"
DEFAULT_OUTPUT = ROOT / "assets" / "ascii-portrait.json"

# Small, tightly spaced glyphs preserve eyes, hair and smile at README scale.
COLUMNS = 198
ROWS = 144
# Glyphs paired with their measured ink coverage in Liberation Mono Bold.
# Many small steps keep gradients across skin and hair smooth instead of
# banding into blocks; mostly symbols so the face doesn't read as text.
RAMP = (
    (" ", 0.00), (".", 0.08), ("-", 0.13), (":", 0.17), ("~", 0.21), (";", 0.23),
    ("!", 0.30), ("+", 0.39), ("=", 0.43), ("x", 0.55), ("#", 0.61), ("o", 0.66),
    ("%", 0.69), ("&", 0.82), ("@", 0.83),
)
# Coverage used for full brightness; leaves headroom so features keep contrast.
MAX_COVERAGE = 0.84
BACKGROUND = (16, 21, 29)
# Lift applied by earlier versions of this script; undone when re-rendering .json data.
GAMMA_LIFT = 0.6
# Stronger lift for output, since the portrait renders without a glow filter.
DISPLAY_LIFT = 0.62


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


def sample_photo(source_path: Path) -> tuple[np.ndarray, np.ndarray]:
    source = ImageOps.exif_transpose(Image.open(source_path)).convert("RGB")
    # Remove JPEG noise before sampling; avoid sharpening that breaks up shading.
    # Light denoise, then sharpen after downsampling so eyes, brows and beard stay crisp.
    sampled = ImageOps.autocontrast(
        source.filter(ImageFilter.GaussianBlur(0.3)), cutoff=(1, 0.5)
    ).resize((COLUMNS, ROWS), Image.Resampling.LANCZOS).filter(
        ImageFilter.UnsharpMask(radius=1.2, percent=70, threshold=2)
    )
    mask = subject_mask(source.size).resize((COLUMNS, ROWS), Image.Resampling.LANCZOS)
    return np.asarray(sampled, dtype=np.float64), np.asarray(mask, dtype=np.float64) / 255


def sample_portrait_json(source_path: Path) -> tuple[np.ndarray, np.ndarray]:
    """Recover tone and mask from coarser portrait data, upsampled to COLUMNS x ROWS."""
    portrait = json.loads(source_path.read_text(encoding="utf-8"))
    palette = np.array([[int(h[i:i + 2], 16) for i in (1, 3, 5)] for h in portrait["palette"]])
    lifted = np.stack([palette[line["colors"]] for line in portrait["lines"]]).astype(np.uint8)
    inked = np.array([[ch != " " for ch in line["chars"]] for line in portrait["lines"]], dtype=np.uint8)
    size = (COLUMNS, ROWS)
    color = Image.fromarray(lifted, mode="RGB").resize(size, Image.Resampling.BICUBIC)
    mask = Image.fromarray(inked * 255).resize(size, Image.Resampling.BICUBIC)
    # Undo the gamma lift so the data matches what sample_photo would produce.
    sampled = 255 * (np.asarray(color, dtype=np.float64) / 255) ** (1 / GAMMA_LIFT)
    return sampled, np.asarray(mask, dtype=np.float64) / 255


def trim_backdrop(sampled: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """Drop the warm orange wall that shows above the jacket on both shoulders.

    The jacket is grey, so any warm cell beside the neck below the chin is backdrop.
    Bounds are fractions of the grid, matching the checked-in portrait's framing.
    """
    rows, columns = alpha.shape
    y, x = np.mgrid[0:rows, 0:columns]
    shoulders = (y >= rows * 0.73) & ((x <= columns * 0.255) | (x >= columns * 0.715))
    red, blue = sampled[..., 0], sampled[..., 2]
    warm = red - blue > 18
    return np.where(shoulders & warm, 0.0, alpha)


def convert(sampled: np.ndarray, alpha: np.ndarray) -> dict[str, object]:
    alpha = trim_backdrop(sampled, alpha)
    luma = (sampled @ np.array([0.2126, 0.7152, 0.0722])) / 255
    # Keep enough ink in the midtones to read as a continuous face.
    density = np.clip(luma, 0, 1) ** 0.55 * alpha

    # Lift color gently to compensate for the empty space within each glyph.
    # A photographic palette retains subtle skin/hair tones instead of bands.
    lifted = 255 * (np.clip(sampled, 0, 255) / 255) ** DISPLAY_LIFT
    # Thin glyphs mix with the dark screen and read greyer than the photo; restore warmth.
    lifted = np.asarray(
        ImageEnhance.Color(Image.fromarray(lifted.round().astype(np.uint8), mode="RGB")).enhance(1.25),
        dtype=np.float64,
    )
    shaded = lifted * alpha[..., None] + np.array(BACKGROUND) * (1 - alpha[..., None])
    image = Image.fromarray(np.round(shaded).astype(np.uint8), mode="RGB")
    indexed = image.quantize(colors=64, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    rgb_palette = indexed.getpalette()
    palette = [
        "#{:02x}{:02x}{:02x}".format(*rgb_palette[index:index + 3])
        for index in range(0, 64 * 3, 3)
    ]

    lines: list[dict[str, object]] = []
    for y in range(ROWS):
        chars: list[str] = []
        colors: list[int] = []
        for x in range(COLUMNS):
            target = density[y, x] * MAX_COVERAGE
            glyph = min(RAMP, key=lambda entry: abs(entry[1] - target))[0]
            chars.append(glyph if alpha[y, x] > 0.04 else " ")
            colors.append(indexed.getpixel((x, y)))
        lines.append({"chars": "".join(chars), "colors": colors})

    return {
        "columns": COLUMNS,
        "rows": ROWS,
        "palette": palette,
        "lines": lines,
        "underlay": underlay(lifted, alpha),
    }


def underlay(lifted: np.ndarray, alpha: np.ndarray) -> str:
    """A tiny, soft color image drawn beneath the glyphs.

    It fills the gaps between characters the way a CRT phosphor glow would,
    at the cost of one bitmap draw rather than a live blur filter.
    """
    rgba = np.dstack([lifted, alpha * 255]).round().astype(np.uint8)
    image = Image.fromarray(rgba, mode="RGBA")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", nargs="?", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    if not args.input.exists():
        raise SystemExit(f"Portrait source not found: {args.input}")
    # A .json input re-renders existing portrait data when the photo is unavailable.
    sample = sample_portrait_json if args.input.suffix == ".json" else sample_photo
    portrait = convert(*sample(args.input))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(portrait, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Wrote {portrait['columns']}x{portrait['rows']} ASCII portrait data to {args.output}")


if __name__ == "__main__":
    main()
