"""Records a real `ai-agent-sync` run in a pseudo-terminal.

Types the command, picks Primary, ticks the agents named in --select, applies
the plan, and saves the timestamped terminal output as JSON for the renderers.

usage: record.py HOME OUT.json [--cols 88] [--rows 36] [--pace 1.0]
                 [--select "Claude Code,Cursor,Gemini CLI,crush"]
"""
import argparse, codecs, fcntl, json, os, pty, select, struct, subprocess, termios, time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
CLI = REPO / 'bin' / 'cli.js'

ap = argparse.ArgumentParser()
ap.add_argument('home'); ap.add_argument('out')
ap.add_argument('--cols', type=int, default=88); ap.add_argument('--rows', type=int, default=36)
ap.add_argument('--pace', type=float, default=1.0, help='multiplies every pause (higher = slower)')
ap.add_argument('--select', default='Claude Code,Cursor,Gemini CLI,crush')
a = ap.parse_args()
targets = [t.strip() for t in a.select.split(',')]

# Checklist order exactly as the CLI builds it: detected (not yet synced) agents, then discovered ones.
order_js = f"""
import {{ BUILTIN_AGENTS }} from '{REPO}/src/agents.js';
import {{ detectAgents, discoverAgents }} from '{REPO}/src/scan.js';
const root = '/nonexistent';
const detected = detectAgents(BUILTIN_AGENTS, root).filter((x) => !x.synced).map((x) => x.name);
const found = discoverAgents(BUILTIN_AGENTS, new Set()).map((x) => x.name);
console.log(JSON.stringify([...detected, ...found]));
"""
order = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', order_js], env={**os.environ, 'HOME': a.home}))
missing = [t for t in targets if t not in order]
if missing: raise SystemExit(f'not in the checklist: {missing}; checklist is {order}')
rows_to_tick = sorted(order.index(t) for t in targets)

dec = codecs.getincrementaldecoder('utf-8')('replace')
events, t0 = [], time.time()
def emit(b): events.append([time.time() - t0, dec.decode(b)])
def nap(s): time.sleep(s * a.pace)

# Fake shell prompt + typed command (drawn, not executed).
emit(b'\x1b[32m~/work\x1b[0m \x1b[35m\xe2\x9d\xaf\x1b[0m '); nap(0.7)
for ch in 'npx ai-agent-sync': emit(ch.encode()); nap(0.07)
nap(0.4); emit(b'\r\n')

pid, fd = pty.fork()
if pid == 0:
    os.environ.update(HOME=a.home, TERM='xterm-256color', FORCE_COLOR='1')
    os.execvp('node', ['node', str(CLI)])
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', a.rows, a.cols, 0, 0))
buf = b''
def pump(sec):
    global buf
    end = time.time() + sec
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.02)
        if r:
            try: b = os.read(fd, 4096)
            except OSError: return
            if not b: return
            buf += b; emit(b)
def wait_for(text, timeout=15):
    end = time.time() + timeout
    while text.encode() not in buf and time.time() < end: pump(0.05)
    if text.encode() not in buf: raise SystemExit(f'timed out waiting for {text!r}')
def key(k, pause): os.write(fd, k); pump(pause * a.pace)
DOWN, SPACE, ENTER = b'\x1b[B', b' ', b'\r'

wait_for('What is this Mac'); pump(1.4 * a.pace)
key(ENTER, 0.8)                                   # Primary
wait_for('Which agents'); pump(1.6 * a.pace)
pos = 0
for row in rows_to_tick:
    for _ in range(row - pos): key(DOWN, 0.35)
    key(SPACE, 0.7); pos = row
pump(0.5 * a.pace); key(ENTER, 0.5)
# Unticked discovered agents trigger "Hide any…?": answer with nothing hidden.
end = time.time() + 5
while b'Apply this plan' not in buf and b'Hide any' not in buf and time.time() < end: pump(0.05)
if b'Hide any' in buf and b'Apply this plan' not in buf: key(ENTER, 0.5)
wait_for('Apply this plan'); pump(3.2 * a.pace)
key(ENTER, 0.2)
wait_for('Done.'); pump(0.2)
events.append([time.time() - t0 + 3.5, ''])      # hold the final state
json.dump({'cols': a.cols, 'rows': a.rows, 'events': events}, open(a.out, 'w'))
print(f'recorded {events[-1][0]:.1f}s -> {a.out}')
