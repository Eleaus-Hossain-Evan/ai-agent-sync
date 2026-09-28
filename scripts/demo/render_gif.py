"""Renders a recording to the README GIF (terminal window only, 2x for Retina).

usage: render_gif.py REC.json OUT.gif
"""
import json, os, sys
from PIL import Image
from term import Replay, draw_window, draw_screen, mono

rec, out = json.load(open(sys.argv[1])), sys.argv[2]
K, FPS = 2, 15
rp = Replay(rec)
reg, bold = mono(16 * K), mono(16 * K, bold=True)
CW, LH = reg.getlength('M'), 22 * K
PADX, PADY, BAR = 24 * K, 18 * K, 38 * K
W, H = int(rp.cols * CW + PADX * 2), BAR + PADY * 2 + rp.rows * LH

base = Image.new('RGB', (W, H))
draw_window(base, 0, 0, W - 1, H - 1, BAR, 0, 'npx ai-agent-sync', mono(13 * K), K)

frames, durations, last = [], [], None
t, step = 0.0, 1 / FPS
while t <= rp.duration + 1e-9:
    rp.advance(t)
    k = rp.key()
    if k == last:
        durations[-1] += step
    else:
        im = base.copy(); draw_screen(im, rp.screen, PADX, BAR + PADY, CW, LH, reg, bold, K)
        frames.append(im); durations.append(step); last = k
    t += step
durations[-1] += 1.0

# One shared palette so colours never shift between frames.
sheet = Image.new('RGB', (W, H * 3))
for j, idx in enumerate((0, len(frames) // 2, -1)): sheet.paste(frames[idx], (0, H * j))
ref = sheet.quantize(colors=96, method=Image.Quantize.MEDIANCUT)
pal = [f.quantize(palette=ref, dither=Image.Dither.NONE) for f in frames]
pal[0].save(out, save_all=True, append_images=pal[1:], duration=[int(d * 1000) for d in durations], loop=0, optimize=True, disposal=1)
print(f'{out}: {len(frames)} frames, {W}x{H}, {os.path.getsize(out) / 1e6:.2f} MB')
