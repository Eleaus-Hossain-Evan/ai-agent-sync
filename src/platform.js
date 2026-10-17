// Everything that differs between macOS and Windows lives here, so the rest
// of the code can stay platform-neutral.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const isWindows = process.platform === 'win32';
export const SUPPORTED = isWindows || process.platform === 'darwin';

// Words the user sees.
export const WORDS = isWindows
  ? { fileManager: 'File Explorer', trash: 'Recycle Bin' }
  : { fileManager: 'Finder', trash: 'Trash' };

// Per-user app data folders. Derived from the given home so tests can use a
// fake home; the real environment variables win for the real home.
export function appDataDir(h) {
  if (!isWindows) return path.join(h, 'Library', 'Application Support');
  if (h === os.homedir() && process.env.APPDATA) return process.env.APPDATA;
  return path.join(h, 'AppData', 'Roaming');
}

export function localAppDataDir(h) {
  if (!isWindows) return path.join(h, 'Library', 'Application Support');
  if (h === os.homedir() && process.env.LOCALAPPDATA) return process.env.LOCALAPPDATA;
  return path.join(h, 'AppData', 'Local');
}

// Windows paths are case-insensitive and may carry a \\?\ prefix.
export function normalize(p) {
  if (!p) return p;
  const n = path.resolve(p.replace(/^\\\\\?\\/, ''));
  return isWindows ? n.toLowerCase() : n;
}

export const samePath = (a, b) => !!a && !!b && normalize(a) === normalize(b);

// Link type for fs.symlinkSync. Windows folders use junctions, which need no
// admin rights or Developer Mode; macOS ignores the type.
export const linkType = (kind) => (kind === 'dir' ? (isWindows ? 'junction' : 'dir') : 'file');

// Removes a symlink or junction itself, never what it points to.
export function removeLink(p) {
  let st;
  try {
    st = fs.lstatSync(p);
  } catch {
    return;
  }
  if (!st.isSymbolicLink()) throw new Error(`${p} is not a link`);
  try {
    fs.unlinkSync(p);
  } catch (err) {
    // Windows removes folder links and junctions with rmdir; it doesn't
    // follow them, so the target's contents are untouched.
    if (!isWindows) throw err;
    fs.rmdirSync(p);
  }
}

// Whether this machine may create file symlinks. Always true on macOS; on
// Windows it needs Developer Mode or an elevated terminal.
let fileLinksCache;
export function canLinkFiles() {
  // Lets tests simulate a Windows PC without Developer Mode on any OS.
  if (process.env.AI_AGENT_SYNC_NO_FILE_LINKS === '1') return false;
  if (!isWindows) return true;
  if (fileLinksCache !== undefined) return fileLinksCache;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-agent-sync-'));
  try {
    fs.writeFileSync(path.join(dir, 'target'), '');
    fs.symlinkSync(path.join(dir, 'target'), path.join(dir, 'link'), 'file');
    fileLinksCache = true;
  } catch {
    fileLinksCache = false;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return fileLinksCache;
}

export const DEVELOPER_MODE_HELP =
  'Windows only lets programs link files when Developer Mode is on: Settings › System › For developers › Developer Mode. ' +
  'Turn it on, then run this again. Folders sync either way.';

// Turns common Windows errors into something actionable.
export function explain(err) {
  if (isWindows && (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES')) {
    return `${err.message}\n  The file may be open in an app. Close the agent or editor that uses it and run this again.`;
  }
  return err.message;
}

const TRASH_PS = `
Add-Type -AssemblyName Microsoft.VisualBasic
$p = $env:AI_AGENT_SYNC_TRASH_PATH
if (Test-Path -LiteralPath $p -PathType Container) {
  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, 'OnlyErrorDialogs', 'SendToRecycleBin')
} else {
  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin')
}`;

// Moves p into dir, adding a timestamp when the name is taken. Falls back to
// copy + remove across volumes.
function moveInto(p, dir, stamp) {
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(p);
  const base = path.basename(p, ext);
  let dest = path.join(dir, path.basename(p));
  if (fs.existsSync(dest)) dest = path.join(dir, `${base} ${stamp}${ext}`);
  for (let n = 2; fs.existsSync(dest); n++) dest = path.join(dir, `${base} ${stamp}-${n}${ext}`);
  try {
    fs.renameSync(p, dest);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    fs.cpSync(p, dest, { recursive: true, preserveTimestamps: true });
    fs.rmSync(p, { recursive: true, force: true });
  }
  return dest;
}

// Sends p to the Trash (macOS) or Recycle Bin (Windows). Returns where it went.
// AI_AGENT_SYNC_TRASH_DIR overrides the destination (used by tests).
export function trash(p, h, stamp) {
  const override = process.env.AI_AGENT_SYNC_TRASH_DIR;
  if (override) return moveInto(p, override, stamp);
  if (!isWindows) return moveInto(p, path.join(h, '.Trash'), stamp);
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', TRASH_PS], {
    env: { ...process.env, AI_AGENT_SYNC_TRASH_PATH: p },
    encoding: 'utf8',
  });
  if (r.status === 0 && !fs.existsSync(p)) return WORDS.trash;
  // PowerShell unavailable or blocked: keep the file in our own folder instead.
  return moveInto(p, path.join(h, '.ai-agent-sync', 'trash'), stamp);
}
