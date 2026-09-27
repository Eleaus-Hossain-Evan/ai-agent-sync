// Conflict checker run by a Claude Code SessionStart hook. Prints a warning
// into Claude's context when Dropbox has made "conflicted copy" files in the
// shared folder; silent otherwise. Same file name as the v3 script, so
// existing hooks keep working.
import fs from 'node:fs';
import path from 'node:path';
import { home } from './paths.js';

export const checkerPath = (h = home()) => path.join(h, '.claude', 'check-dropbox-conflicts.sh');

export function installChecker(root, h = home()) {
  const file = checkerPath(h);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `#!/bin/bash
# Prints a warning into Claude Code's context if Dropbox has created
# "conflicted copy" files in the shared AI agent folder. Silent otherwise.
found=$(find "${root}" -iname "*conflicted copy*" 2>/dev/null)
if [ -n "$found" ]; then
  echo "IMPORTANT: Dropbox created conflicting copies of the user's AI agent config."
  echo "Tell the user about this before doing anything else, and list these files:"
  echo "$found"
fi
exit 0
`,
    { mode: 0o755 },
  );
  return file;
}

// True when ~/.claude/settings.json already runs the checker.
export function hookInstalled(h = home()) {
  try {
    return fs.readFileSync(path.join(h, '.claude', 'settings.json'), 'utf8').includes('check-dropbox-conflicts.sh');
  } catch {
    return false;
  }
}

export const HOOK_SNIPPET = `"hooks": {
  "SessionStart": [
    { "hooks": [ { "type": "command", "command": "bash \\"$HOME/.claude/check-dropbox-conflicts.sh\\"" } ] }
  ]
}`;
