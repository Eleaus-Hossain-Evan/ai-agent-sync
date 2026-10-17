import fs from 'node:fs';
import path from 'node:path';
import { home, exists } from './paths.js';
import { isWindows, appDataDir, localAppDataDir } from './platform.js';

export const SHARED_DIR_NAME = 'AIAgentsShared';
export const DROPBOX_INSTALL_URL = 'https://www.dropbox.com/install';

// Where the Dropbox app writes info.json, which names the Dropbox folder.
function infoFiles(h) {
  if (isWindows) {
    return [path.join(appDataDir(h), 'Dropbox', 'info.json'), path.join(localAppDataDir(h), 'Dropbox', 'info.json')];
  }
  return [path.join(h, '.dropbox', 'info.json')];
}

// Returns the Dropbox folder, or null. Dropbox's own info.json wins, so
// custom locations work; then the usual default folders.
export function findDropbox(h = home()) {
  for (const info of infoFiles(h)) {
    try {
      const json = JSON.parse(fs.readFileSync(info, 'utf8'));
      for (const account of Object.values(json)) {
        if (account && account.path && exists(account.path)) return account.path;
      }
    } catch {
      // no info.json here or unreadable: try the next one
    }
  }
  const defaults = isWindows
    ? [path.join(h, 'Dropbox')]
    : [path.join(h, 'Library', 'CloudStorage', 'Dropbox'), path.join(h, 'Dropbox')];
  return defaults.find(exists) ?? null;
}

export const sharedRoot = (dropbox) => path.join(dropbox, SHARED_DIR_NAME);
