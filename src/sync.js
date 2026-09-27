// Per-item sync, same rules as the v3 bash script.
//
// Primary (this Mac has the real files):
//   real item, nothing in Dropbox  -> move it into Dropbox, link it back
//   real item, Dropbox has a copy  -> skip with a warning (never overwrite)
//   missing everywhere             -> create an empty one in Dropbox, link it
// Secondary (link to the Dropbox copies):
//   real item, Dropbox has a copy  -> show diff, confirm, back up, link
//   real item, nothing in Dropbox  -> offer to move this Mac's copy in
//   missing locally                -> link to the Dropbox copy
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { exists } from './paths.js';

export function planItem(role, item) {
  const inDropbox = exists(item.shared);
  switch (item.state) {
    case 'linked':
      return 'ok';
    case 'link':
      if (role === 'primary') return 'leave';
      return inDropbox ? 'relink' : 'wait';
    case 'real':
      if (role === 'primary') return inDropbox ? 'conflict' : 'move';
      return inDropbox ? 'replace' : 'upload';
    default:
      if (inDropbox) return 'link';
      return role === 'primary' ? 'create' : 'wait';
  }
}

export const ACTION_TEXT = {
  ok: 'already linked',
  leave: 'is a symlink to somewhere else, left alone',
  conflict: 'Dropbox already has a copy, skipped (run as Secondary on this Mac to use it)',
  move: 'move into Dropbox, link back',
  create: 'create empty in Dropbox, link',
  link: 'link to the Dropbox copy',
  relink: 're-point the existing symlink to Dropbox',
  replace: 'back up, then link to the Dropbox copy',
  upload: 'not in Dropbox yet, move this Mac’s copy in',
  wait: 'not in Dropbox yet, sync it from the primary Mac first',
};

// Actions that change something.
export const CHANGES = new Set(['move', 'create', 'link', 'relink', 'replace', 'upload']);

export function timestamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// Differences between the local copy ("this Mac") and the Dropbox copy
// ('' when equal). Paths are shortened so the output fits the terminal.
export function diffItem(item) {
  const args =
    item.kind === 'dir'
      ? ['-rq', item.local, item.shared]
      : ['-u', '-L', 'this Mac', '-L', 'Dropbox', item.local, item.shared];
  return spawnSync('diff', args, { encoding: 'utf8' })
    .stdout.trim()
    .split(item.shared)
    .join('Dropbox')
    .split(item.local)
    .join('this Mac');
}

// Symlink local -> shared, replacing any existing symlink atomically.
function link(local, shared) {
  fs.mkdirSync(path.dirname(local), { recursive: true });
  const tmp = `${local}.ai-agent-sync-tmp`;
  fs.rmSync(tmp, { force: true });
  fs.symlinkSync(shared, tmp);
  fs.renameSync(tmp, local);
}

// rename, falling back to copy + delete across volumes.
function move(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.renameSync(from, to);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    fs.cpSync(from, to, { recursive: true, preserveTimestamps: true });
    fs.rmSync(from, { recursive: true, force: true });
  }
}

// Performs one planned action. Returns the backup path for 'replace'.
export function applyItem(action, item, ts = timestamp()) {
  const { local, shared, kind } = item;
  switch (action) {
    case 'move':
    case 'upload':
      move(local, shared);
      link(local, shared);
      return null;
    case 'create':
      fs.mkdirSync(kind === 'dir' ? shared : path.dirname(shared), { recursive: true });
      if (kind === 'file') fs.writeFileSync(shared, '', { flag: 'a' });
      link(local, shared);
      return null;
    case 'link':
    case 'relink':
      link(local, shared);
      return null;
    case 'replace': {
      const backup = `${local}.bak-${ts}`;
      fs.renameSync(local, backup);
      link(local, shared);
      return backup;
    }
    default:
      return null;
  }
}
