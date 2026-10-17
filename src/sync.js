// Per-item sync. The Dropbox copy always wins; this computer's copy is backed up
// before it's replaced. Items Dropbox doesn't have can be uploaded.
//
//   local \ Dropbox      has a copy                 no copy
//   already linked       ok                         ok
//   real file/folder     replace (back up + link)   upload (move in + link)
//   missing              link                       skip
//   symlink elsewhere    relink                     leave
import fs from 'node:fs';
import path from 'node:path';
import { exists } from './paths.js';
import { compare } from './diff.js';
import { isWindows, linkType, removeLink, canLinkFiles, DEVELOPER_MODE_HELP } from './platform.js';

export function planItem(item) {
  const inDropbox = exists(item.shared);
  switch (item.state) {
    case 'linked':
      return 'ok';
    case 'link':
      return inDropbox ? 'relink' : 'leave';
    case 'real':
      return inDropbox ? 'replace' : 'upload';
    default:
      return inDropbox ? 'link' : 'skip';
  }
}

export const ACTION_TEXT = {
  ok: 'already linked',
  leave: 'symlink to somewhere else, left alone',
  link: 'link to the Dropbox copy',
  relink: 're-point the symlink to Dropbox',
  replace: 'back up, then link to the Dropbox copy',
  upload: 'move into Dropbox, link back',
};

// Actions taken from Dropbox (step 1) and from this computer (step 2).
export const LINK_ACTIONS = new Set(['link', 'relink', 'replace']);
export const UPLOAD_ACTIONS = new Set(['upload']);
export const CHANGES = new Set([...LINK_ACTIONS, ...UPLOAD_ACTIONS]);

export function timestamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// Differences between the local copy and the Dropbox copy ('' when equal).
export const diffItem = (item) => compare(item.local, item.shared, 'this computer', 'Dropbox');

// Symlink local -> shared, replacing any existing link.
function link(local, shared, kind) {
  fs.mkdirSync(path.dirname(local), { recursive: true });
  if (isWindows) {
    // Windows can't rename onto an existing folder link: remove it, then link.
    removeLink(local);
    fs.symlinkSync(shared, local, linkType(kind));
    return;
  }
  // macOS: create next to it and rename over it, so the swap is atomic.
  const tmp = `${local}.ai-agent-sync-tmp`;
  fs.rmSync(tmp, { force: true });
  fs.symlinkSync(shared, tmp, linkType(kind));
  fs.renameSync(tmp, local);
}

// Stops before touching anything when this item can't be linked here.
function assertLinkable(item) {
  if (item.kind === 'file' && !canLinkFiles()) throw new Error(DEVELOPER_MODE_HELP);
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

// Unlink: what happens to one item.
//   restore     linked, Dropbox copy exists -> replace the link with a real copy
//   broken      linked, but the Dropbox copy is missing -> left alone
//   not-linked  real, missing or linked elsewhere -> left alone
export function planUnlink(item) {
  if (item.state !== 'linked') return 'not-linked';
  return exists(item.shared) ? 'restore' : 'broken';
}

export const UNLINK_TEXT = {
  restore: 'restore a real copy from Dropbox',
  broken: 'Dropbox copy is missing, left alone',
  'not-linked': 'not linked, left alone',
};

// Replaces the symlink at item.local with a real copy of the Dropbox item.
// The copy is made first and the link is only moved aside, so a failure at
// any step leaves the original link in place.
export function unlinkItem(item) {
  const { local, shared } = item;
  const tmp = `${local}.ai-agent-sync-restore`;
  const oldLink = `${local}.ai-agent-sync-oldlink`;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.cpSync(shared, tmp, { recursive: true, preserveTimestamps: true });
  // A directory can't be renamed over a symlink, so move the link aside first.
  removeLink(oldLink);
  fs.renameSync(local, oldLink);
  try {
    fs.renameSync(tmp, local);
  } catch (err) {
    fs.renameSync(oldLink, local);
    fs.rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
  // Only the link itself is removed, never the Dropbox copy behind it.
  removeLink(oldLink);
}

// Performs one planned action. Returns the backup path for 'replace'.
export function applyItem(action, item, ts = timestamp()) {
  const { local, shared, kind } = item;
  if (CHANGES.has(action)) assertLinkable(item);
  switch (action) {
    case 'upload':
      move(local, shared);
      try {
        link(local, shared, kind);
      } catch (err) {
        move(shared, local); // put this computer's copy back
        throw err;
      }
      return null;
    case 'link':
    case 'relink':
      link(local, shared, kind);
      return null;
    case 'replace': {
      const backup = `${local}.bak-${ts}`;
      fs.renameSync(local, backup);
      try {
        link(local, shared, kind);
      } catch (err) {
        fs.renameSync(backup, local); // undo the backup move
        throw err;
      }
      return backup;
    }
    default:
      return null;
  }
}
