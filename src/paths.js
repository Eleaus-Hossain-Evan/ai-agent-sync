import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { appDataDir, localAppDataDir, isWindows } from './platform.js';

export const home = () => os.homedir();

// Portable path prefixes. The registry, tools.conf and tools.ignore store
// paths like these, so one line works for any username and on both macOS
// and Windows:
//   ~/x               home folder
//   @appdata/x        ~/Library/Application Support (macOS), %APPDATA% (Windows)
//   @localappdata/x   ~/Library/Application Support (macOS), %LOCALAPPDATA% (Windows)
// Order matters for portable(): on macOS both app data tokens are the same
// folder, and @appdata is the one the registry uses.
const TOKENS = [
  ['@appdata', appDataDir],
  ['@localappdata', localAppDataDir],
  ['~', (h) => h],
];

export function expand(p, h = home()) {
  for (const [token, dir] of TOKENS) {
    if (p === token) return dir(h);
    if (p.startsWith(token + '/') || p.startsWith(token + '\\')) return path.join(dir(h), p.slice(token.length + 1));
  }
  return p;
}

const under = (p, dir) => {
  const a = isWindows ? p.toLowerCase() : p;
  const b = isWindows ? dir.toLowerCase() : dir;
  return a === b ? '' : a.startsWith(b + path.sep) ? p.slice(dir.length + 1) : null;
};
const slashes = (p) => p.split(path.sep).join('/');

// "/Users/me/x" -> "~/x" for display. Always forward slashes.
export function tilde(p, h = home()) {
  const rest = under(p, h);
  if (rest === null) return slashes(p);
  return rest ? `~/${slashes(rest)}` : '~';
}

// Like tilde(), but prefers the @appdata tokens, for paths written to the
// shared tools.conf / tools.ignore that the other computer must understand.
export function portable(p, h = home()) {
  for (const [token, dir] of TOKENS.slice(0, 2)) {
    const rest = under(p, dir(h));
    if (rest !== null && dir(h) !== h) return rest ? `${token}/${slashes(rest)}` : token;
  }
  return tilde(p, h);
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
