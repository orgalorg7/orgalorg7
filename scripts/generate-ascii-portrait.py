#!/usr/bin/env python3
"""Convert mypic.jpeg into a detailed, softly shaded ASCII portrait."""

from __future__ import annotations

import argparse
import base64
import io
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_INPUT = ROOT / "mypic.jpeg"
DEFAULT_OUTPUT = ROOT / "assets" / "ascii-portrait.json"
FONT_PATH = Path("/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf")

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
# The portrait ships as one pre-rendered image: 6x8.25px cells, 3x the desktop
# card's 2x2.75px cells, so it stays sharp on high-density screens.
CELL = (6, 8.25)
# Drawn at this multiple, then downsampled, for smoothly anti-aliased glyphs.
SUPERSAMPLE = 2
# Opacity of the soft color layer that fills the gaps between glyphs like phosphor glow.
GLOW = 0.5


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
        (163, 137), (155, 153), (154, 166), (157, 178),
        (171, 187), (191, 196), (223, 211), (223, 223), (0, 223),
        (0, 213), (22, 198), (42, 193), (60, 187), (59, 171),
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


def wall_mask(source: Image.Image, outline: Image.Image) -> np.ndarray:
    """The orange wall showing inside the outline, as a 0..1 mask to recolor.

    Skin can match the wall's color, so only wall-colored pixels connected to
    the wall outside the outline count; they are recolored, never cut out.
    """
    hsv = np.asarray(source.convert("HSV"), dtype=np.float64) / 255
    hue, saturation, value = hsv[..., 0] * 360, hsv[..., 1], hsv[..., 2]
    candidate = ((hue < 28) | (hue > 345)) & (saturation > 0.5) & (value > 0.72)
    inside = np.asarray(outline, dtype=np.float64) > 127
    # Only a thin band along the outline is eligible, so the search never reaches the face.
    candidate &= ~(np.asarray(outline.filter(ImageFilter.MinFilter(9)), dtype=np.float64) > 127)

    def grow(mask: np.ndarray, size: int = 3) -> np.ndarray:
        return np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(size))) > 0

    # Flood from outside the outline through wall-colored pixels only.
    reached = candidate & ~inside
    while True:
        grown = grow(reached) & candidate
        if (grown == reached).all():
            break
        reached = grown
    # Grow to catch the darker anti-aliased fringe where wall meets hair and jacket.
    return grow(reached, 3).astype(np.float64)


def gaussian(values: np.ndarray, sigma: float) -> np.ndarray:
    """Separable Gaussian blur over the first two axes, with edge padding."""
    reach = int(np.ceil(sigma * 3))
    offsets = np.arange(-reach, reach + 1)
    kernel = np.exp(-(offsets ** 2) / (2 * sigma ** 2))
    kernel /= kernel.sum()
    pad = [(reach, reach), (reach, reach)] + [(0, 0)] * (values.ndim - 2)
    padded = np.pad(values, pad, mode="edge")
    height, width = values.shape[:2]
    rows = sum(k * padded[:, reach + o:reach + o + width] for k, o in zip(kernel, offsets))
    return sum(k * rows[reach + o:reach + o + height] for k, o in zip(kernel, offsets))


def fill_from_subject(source: Image.Image, keep: Image.Image) -> Image.Image:
    """Recolor everything outside `keep` with nearby subject colors.

    Wall pixels inside the outline take on the neighbouring hair, skin or jacket
    color, so no orange survives while the silhouette itself stays intact.
    """
    color = np.asarray(source, dtype=np.float64)
    weight = np.asarray(keep, dtype=np.float64) / 255
    filled = color.copy()
    done = weight > 0.5
    # Smallest neighbourhood that contains enough subject wins: nearest colors first.
    for sigma in (1, 2, 4, 8, 16, 32):
        coverage = gaussian(weight, sigma)
        estimate = gaussian(color * weight[..., None], sigma) / np.maximum(coverage, 1e-6)[..., None]
        take = ~done & (coverage > 0.08)
        filled[take] = estimate[take]
        done |= take
    out = color * weight[..., None] + filled * (1 - weight[..., None])
    return Image.fromarray(out.round().clip(0, 255).astype(np.uint8), mode="RGB")


def raster_size() -> tuple[int, int]:
    """Pixel size of the supersampled portrait image."""
    return round(COLUMNS * CELL[0] * SUPERSAMPLE), round(ROWS * CELL[1] * SUPERSAMPLE)


