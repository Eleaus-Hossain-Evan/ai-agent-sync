// File and folder comparison in plain JavaScript, so it works the same on
// macOS and Windows (Windows has no `diff` command).
import fs from 'node:fs';
import path from 'node:path';
import { createTwoFilesPatch } from 'diff';

const isBinary = (buf) => buf.includes(0);

// Unified diff of two files ('' when equal).
function fileDiff(a, b, labelA, labelB) {
  const ba = fs.readFileSync(a);
  const bb = fs.readFileSync(b);
  if (ba.equals(bb)) return '';
  if (isBinary(ba) || isBinary(bb)) return `Binary files ${labelA} and ${labelB} differ`;
  const patch = createTwoFilesPatch(labelA, labelB, ba.toString('utf8'), bb.toString('utf8'), '', '', { context: 3 });
  // Drop jsdiff's "=====" line; keep ---/+++ and the hunks.
  return patch.split('\n').slice(1).join('\n').trim();
}

// Relative paths of all files under dir (folders end with /).
function listTree(dir, rel = '') {
  let entries;
  try {
    entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    return e.isDirectory() ? [`${r}/`, ...listTree(dir, r)] : [r];
  });
}

// One line per difference, like `diff -rq` ('' when equal).
function dirDiff(a, b, labelA, labelB) {
  const ta = new Set(listTree(a));
  const tb = new Set(listTree(b));
  const out = [];
  for (const r of [...new Set([...ta, ...tb])].sort()) {
    if (!tb.has(r)) out.push(`Only in ${labelA}: ${r}`);
    else if (!ta.has(r)) out.push(`Only in ${labelB}: ${r}`);
    else if (!r.endsWith('/')) {
      const fa = fs.readFileSync(path.join(a, r));
      const fb = fs.readFileSync(path.join(b, r));
      if (!fa.equals(fb)) out.push(`Files differ: ${r}`);
    }
  }
  return out.join('\n');
}

// Compares two files or two folders; '' when they're the same.
export function compare(a, b, labelA, labelB) {
  const dirA = fs.statSync(a).isDirectory();
  const dirB = fs.statSync(b).isDirectory();
  if (dirA !== dirB) return `${labelA} is a ${dirA ? 'folder' : 'file'}, ${labelB} is a ${dirB ? 'folder' : 'file'}`;
  return dirA ? dirDiff(a, b, labelA, labelB) : fileDiff(a, b, labelA, labelB);
}
