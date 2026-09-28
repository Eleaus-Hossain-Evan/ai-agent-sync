"""Renders a recording to a LinkedIn-ready MP4: title card, the real run, end card.

1080x1350 (4:5 portrait), 30 fps, H.264, no audio. Needs ffmpeg on PATH.
usage: render_video.py REC.json OUT.mp4 [--speed 1.5]
"""
import argparse, json, subprocess
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from term import Replay, draw_window, draw_screen, mono

ap = argparse.ArgumentParser()
ap.add_argument('rec'); ap.add_argument('out')
ap.add_argument('--speed', type=float, default=1.5, help='play the real run this much faster than recorded')
a = ap.parse_args()
rp = Replay(json.load(open(a.rec)))
VW, VH, FPS = 1080, 1350, 30
CYAN, TEXT, SUB, MUTED = (125, 207, 255), (240, 242, 250), (225, 230, 245), (140, 146, 170)


def sf(size, weight='Regular'):
    f = ImageFont.truetype('/System/Library/Fonts/SFNS.ttf', size)
    f.set_variation_by_name(weight)
    return f


def background():
    bg = Image.new('RGB', (VW, VH)); d = ImageDraw.Draw(bg)
    top, bot = (16, 17, 32), (27, 24, 48)
    for y in range(VH):
        t = y / VH
        d.line([(0, y), (VW, y)], fill=tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)))
    glow = Image.new('RGB', (VW, VH)); g = ImageDraw.Draw(glow)
    g.ellipse([VW * 0.45, -300, VW + 400, 500], fill=(40, 70, 120))
    g.ellipse([-400, VH - 500, 500, VH + 300], fill=(70, 40, 110))
    return Image.blend(bg, glow.filter(ImageFilter.GaussianBlur(220)), 0.35)


BG = background()


def centered(d, y, text, font, fill):
    d.text(((VW - d.textlength(text, font=font)) / 2, y), text, font=font, fill=fill)


def pill(d, y, text, font, fg, bg, padx=34, pady=18):
    w = d.textlength(text, font=font); top, bottom = font.getbbox(text)[1], font.getbbox(text)[3]
    x = (VW - w) / 2
    d.rounded_rectangle([x - padx, y - pady, x + w + padx, y + (bottom - top) + pady + 4], radius=18, fill=bg)
    d.text((x, y - top + 2), text, font=font, fill=fg)


def title_card():
    im = BG.copy(); d = ImageDraw.Draw(im)
    pill(d, 330, 'OPEN SOURCE  ·  MIT', sf(26, 'Semibold'), CYAN, (30, 45, 70), 24, 12)
    centered(d, 420, 'ai-agent-sync', sf(108, 'Bold'), TEXT)
    centered(d, 575, 'One CLAUDE.md.', sf(58, 'Semibold'), SUB)
    centered(d, 645, 'Every device.', sf(58, 'Semibold'), CYAN)
    pill(d, 780, '$ npx ai-agent-sync', mono(40), CYAN, (10, 11, 20))
    centered(d, 930, 'Claude Code · Cursor · Codex · Gemini CLI · Antigravity', sf(30), MUTED)
    centered(d, 975, 'OpenCode · Windsurf · Copilot · Kiro · Amp · Qwen · Zed', sf(30), MUTED)
    return im


def end_card():
    im = BG.copy(); d = ImageDraw.Draw(im)
    centered(d, 330, 'Same project.', sf(76, 'Bold'), TEXT)
    centered(d, 425, 'Same agent output.', sf(76, 'Bold'), TEXT)
    centered(d, 520, 'On every Mac.', sf(76, 'Bold'), CYAN)
    pill(d, 690, '$ npx ai-agent-sync', mono(44), CYAN, (10, 11, 20))
    centered(d, 850, 'github.com/Eleaus-Hossain-Evan/ai-agent-sync', sf(32, 'Medium'), (200, 206, 225))
    centered(d, 905, 'npmjs.com/package/ai-agent-sync', sf(32, 'Medium'), (200, 206, 225))
    centered(d, 1010, 'macOS · Node 18+ · Dropbox', sf(28), MUTED)
    return im


# Terminal window centred on the background, with a soft shadow.
reg, bold = mono(20), mono(20, bold=True)
CW, LH, PADX, PADY, BAR = reg.getlength('M'), 26, 20, 16, 44
TW, TH = int(rp.cols * CW + PADX * 2), BAR + PADY * 2 + rp.rows * LH
TX, TY = (VW - TW) // 2, (VH - TH) // 2
frame = BG.copy()
shadow = Image.new('L', (VW, VH)); ImageDraw.Draw(shadow).rounded_rectangle([TX, TY + 18, TX + TW, TY + TH + 18], 14, fill=170)
frame.paste((5, 5, 12), mask=shadow.filter(ImageFilter.GaussianBlur(28)))
draw_window(frame, TX, TY, TW, TH, BAR, 14, 'npx ai-agent-sync', sf(20, 'Medium'))


def term_frame():
    im = frame.copy(); draw_screen(im, rp.screen, TX + PADX, TY + BAR + PADY, CW, LH, reg, bold); return im


ff = subprocess.Popen(
    ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{VW}x{VH}', '-r', str(FPS),
     '-i', '-', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-tune', 'animation', '-pix_fmt', 'yuv420p',
     '-movflags', '+faststart', a.out],
    stdin=subprocess.PIPE)
count = 0


def put(im, n=1):
    global count
    b = im.tobytes()
    for _ in range(n): ff.stdin.write(b); count += 1


def fade(x, y, sec):
    k = int(sec * FPS)
    for i in range(1, k + 1): put(Image.blend(x, y, i / k))


title, end = title_card(), end_card()
put(title, int(3.2 * FPS))
last_img = term_frame(); fade(title, last_img, 0.5)
t, last_key = 0.0, None
while t <= rp.duration:
    rp.advance(t)
    k = rp.key()
    if k != last_key: last_img, last_key = term_frame(), k
    put(last_img); t += a.speed / FPS
fade(last_img, end, 0.6)
put(end, int(4.5 * FPS))
ff.stdin.close(); ff.wait()
print(f'{a.out}: {count / FPS:.1f}s, {VW}x{VH}')
