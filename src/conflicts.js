// Dropbox "conflicted copy" handling for `ai-agent-sync resolve`.
//
// When two computers change the same file before Dropbox catches up, Dropbox
// keeps both and renames one, e.g. "CLAUDE (Evan's conflicted copy 2026-10-04).md".
// Losing versions always go to the Trash / Recycle Bin, never straight to deletion.
import fs from 'node:fs';
import path from 'node:path';
import { home } from './paths.js';
import { timestamp } from './sync.js';
import { compare } from './diff.js';
import { trash, WORDS } from './platform.js';

const MARKER = / \([^()]*conflicted copy[^()]*\)/i;

// ".../CLAUDE (Evan's conflicted copy 2026-10-04).md" -> ".../CLAUDE.md"
export function originalOf(p) {
  return path.join(path.dirname(p), path.basename(p).replace(MARKER, ''));
}

// Differences between the current version and the conflicted copy ('' when equal).
export const conflictDiff = (conflict, original) => compare(original, conflict, 'current', 'conflicted copy');

// Moves p to the Trash (macOS) or Recycle Bin (Windows). Returns where it went.
export const moveToTrash = (p, h = home()) => trash(p, h, timestamp());

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
      return `${name}: kept current, conflicted copy moved to the ${WORDS.trash}`;
    case 'use-conflicted':
      moveToTrash(original, h);
      fs.renameSync(conflict, original);
      return `${name}: using the conflicted copy, previous version moved to the ${WORDS.trash}`;
    case 'restore':
      fs.renameSync(conflict, original);
      return `${name}: restored from the conflicted copy`;
    case 'trash':
      moveToTrash(conflict, h);
      return `${path.basename(conflict)}: moved to the ${WORDS.trash}`;
    default:
      return `${path.basename(conflict)}: kept as is`;
  }
}
