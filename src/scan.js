import fs from 'node:fs';
import path from 'node:path';
import { home, expand, tilde, portable, lstat, readlink } from './paths.js';
import { isWindows, appDataDir, samePath, normalize } from './platform.js';

// Folders discovery never looks inside: caches, toolchains, credentials.
const SKIP = new Set([
  '.Trash', '.git', '.npm', '.cache', '.local', '.config', '.dropbox', '.ssh', '.gnupg',
  '.docker', '.cargo', '.rustup', '.pub-cache', '.gradle', '.android', '.cocoapods', '.nvm',
  '.bun', '.pyenv', '.oh-my-zsh', '.zsh_sessions', '.vscode', '.vscode-insiders', 'node_modules',
]);
const DIR_NAMES = new Set(['skills', 'rules', 'prompts', 'steering', 'workflows']);
const NOT_INSTRUCTIONS = new Set([
  'README.md', 'CHANGELOG.md', 'LICENSE.md', 'CONTRIBUTING.md', 'SECURITY.md',
  'CODE_OF_CONDUCT.md', 'HISTORY.md', 'NOTICE.md', 'TODO.md', 'AUTHORS.md',
]);

// Where one agent item lives in Dropbox.
export const sharedPath = (root, agentId, localPath) => path.join(root, agentId, path.basename(localPath));

// State of one item on this computer:
//   linked  symlink to its Dropbox copy
//   link    symlink somewhere else
//   real    real file or folder
//   missing nothing there
export function itemState(localPath, shared) {
  const st = lstat(localPath);
  if (!st) return 'missing';
  if (st.isSymbolicLink()) return samePath(readlink(localPath), shared) ? 'linked' : 'link';
  return 'real';
}

// Registry agents found on this computer, with every item's paths and state.
export function detectAgents(agents, root, h = home()) {
  return agents
    .filter((a) => a.detect.some((d) => fs.existsSync(expand(d, h))))
    .map((a) => {
      const items = a.items.map((it) => {
        const local = expand(it.path, h);
        const shared = sharedPath(root, a.id, local);
        return { ...it, local, shared, state: itemState(local, shared) };
      });
      return { ...a, items, synced: items.every((i) => i.state === 'linked') };
    });
}

// Agent-like entries directly inside `folder`.
function agentItems(folder) {
  let names;
  try {
    names = fs.readdirSync(folder);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    const p = path.join(folder, name);
    const st = lstat(p);
    if (!st || st.isSymbolicLink()) continue;
    if (st.isDirectory() && DIR_NAMES.has(name)) out.push({ path: p, kind: 'dir' });
    else if (st.isFile() && !NOT_INSTRUCTIONS.has(name)) {
      if (/^[A-Z][A-Z0-9_-]*\.md$/.test(name) || /rules.*\.md$/i.test(name)) out.push({ path: p, kind: 'file' });
    }
  }
  return out;
}

// App data folders discovery skips. On macOS: folders guarded by privacy
// protection (reading them can pop a permission prompt). On Windows: big
// system and browser folders. No AI agent lives in either.
const PROTECTED = isWindows
  ? /^(Microsoft|Packages|Temp|Mozilla|Google|Adobe|Apple|Dropbox|npm|npm-cache|NVIDIA|Intel|Zoom)/i
  : /^(com\.apple\.|AddressBook|CallHistory|MobileSync|Knowledge|FileProvider|CloudDocs|iCloud|Apple|Safari)/;

function childDirs(dir, skip = () => false) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !SKIP.has(d.name) && !skip(d.name))
      .map((d) => path.join(dir, d.name));
  } catch {
    return [];
  }
}

// Folders that could hold an agent: hidden folders in ~, everything in
// ~/.config, and everything (plus one level down) in the app data folder
// (Application Support on macOS, AppData\Roaming on Windows).
function candidateFolders(h) {
  const appSupport = appDataDir(h);
  return [
    ...childDirs(h).filter((p) => path.basename(p).startsWith('.')),
    ...childDirs(path.join(h, '.config')),
    ...childDirs(appSupport, (n) => PROTECTED.test(n)).flatMap((p) => [p, ...childDirs(p)]),
  ];
}

// "~/.foo-cli" -> "foo-cli", "-2" suffix when the id is taken.
function newId(folder, taken) {
  const base =
    path
      .basename(folder)
      .toLowerCase()
      .replace(/^\.+/, '')
      .replace(/[^a-z0-9_-]/g, '-') || 'agent';
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

// Folders that look like an AI agent but are not in the registry.
// Returns agents in registry shape (with ~ paths), ready for tools.conf.
export function discoverAgents(agents, ignored, h = home()) {
  const known = [path.join(h, '.claude')];
  for (const a of agents) {
    for (const d of a.detect) known.push(expand(d, h));
    for (const it of a.items) known.push(expand(it.path, h));
  }
  const keys = known.map(normalize);
  const isKnown = (f) => {
    if (ignored.has(tilde(f, h)) || ignored.has(portable(f, h))) return true;
    const n = normalize(f);
    return keys.some((k) => k === n || k.startsWith(n + path.sep) || n.startsWith(k + path.sep));
  };

  const taken = new Set(agents.map((a) => a.id));
  const found = [];
  for (const folder of candidateFolders(h)) {
    if (isKnown(folder)) continue;
    const items = agentItems(folder);
    if (!items.length) continue;
    const id = newId(folder, taken);
    found.push({
      id,
      name: id,
      folder,
      detect: [portable(folder, h)],
      items: items.map((it) => ({ path: portable(it.path, h), kind: it.kind })),
    });
  }
  return found;
}
