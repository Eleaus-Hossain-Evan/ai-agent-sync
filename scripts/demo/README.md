# Demo media

Regenerates the README GIF and the LinkedIn video from a **real run** of the CLI. The run happens in a throwaway home folder with a fake Dropbox, so your own files are never touched.

```sh
scripts/demo/make.sh          # both
scripts/demo/make.sh gif      # docs/demo.gif
scripts/demo/make.sh video    # scripts/demo/out/ai-agent-sync-linkedin.mp4
```

Needs macOS (it uses the Menlo and SF system fonts), Python 3 and Node. The video also needs `ffmpeg` (`brew install ffmpeg`). `make.sh` creates `.venv/` here and installs `requirements.txt` (pyte, Pillow).

| File | What it does |
|---|---|
| `setup_home.sh` | Creates the fake home: Claude Code, Cursor, Gemini CLI, Antigravity, Codex, and `~/.crush` as an agent that isn't in the registry. |
| `record.py` | Runs `bin/cli.js` in a pseudo-terminal, types the command, ticks the agents in `--select`, applies, and saves timestamped output as JSON. The row positions come from the CLI's own scan code, so apps installed on your Mac don't break the key presses. |
| `term.py` | Shared helpers: replays the recording into a virtual terminal (pyte) and draws it with the terminal colours. |
| `render_gif.py` | Terminal window only, 2× for Retina, 15 fps, one shared palette. Output: `docs/demo.gif`. |
| `render_video.py` | 1080×1350 MP4 (4:5, LinkedIn): title card, the run at `--speed` (default 1.5×), end card. |

To change what the demo does, edit `setup_home.sh` (which agents exist) and `--select` in `make.sh` / `record.py` (which ones get ticked). To change the text, edit `title_card()` / `end_card()` in `render_video.py`.
