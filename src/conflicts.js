// Dropbox "conflicted copy" handling for `ai-agent-sync resolve`.
//
// When two Macs change the same file before Dropbox catches up, Dropbox keeps
// both and renames one, e.g. "CLAUDE (Evan's conflicted copy 2026-10-04).md".
// Losing versions always go to the macOS Trash, never straight to deletion.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { home, exists } from './paths.js';
import { timestamp } from './sync.js';

const MARKER = / \([^()]*conflicted copy[^()]*\)/i;

// ".../CLAUDE (Evan's conflicted copy 2026-10-04).md" -> ".../CLAUDE.md"
export function originalOf(p) {
  return path.join(path.dirname(p), path.basename(p).replace(MARKER, ''));
}

// Differences between the current version and the conflicted copy ('' when equal).
export function conflictDiff(conflict, original) {
  const dir = fs.lstatSync(conflict).isDirectory();
  const args = dir
    ? ['-rq', original, conflict]
    : ['-u', '-L', 'current', '-L', 'conflicted copy', original, conflict];
  return spawnSync('diff', args, { encoding: 'utf8' })
    .stdout.trim()
    .split(conflict)
    .join('conflicted copy')
    .split(original)
    .join('current');
}

// Moves p into ~/.Trash (restorable from Finder). Returns the Trash path.
export function moveToTrash(p, h = home()) {
  const trash = path.join(h, '.Trash');
  fs.mkdirSync(trash, { recursive: true });
  const ext = path.extname(p);
  const base = path.basename(p, ext);
  let dest = path.join(trash, path.basename(p));
  if (exists(dest)) dest = path.join(trash, `${base} ${timestamp()}${ext}`);
  for (let n = 2; exists(dest); n++) dest = path.join(trash, `${base} ${timestamp()}-${n}${ext}`);
  try {
    fs.renameSync(p, dest);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    fs.cpSync(p, dest, { recursive: true, preserveTimestamps: true });
    fs.rmSync(p, { recursive: true, force: true });
  }
  return dest;
}

// Applies one choice. Returns a short description of what happened.
//   keep-current    conflicted copy -> Trash
//   use-conflicted  current -> Trash, conflicted copy takes its name
//   restore         (original missing) conflicted copy takes the original name
//   trash           conflicted copy -> Trash
//   keep-both       nothing
export function resolveConflict(conflict, choice, h = home()) {
  const original = originalOf(conflict);
  const name = path.basename(original);
  switch (choice) {
    case 'keep-current':
      moveToTrash(conflict, h);
      return `${name}: kept current, conflicted copy moved to Trash`;
    case 'use-conflicted':
      moveToTrash(original, h);
      fs.renameSync(conflict, original);
      return `${name}: using the conflicted copy, previous version moved to Trash`;
    case 'restore':
      fs.renameSync(conflict, original);
      return `${name}: restored from the conflicted copy`;
    case 'trash':
      moveToTrash(conflict, h);
      return `${path.basename(conflict)}: moved to Trash`;
    default:
      return `${path.basename(conflict)}: kept as is`;
  }
}
