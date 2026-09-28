#!/bin/bash
# Regenerates the demo media from a real run of the CLI.
#   scripts/demo/make.sh gif     -> docs/demo.gif (README)
#   scripts/demo/make.sh video   -> scripts/demo/out/ai-agent-sync-linkedin.mp4
#   scripts/demo/make.sh         -> both
set -euo pipefail
cd "$(dirname "$0")"
REPO="$(cd ../.. && pwd)"
what="${1:-all}"

[ -d .venv ] || python3 -m venv .venv
.venv/bin/pip -q install -r requirements.txt
PY=.venv/bin/python
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
mkdir -p out

if [ "$what" = gif ] || [ "$what" = all ]; then
  ./setup_home.sh "$WORK/home"
  $PY record.py "$WORK/home" "$WORK/gif.json" --cols 88 --rows 36
  $PY render_gif.py "$WORK/gif.json" "$REPO/docs/demo.gif"
fi
if [ "$what" = video ] || [ "$what" = all ]; then
  command -v ffmpeg >/dev/null || { echo "ffmpeg is required for the video (brew install ffmpeg)"; exit 1; }
  ./setup_home.sh "$WORK/home"
  $PY record.py "$WORK/home" "$WORK/video.json" --cols 80 --rows 43 --pace 1.25
  $PY render_video.py "$WORK/video.json" out/ai-agent-sync-linkedin.mp4 --speed 1.5
fi
