import fs from 'node:fs';
import path from 'node:path';
import { home, exists } from './paths.js';

export const SHARED_DIR_NAME = 'AIAgentsShared';
export const DROPBOX_INSTALL_URL = 'https://www.dropbox.com/install';

// Returns the Dropbox folder, or null. Dropbox's own info.json wins, so
// custom locations work; then the macOS File Provider path, then ~/Dropbox.
export function findDropbox(h = home()) {
  const info = path.join(h, '.dropbox', 'info.json');
  try {
    const json = JSON.parse(fs.readFileSync(info, 'utf8'));
    for (const account of Object.values(json)) {
      if (account && account.path && exists(account.path)) return account.path;
    }
  } catch {
    // no info.json or unreadable: fall through to the usual locations
  }
  for (const p of [path.join(h, 'Library', 'CloudStorage', 'Dropbox'), path.join(h, 'Dropbox')]) {
    if (exists(p)) return p;
  }
  return null;
}

export const sharedRoot = (dropbox) => path.join(dropbox, SHARED_DIR_NAME);
