"""Shared terminal replay + drawing used by render_gif.py and render_video.py."""
import pyte
from PIL import ImageDraw, ImageFont

MENLO = '/System/Library/Fonts/Menlo.ttc'
PALETTE = {
    'default': (214, 222, 235), 'black': (30, 34, 42), 'red': (239, 107, 115), 'green': (158, 206, 106),
    'brown': (224, 175, 104), 'yellow': (224, 175, 104), 'blue': (122, 162, 247), 'magenta': (187, 154, 247),
    'cyan': (125, 207, 255), 'white': (230, 230, 230), 'brightblack': (112, 118, 145),
}
WINDOW_BG, TITLEBAR = (26, 27, 38), (22, 22, 30)
LIGHTS = [(255, 95, 87), (254, 188, 46), (40, 200, 64)]


def mono(size, bold=False):
    return ImageFont.truetype(MENLO, size, index=1 if bold else 0)


def fix_sgr(s):
    # pyte ignores SGR 2 (dim): show dim text as grey, and make 22 reset both.
    return s.replace('\x1b[2m', '\x1b[90m').replace('\x1b[22m', '\x1b[22;39m')


class Replay:
    """Feeds recorded events into a pyte screen, one time step at a time."""

    def __init__(self, rec):
        self.cols, self.rows, self.events = rec['cols'], rec['rows'], rec['events']
        self.screen = pyte.Screen(self.cols, self.rows)
        self.stream = pyte.Stream(self.screen)
        self.i = 0
        self.duration = self.events[-1][0]

    def advance(self, t):
        while self.i < len(self.events) and self.events[self.i][0] <= t:
            self.stream.feed(fix_sgr(self.events[self.i][1]))
            self.i += 1

    def key(self):
        sc = self.screen
        cells = tuple((c.data, c.fg, c.bg, c.bold) for r in range(self.rows) for c in sc.buffer[r].values())
        return cells, sc.cursor.x, sc.cursor.y, sc.cursor.hidden


def draw_window(img, x, y, w, h, bar, radius, title, title_font, scale=1):
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([x, y, x + w, y + h], radius, fill=WINDOW_BG, outline=(52, 54, 72))
    d.rounded_rectangle([x, y, x + w, y + bar], radius, fill=TITLEBAR)
    d.rectangle([x + 1, y + bar - radius, x + w - 1, y + bar], fill=TITLEBAR)
    for i, c in enumerate(LIGHTS):
        cx, cy, r = x + (20 + i * 22) * scale, y + bar / 2, 7 * scale
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=c)
    tw = d.textlength(title, font=title_font)
    d.text((x + w / 2 - tw / 2, y + bar / 2 - title_font.size * 0.6), title, font=title_font, fill=(139, 143, 167))


def draw_screen(img, screen, x0, y0, cw, lh, reg, bold, scale=1):
    d = ImageDraw.Draw(img)
    for r in range(screen.lines):
        row, y = screen.buffer[r], y0 + r * lh
        for c in range(screen.columns):
            ch, x = row[c], x0 + c * cw
            if ch.bg != 'default':
                d.rectangle([x, y, x + cw, y + lh - 1], fill=PALETTE.get(ch.bg, (60, 60, 60)))
            if ch.data.strip():
                d.text((x, y + 2 * scale), ch.data, fill=PALETTE.get(ch.fg, PALETTE['default']), font=bold if ch.bold else reg)
    if not screen.cursor.hidden:
        x, y = x0 + screen.cursor.x * cw, y0 + screen.cursor.y * lh
        d.rectangle([x, y + scale, x + cw - scale, y + lh - 2 * scale], fill=(192, 202, 245))
