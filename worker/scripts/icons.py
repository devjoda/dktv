# Draws DKTV's icons from Schibsted Grotesk, the site's own font: "DK" over "TV", warm white on ink.
# The favicon in drtvrss/templates, as .ico and .svg, and the app's icons in drtvrss/static/icons.
# Only needed when the icons change; run from the repository's root with
#   uv run --no-project --with fonttools --with brotli --with pillow python worker/scripts/icons.py
import io
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
STATIC = ROOT / "drtvrss" / "static"
TEMPLATES = ROOT / "drtvrss" / "templates"
INK = "#0f1013"
PAPER = "#f2efe9"
WEIGHT = 850
ROWS = ["DK", "TV"]

font = instantiateVariableFont(TTFont(STATIC / "vendor" / "schibsted-grotesk-5.3.0-latin.woff2"), {"wght": WEIGHT})
font.flavor = None
glyphs = font.getGlyphSet()
cmap = font.getBestCmap()
units = font["head"].unitsPerEm
cap = font["OS/2"].sCapHeight
# As tight as the logo in the header
TRACKING = -0.02 * units


def row_outline(text):
    """A row of letters, as (glyph name, x) pairs, and its width in font units"""
    placed, x = [], 0
    for i, char in enumerate(text):
        name = cmap[ord(char)]
        placed.append((name, x))
        x += glyphs[name].width + (TRACKING if i < len(text) - 1 else 0)
    # Without the last letter's side bearing, so the row is centred on its ink
    bounds = BoundsPen(glyphs)
    for name, gx in placed:
        glyphs[name].draw(TransformPen(bounds, (1, 0, 0, 1, gx, 0)))
    left, _, right, _ = bounds.bounds
    return placed, left, right


def mark_svg(size, scale, background=True, radius=0.0):
    """The letters on a square of `size`, the rows' cap height being `scale` of it"""
    s = size * scale / cap
    gap = cap * 0.28
    block = 2 * cap + gap
    top = (size - block * s) / 2
    paths = []
    for r, text in enumerate(ROWS):
        placed, left, right = row_outline(text)
        x0 = (size - (right - left) * s) / 2 - left * s
        baseline = top + (cap + r * (cap + gap)) * s
        pen = SVGPathPen(glyphs)
        for name, gx in placed:
            # Font units go up, the SVG's down
            glyphs[name].draw(TransformPen(pen, (s, 0, 0, -s, x0 + gx * s, baseline)))
        paths.append(pen.getCommands())
    fill = f'<rect width="{size}" height="{size}" rx="{size * radius:g}" fill="{INK}"/>' if background else ""
    colour = PAPER if background else "#fff"
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}">{fill}'
            f'<path fill="{colour}" d="{" ".join(paths)}"/></svg>\n')


def mark_png(size, scale, background=True, radius=0.0):
    """The same, drawn by Pillow from the font at this weight"""
    buffer = io.BytesIO()
    font.save(buffer)
    big = size * 4
    image = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    if background:
        draw.rounded_rectangle((0, 0, big - 1, big - 1), radius=big * radius, fill=INK)
    px = big * scale / cap * units
    face = ImageFont.truetype(io.BytesIO(buffer.getvalue()), round(px))
    s = big * scale / cap
    gap = cap * 0.28
    top = (big - (2 * cap + gap) * s) / 2
    for r, text in enumerate(ROWS):
        placed, left, right = row_outline(text)
        x0 = (big - (right - left) * s) / 2 - left * s
        baseline = top + (cap + r * (cap + gap)) * s
        for name, gx in placed:
            char = next(chr(c) for c, n in cmap.items() if n == name)
            draw.text((x0 + gx * s, baseline), char, font=face, fill=PAPER if background else "#fff", anchor="ls")
    return image.resize((size, size), Image.LANCZOS)


(TEMPLATES / "favicon.svg").write_text(mark_svg(64, 0.3, radius=0.18))
# Larger letters at the smallest sizes, to be read in a browser's tab
small = [mark_png(n, 0.34, radius=0.18) for n in (16, 32, 48)]
small[-1].save(TEMPLATES / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)], append_images=small[:-1])
# Full squares, which the systems round as they like; the letters within the middle, for maskable icons
mark_png(192, 0.22).save(STATIC / "icons" / "icon-192.png", optimize=True)
mark_png(512, 0.22).save(STATIC / "icons" / "icon-512.png", optimize=True)
mark_png(180, 0.24).save(STATIC / "icons" / "apple-touch-icon.png", optimize=True)
# For notifications, which only use its shape
mark_png(96, 0.32, background=False).save(STATIC / "icons" / "badge-96.png", optimize=True)
print("Drew the icons")