def sample_photo(source_path: Path) -> tuple[np.ndarray, np.ndarray, tuple[np.ndarray, np.ndarray]]:
    source = ImageOps.exif_transpose(Image.open(source_path)).convert("RGB")
    outline_image = subject_mask(source.size)
    wall = wall_mask(source, outline_image)
    outline = np.asarray(outline_image, dtype=np.float64) / 255
    keep = Image.fromarray((outline * (1 - wall) * 255).round().astype(np.uint8))
    source = fill_from_subject(source, keep)
    graded = ImageOps.autocontrast(source.filter(ImageFilter.GaussianBlur(0.3)), cutoff=(1, 0.5))
    # Light denoise, then sharpen after downsampling so eyes, brows and beard stay crisp.
    sampled = graded.resize((COLUMNS, ROWS), Image.Resampling.LANCZOS).filter(
        ImageFilter.UnsharpMask(radius=1.2, percent=70, threshold=2)
    )
    # The silhouette stays the smooth hand-drawn outline; the wall is only recolored, never cut out.
    mask = outline_image.resize((COLUMNS, ROWS), Image.Resampling.LANCZOS)
    # Full-resolution color and outline let glyph colors flow smoothly instead of in cell blocks.
    detail = (
        np.asarray(
            graded.resize(raster_size(), Image.Resampling.LANCZOS).filter(
                ImageFilter.UnsharpMask(radius=8, percent=80, threshold=1)
            ),
            dtype=np.float64,
        ),
        np.asarray(outline_image.resize(raster_size(), Image.Resampling.LANCZOS), dtype=np.float64) / 255,
    )
    return np.asarray(sampled, dtype=np.float64), np.asarray(mask, dtype=np.float64) / 255, detail


def sample_portrait_json(source_path: Path) -> tuple[np.ndarray, np.ndarray, None]:
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
    return sampled, np.asarray(mask, dtype=np.float64) / 255, None


def display_color(rgb: np.ndarray, rim: np.ndarray) -> np.ndarray:
    """Lift and warm photo colors for display, muting them toward grey along the rim."""
    # Lift color gently to compensate for the empty space within each glyph.
    lifted = 255 * (np.clip(rgb, 0, 255) / 255) ** DISPLAY_LIFT
    # Thin glyphs mix with the dark screen and read greyer than the photo; restore warmth.
    lifted = np.asarray(
        ImageEnhance.Color(Image.fromarray(lifted.round().astype(np.uint8), mode="RGB")).enhance(1.25),
        dtype=np.float64,
    )
    grey = lifted @ np.array([0.2126, 0.7152, 0.0722])
    muted = rim[..., None] * 0.7
    return lifted * (1 - muted) + grey[..., None] * muted


def convert(
    sampled: np.ndarray, alpha: np.ndarray, detail: tuple[np.ndarray, np.ndarray] | None = None
) -> dict[str, object]:
    luma = (sampled @ np.array([0.2126, 0.7152, 0.0722])) / 255
    # Keep enough ink in the midtones to read as a continuous face.
    density = np.clip(luma, 0, 1) ** 0.55 * alpha

    # The outermost cells still pick up a reddish rim from the wall; their color is muted.
    core = np.asarray(
        Image.fromarray((alpha > 0.5).astype(np.uint8) * 255).filter(ImageFilter.MinFilter(5))
    ) > 0
    rim = ((alpha > 0.04) & ~core).astype(np.float64)
    lifted = display_color(sampled, rim)
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
        "image": render_image(lines, *(detail or upsampled(sampled, alpha)), rim),
    }


def upsampled(sampled: np.ndarray, alpha: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Stand-in for full-resolution detail when only grid-sized data is available."""
    color = Image.fromarray(sampled.round().clip(0, 255).astype(np.uint8), mode="RGB")
    mask = Image.fromarray((alpha * 255).round().astype(np.uint8))
    return (
        np.asarray(color.resize(raster_size(), Image.Resampling.BICUBIC), dtype=np.float64),
        np.asarray(mask.resize(raster_size(), Image.Resampling.BICUBIC), dtype=np.float64) / 255,
    )


def render_image(
    lines: list[dict[str, object]], color: np.ndarray, alpha: np.ndarray, rim: np.ndarray
) -> str:
    """Pre-render the glyphs over a soft color glow as one transparent WebP.

    Glyphs take their color per pixel from the full-resolution photo rather than
    one flat color per cell, so tones flow smoothly instead of looking pixelated.
    Browsers repaint an animated SVG in full every frame; one bitmap costs a
    fraction of thousands of colored text runs, so the card animates smoothly.
    """
    size = raster_size()
    cell_w, cell_h = CELL[0] * SUPERSAMPLE, CELL[1] * SUPERSAMPLE
    rim_full = np.asarray(
        Image.fromarray((rim * 255).astype(np.uint8)).resize(size, Image.Resampling.BILINEAR),
        dtype=np.float64,
    ) / 255
    tint = display_color(color, rim_full)
    ink = Image.new("L", size, 0)
    draw = ImageDraw.Draw(ink)
    font = ImageFont.truetype(str(FONT_PATH), round(cell_w / 0.6))
    for y, line in enumerate(lines):
        baseline = y * cell_h + cell_w / 0.6 * 0.8
        for x, char in enumerate(line["chars"]):
            if char != " ":
                draw.text((x * cell_w, baseline), char, font=font, fill=255, anchor="ls")
    glyph_alpha = np.asarray(ink, dtype=np.float64) / 255
    # Glyphs fully opaque; between them, a faint glow of the same colors fills the gaps.
    coverage = glyph_alpha + (1 - glyph_alpha) * alpha * GLOW
    rgba = np.dstack([tint, coverage * 255]).round().clip(0, 255).astype(np.uint8)
    canvas = Image.fromarray(rgba, mode="RGBA").resize(
        (round(size[0] / SUPERSAMPLE), round(size[1] / SUPERSAMPLE)), Image.Resampling.LANCZOS
    )
    buffer = io.BytesIO()
    canvas.save(buffer, format="WEBP", quality=90, method=6)
    return "data:image/webp;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


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
