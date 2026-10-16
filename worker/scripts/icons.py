# Draws Flimmerkassen's icons from Schibsted Grotesk, the site's own font: a dotless i with a box, the kassen, for its dot,
# on ink, like the i in the header's logo, a little bolder, to be seen when small.
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

source = STATIC / "vendor" / "schibsted-grotesk-5.3.0-latin.woff2"


class Word:
    """A word's outline at a weight, with its letters as close as the logo's"""

    def __init__(self, text, weight, tracking):
        """`tracking` in ems, like the logo's letter-spacing"""
        self.font, self.text = instantiateVariableFont(TTFont(source), {"wght": weight}), text
        self.font.flavor = None
        self.glyphs, cmap = self.font.getGlyphSet(), self.font.getBestCmap()
        self.cap, self.units = self.font["OS/2"].sCapHeight, self.font["head"].unitsPerEm
        units = self.units
        self.placed, x = [], 0
        for i, char in enumerate(text):
            name = cmap[ord(char)]
            self.placed.append((name, x))
            x += self.glyphs[name].width + (tracking * units if i < len(text) - 1 else 0)
        self.left = 0
        bounds = BoundsPen(self.glyphs)
        self.draw(bounds, 1, 0, 0)
        self.left, _, self.right, _ = bounds.bounds
        self.width = self.right - self.left

    def draw(self, pen, scale, x, baseline):
        """Onto a pen whose y goes down, with the ink's left edge at x"""
        for name, gx in self.placed:
            self.glyphs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, x + (gx - self.left) * scale, baseline)))


I = Word("\u0131", 850, 0)
# The box, in ems: its side, its border, and how high its bottom is, over the i's stem like a dot
BOX, BORDER, BOX_BOTTOM = 0.275, 0.075, 0.6


def layout(size, height):
    """Where the i and its box go on a square of `size`, the two being `height` of it: the i's scale, left and baseline,
    and the box's edges and border"""
    em = size * height / (BOX_BOTTOM + BOX)
    s = em / I.units
    top = (size - size * height) / 2
    baseline = top + size * height
    box = (size / 2 - BOX * em / 2, top, size / 2 + BOX * em / 2, top + BOX * em)
    return s, size / 2 - I.width * s / 2, baseline, box, BORDER * em


def mark_svg(size, height, radius):
    s, x, baseline, box, border = layout(size, height)
    stem = SVGPathPen(None)
    I.draw(stem, s, x, baseline)
    left, top, right, bottom = (box[0] + border / 2, box[1] + border / 2, box[2] - border / 2, box[3] - border / 2)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}">'
            f'<rect width="{size}" height="{size}" rx="{size * radius:g}" fill="{INK}"/>'
            f'<path fill="{PAPER}" d="{stem.getCommands()}"/>'
            f'<rect x="{left:.2f}" y="{top:.2f}" width="{right - left:.2f}" height="{bottom - top:.2f}" rx="{border * 0.4:.2f}" '
            f'fill="none" stroke="{PAPER}" stroke-width="{border:.2f}"/></svg>\n')


def face(word, scale):
    """Pillow's font at the word's weight, as large as `scale` makes it"""
    buffer = io.BytesIO()
    word.font.save(buffer)
    return ImageFont.truetype(io.BytesIO(buffer.getvalue()), round(word.units * scale))


def text(draw, word, scale, x, baseline, colour):
    """The word's letters where its outline has them"""
    font = face(word, scale)
    for (name, gx), char in zip(word.placed, word.text):
        draw.text((x + (gx - word.left) * scale, baseline), char, font=font, fill=colour, anchor="ls")


def mark_png(size, height, radius=0.0, background=True):
    big = size * 4
    image = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    if background:
        draw.rounded_rectangle((0, 0, big - 1, big - 1), radius=big * radius, fill=INK)
    s, x, baseline, box, border = layout(big, height)
    colour = PAPER if background else "#ffffff"
    text(draw, I, s, x, baseline, colour)
    draw.rounded_rectangle(box, radius=border * 0.8, outline=colour, width=round(border))
    return image.resize((size, size), Image.LANCZOS)


(TEMPLATES / "favicon.svg").write_text(mark_svg(64, 0.74, radius=0.18))
# Larger at the smallest sizes, to be read in a browser's tab
small = [mark_png(n, 0.86, radius=0.18) for n in (16, 32, 48)]
small[-1].save(TEMPLATES / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)], append_images=small[:-1])
# Full squares, which the systems round as they like; within the middle, for maskable icons
mark_png(192, 0.56).save(STATIC / "icons" / "icon-192.png", optimize=True)
mark_png(512, 0.56).save(STATIC / "icons" / "icon-512.png", optimize=True)
mark_png(180, 0.6).save(STATIC / "icons" / "apple-touch-icon.png", optimize=True)
# For notifications, which only use its shape
mark_png(96, 0.8, background=False).save(STATIC / "icons" / "badge-96.png", optimize=True)
print("Drew the icons")
