// Conflict checker run by a Claude Code SessionStart hook. Prints a warning
// into Claude's context when Dropbox has made "conflicted copy" files in the
// shared folder; silent otherwise.
//
// macOS keeps the bash script (same name as the v3 script, so existing hooks
// keep working). Windows has no bash by default, so it gets a Node script.
import fs from 'node:fs';
import path from 'node:path';
import { home } from './paths.js';
import { isWindows } from './platform.js';

export const checkerPath = (h = home()) =>
  path.join(h, '.claude', isWindows ? 'check-dropbox-conflicts.mjs' : 'check-dropbox-conflicts.sh');

const WARNING = [
  "IMPORTANT: Dropbox created conflicting copies of the user's AI agent config.",
  'Tell the user about this before doing anything else, and list these files:',
];

const bashScript = (root) => `#!/bin/bash
# Prints a warning into Claude Code's context if Dropbox has created
# "conflicted copy" files in the shared AI agent folder. Silent otherwise.
found=$(find "${root}" -iname "*conflicted copy*" 2>/dev/null)
if [ -n "$found" ]; then
  echo "${WARNING[0]}"
  echo "${WARNING[1]}"
  echo "$found"
fi
exit 0
`;

const nodeScript = (root) => `// Prints a warning into Claude Code's context if Dropbox has created
// "conflicted copy" files in the shared AI agent folder. Silent otherwise.
import fs from 'node:fs';
import path from 'node:path';
const found = [];
(function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (/conflicted copy/i.test(e.name)) found.push(p);
    if (e.isDirectory()) walk(p);
  }
})(${JSON.stringify(root)});
if (found.length) console.log([...${JSON.stringify(WARNING)}, ...found].join('\\n'));
`;

export function installChecker(root, h = home()) {
  const file = checkerPath(h);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, isWindows ? nodeScript(root) : bashScript(root), { mode: 0o755 });
  return file;
}

// True when ~/.claude/settings.json already runs a checker.
export function hookInstalled(h = home()) {
  try {
    return fs.readFileSync(path.join(h, '.claude', 'settings.json'), 'utf8').includes('check-dropbox-conflicts');
  } catch {
    return false;
  }
}

// The settings.json snippet to add. On Windows the command uses the full
// path, because cmd/PowerShell don't expand $HOME.
export function hookSnippet(h = home()) {
  const command = isWindows ? `node "${checkerPath(h)}"` : 'bash "$HOME/.claude/check-dropbox-conflicts.sh"';
  return `"hooks": {
  "SessionStart": [
    { "hooks": [ { "type": "command", "command": ${JSON.stringify(command)} } ] }
  ]
}`;
}
