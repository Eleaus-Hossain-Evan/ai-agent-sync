import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

export const home = () => os.homedir();

// "~/x" -> "/Users/me/x". Registry, tools.conf and tools.ignore store ~ paths
// so the same line works on Macs with different usernames.
export function expand(p, h = home()) {
  if (p === '~') return h;
  if (p.startsWith('~/')) return path.join(h, p.slice(2));
  return p;
}

// "/Users/me/x" -> "~/x"
export function tilde(p, h = home()) {
  if (p === h) return '~';
  if (p.startsWith(h + path.sep)) return '~/' + p.slice(h.length + 1);
  return p;
}

// lstat without throwing: null when the path does not exist.
export function lstat(p) {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
}

export const exists = (p) => fs.existsSync(p);

export function readlink(p) {
  try {
    return fs.readlinkSync(p);
  } catch {
    return null;
  }
}
