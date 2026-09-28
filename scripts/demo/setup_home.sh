#!/bin/bash
# Creates a throwaway home folder with a few AI agents and an empty Dropbox,
# so the demo runs the real CLI without touching your own files.
# usage: setup_home.sh <dir>
set -euo pipefail
H="$1"
rm -rf "$H"
mkdir -p "$H/Dropbox" "$H/.claude/skills/review" "$H/.cursor/skills" "$H/.cursor/agents" \
         "$H/.gemini/antigravity" "$H/.codex" "$H/.crush"
echo "# Global rules" > "$H/.claude/CLAUDE.md"
echo "# Review skill" > "$H/.claude/skills/review/SKILL.md"
echo "# Gemini rules" > "$H/.gemini/GEMINI.md"
echo "# Codex rules"  > "$H/.codex/AGENTS.md"
echo "# Crush rules"  > "$H/.crush/CRUSH.md"   # not in the registry: shows up under "Possible agents"
# Hook already installed, so the run ends on "Done." without the hook note.
echo '{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"bash ~/.claude/check-dropbox-conflicts.sh"}]}]}}' \
  > "$H/.claude/settings.json"
