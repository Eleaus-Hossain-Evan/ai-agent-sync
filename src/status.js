// Read-only health report for `ai-agent-sync status`.
import fs from 'node:fs';
import path from 'node:path';
import { home, exists } from './paths.js';
import { detectAgents } from './scan.js';

// Per-item health on this Mac.
//   ok        linked to its Dropbox copy
//   broken    linked, but the Dropbox copy is missing
//   elsewhere symlink pointing somewhere else
//   local     real file/folder, not synced
//   missing   not here, but Dropbox has it (sync would link it)
//   absent    on neither side; ignored, like sync does
function itemHealth(item) {
  if (item.state === 'linked') return exists(item.shared) ? 'ok' : 'broken';
  if (item.state === 'link') return 'elsewhere';
  if (item.state === 'real') return 'local';
  return exists(item.shared) ? 'missing' : 'absent';
}

// Agent summary from its items.
//   synced   every item ok
//   partial  some items ok, none broken
//   broken   any item broken
//   off      nothing linked
function agentHealth(items) {
  const relevant = items.filter((i) => i.health !== 'absent');
  if (relevant.some((i) => i.health === 'broken')) return 'broken';
  const ok = relevant.filter((i) => i.health === 'ok').length;
  if (ok && ok === relevant.length) return 'synced';
  return ok ? 'partial' : 'off';
}

// Dropbox "conflicted copy" files anywhere under dir.
export function findConflicts(dir) {
  const out = [];
  const walk = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (/conflicted copy/i.test(e.name)) out.push(p);
      if (e.isDirectory() && !e.isSymbolicLink()) walk(p);
    }
  };
  walk(dir);
  return out;
}

export function computeStatus(agents, root, h = home()) {
  const detected = detectAgents(agents, root, h).map((a) => {
    const items = a.items.map((it) => ({ ...it, health: itemHealth(it) }));
    return { ...a, items, health: agentHealth(items) };
  });

  // Agent folders in Dropbox that this Mac doesn't link to (e.g. synced from the other Mac).
  const used = new Set(detected.filter((a) => a.health !== 'off').map((a) => a.id));
  let inDropbox = [];
  try {
    inDropbox = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !used.has(e.name))
      .map((e) => e.name)
      .sort();
  } catch {
    // no shared folder yet
  }

  return {
    rootExists: exists(root),
    agents: detected,
    notLinkedHere: inDropbox,
    conflicts: exists(root) ? findConflicts(root) : [],
  };
}
