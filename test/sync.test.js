import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { BUILTIN_AGENTS } from '../src/agents.js';
import { detectAgents, discoverAgents } from '../src/scan.js';
import { planItem, applyItem, planUnlink, unlinkItem } from '../src/sync.js';
import { readToolsConf, mergeAgents, addToToolsConf, readIgnore, addToIgnore } from '../src/store.js';
import { findDropbox, sharedRoot } from '../src/dropbox.js';
import { computeStatus, findConflicts } from '../src/status.js';
import { originalOf, resolveConflict } from '../src/conflicts.js';
import { expand, tilde, portable } from '../src/paths.js';
import { isWindows, appDataDir, removeLink, linkType } from '../src/platform.js';
import { compare } from '../src/diff.js';

let base, A, B, root;

const write = (p, text = '') => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
};
const read = (p) => fs.readFileSync(p, 'utf8');
const isLink = (p) => fs.lstatSync(p).isSymbolicLink();

// Runs one computer's sync for the given agent ids, answering yes to everything.
function run(h, ids, agents = BUILTIN_AGENTS) {
  const found = detectAgents(agents, root, h).filter((a) => ids.includes(a.id));
  const actions = [];
  for (const a of found) {
    for (const it of a.items) {
      const action = planItem(it);
      actions.push(`${a.id}:${path.basename(it.local)}:${action}`);
      applyItem(action, it, 'TS');
    }
  }
  return actions;
}

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-agent-sync-'));
  A = path.join(base, 'macA');
  B = path.join(base, 'macB');
  const dropbox = path.join(base, 'Dropbox');
  fs.mkdirSync(dropbox);
  for (const h of [A, B]) {
    fs.mkdirSync(h);
    fs.symlinkSync(dropbox, path.join(h, 'Dropbox'), linkType('dir'));
  }
  root = sharedRoot(dropbox);
  // Losing versions go to a known folder, never the real Trash / Recycle Bin.
  process.env.AI_AGENT_SYNC_TRASH_DIR = path.join(A, '.Trash');
  delete process.env.AI_AGENT_SYNC_NO_FILE_LINKS;
});

test('first Mac uploads its items into per-agent folders and links them back', () => {
  write(`${A}/.claude/CLAUDE.md`, 'rules A');
  write(`${A}/.claude/skills/s1/SKILL.md`, 'skill');
  write(`${A}/.gemini/GEMINI.md`, 'gem A');

  const actions = run(A, ['claude', 'gemini']);
  assert.deepEqual(actions, ['claude:CLAUDE.md:upload', 'claude:skills:upload', 'gemini:GEMINI.md:upload']);
  assert.equal(read(`${root}/claude/CLAUDE.md`), 'rules A');
  assert.ok(fs.existsSync(`${root}/claude/skills/s1/SKILL.md`));
  assert.equal(read(`${root}/gemini/GEMINI.md`), 'gem A');
  assert.ok(isLink(`${A}/.claude/CLAUDE.md`) && isLink(`${A}/.claude/skills`));
  assert.equal(read(`${A}/.gemini/GEMINI.md`), 'gem A');
});

test('items missing on both sides are skipped, never created', () => {
  fs.mkdirSync(`${A}/.codeium/windsurf`, { recursive: true });
  assert.deepEqual(run(A, ['windsurf']), ['windsurf:global_rules.md:skip', 'windsurf:global_workflows:skip']);
  assert.ok(!fs.existsSync(`${root}/windsurf`));
  assert.ok(!fs.existsSync(`${A}/.codeium/windsurf/memories/global_rules.md`));
});

test('second Mac: Dropbox wins with a backup, local-only items are uploaded', () => {
  write(`${A}/.claude/CLAUDE.md`, 'rules A');
  write(`${A}/.claude/skills/s1/SKILL.md`, 'skill');
  run(A, ['claude']);

  write(`${B}/.claude/CLAUDE.md`, 'rules B');
  write(`${B}/.codex/AGENTS.md`, 'codex B');
  const actions = run(B, ['claude', 'codex']);
  assert.deepEqual(actions, ['claude:CLAUDE.md:replace', 'claude:skills:link', 'codex:AGENTS.md:upload']);
  assert.equal(read(`${B}/.claude/CLAUDE.md`), 'rules A');
  assert.equal(read(`${B}/.claude/CLAUDE.md.bak-TS`), 'rules B');
  assert.equal(read(`${root}/codex/AGENTS.md`), 'codex B');
  assert.ok(isLink(`${B}/.codex/AGENTS.md`));
  // Mac A's copy in Dropbox is untouched by Mac B.
  assert.equal(read(`${root}/claude/CLAUDE.md`), 'rules A');
});

test('an agent can be partly in Dropbox: linked items and local-only items', () => {
  write(`${A}/.config/opencode/AGENTS.md`, 'oc A');
  run(A, ['opencode']);
  write(`${B}/.config/opencode/AGENTS.md`, 'oc B');
  write(`${B}/.config/opencode/commands/c.md`, 'cmd');
  const plan = detectAgents(BUILTIN_AGENTS, root, B)
    .find((a) => a.id === 'opencode')
    .items.map((it) => `${path.basename(it.local)}:${planItem(it)}`);
  assert.deepEqual(plan, ['AGENTS.md:replace', 'skills:skip', 'agents:skip', 'commands:upload']);
});

test('re-running is idempotent and never nests skills/skills', () => {
  write(`${A}/.claude/CLAUDE.md`, 'rules');
  write(`${A}/.claude/skills/s1/SKILL.md`, 'skill');
  run(A, ['claude']);
  assert.deepEqual(run(A, ['claude']), ['claude:CLAUDE.md:ok', 'claude:skills:ok']);
  fs.mkdirSync(`${B}/.claude`);
  assert.deepEqual(run(B, ['claude']), ['claude:CLAUDE.md:link', 'claude:skills:link']);
  assert.deepEqual(run(B, ['claude']), ['claude:CLAUDE.md:ok', 'claude:skills:ok']);
  assert.ok(!fs.existsSync(`${root}/claude/skills/skills`));
  assert.ok(detectAgents(BUILTIN_AGENTS, root, B).find((a) => a.id === 'claude').synced);
});

test('discovery finds unlisted agents and skips known, ignored and noise folders', () => {
  write(`${A}/.newagent/AGENTS.md`, 'x');
  write(`${A}/.config/otheragent/rules/r.md`, 'x');
  write(`${A}/.shorebird/CLAUDE.md`, 'x');
  write(`${A}/.gemini/GEMINI.md`, 'x'); // registry
  write(`${A}/.claude/CLAUDE.md`, 'x'); // registry
  write(`${A}/.npm/AGENTS.md`, 'x'); // noise
  write(`${A}/.plain/README.md`, 'x'); // not instructions
  write(path.join(appDataDir(A), 'SomeAgent', 'prompts', 'p.md'), 'x');
  const protectedName = isWindows ? 'Microsoft' : 'com.apple.Thing';
  write(path.join(appDataDir(A), protectedName, 'rules', 'r.md'), 'x'); // protected

  const ignored = new Set(['~/.shorebird']);
  const found = discoverAgents(BUILTIN_AGENTS, ignored, A);
  // App data folders are stored as @appdata so the line works on macOS and Windows.
  assert.deepEqual(found.map((a) => a.detect[0]).sort(), ['@appdata/SomeAgent', '~/.config/otheragent', '~/.newagent']);
  const na = found.find((a) => a.id === 'newagent');
  assert.deepEqual(na.items, [{ path: '~/.newagent/AGENTS.md', kind: 'file' }]);
});

test('tools.conf round-trip: discovered agent syncs on both Macs', () => {
  write(`${A}/.newagent/AGENTS.md`, 'new A');
  const conf = `${root}/tools.conf`;
  const [na] = discoverAgents(BUILTIN_AGENTS, new Set(), A);
  addToToolsConf(conf, na);
  addToToolsConf(conf, na); // no duplicate lines
  assert.equal(read(conf).split('\n').filter((l) => l.startsWith('newagent|')).length, 1);

  const agents = mergeAgents(BUILTIN_AGENTS, readToolsConf(conf));
  run(A, ['newagent'], agents);
  assert.equal(read(`${root}/newagent/AGENTS.md`), 'new A');

  // Computer B has the agent folder but a different username/home: ~ paths expand there.
  write(`${B}/.newagent/AGENTS.md`, 'new B');
  assert.deepEqual(discoverAgents(agents, new Set(), B), []); // known via tools.conf
  run(B, ['newagent'], agents);
  assert.equal(read(`${B}/.newagent/AGENTS.md`), 'new A');
});

test('reads tools.conf written by the v3 bash script', () => {
  write(
    `${root}/tools.conf`,
    '# header\nnewagent|newagent|~/.newagent|~/.newagent/AGENTS.md|file\ngemini|My Gemini|~/.gemini|~/.gemini/GEMINI.md|file\n',
  );
  const agents = mergeAgents(BUILTIN_AGENTS, readToolsConf(`${root}/tools.conf`));
  assert.equal(agents.filter((a) => a.id === 'gemini').length, 1);
  assert.equal(agents.find((a) => a.id === 'gemini').name, 'My Gemini');
  assert.ok(agents.some((a) => a.id === 'newagent'));
});

test('tools.ignore and path helpers', () => {
  addToIgnore(`${root}/tools.ignore`, ['~/.shorebird']);
  addToIgnore(`${root}/tools.ignore`, ['~/.shorebird']);
  assert.deepEqual([...readIgnore(`${root}/tools.ignore`)], ['~/.shorebird']);
  assert.equal(expand('~/.x', A), path.join(A, '.x'));
  assert.equal(tilde(path.join(A, '.x', 'y'), A), '~/.x/y'); // always forward slashes
  assert.equal(expand('@appdata/Code/User', A), path.join(appDataDir(A), 'Code', 'User'));
  assert.equal(portable(path.join(appDataDir(A), 'Code', 'User'), A), '@appdata/Code/User');
  assert.equal(portable(path.join(A, '.codex'), A), '~/.codex');
});

test('findDropbox prefers info.json, then the default folders', () => {
  assert.equal(findDropbox(A), path.join(A, 'Dropbox'));
  if (!isWindows) {
    fs.mkdirSync(path.join(A, 'Library', 'CloudStorage', 'Dropbox'), { recursive: true });
    assert.equal(findDropbox(A), path.join(A, 'Library', 'CloudStorage', 'Dropbox'));
  }
  const custom = path.join(base, 'Custom Dropbox');
  fs.mkdirSync(custom);
  const info = isWindows ? path.join(appDataDir(A), 'Dropbox', 'info.json') : path.join(A, '.dropbox', 'info.json');
  write(info, JSON.stringify({ personal: { path: custom } }));
  assert.equal(findDropbox(A), custom);
});

// Unlinks the given agents on one computer; returns "id:basename:action" lines.
function unlink(h, ids, agents = BUILTIN_AGENTS) {
  const out = [];
  for (const a of detectAgents(agents, root, h).filter((x) => ids.includes(x.id))) {
    for (const it of a.items) {
      const action = planUnlink(it);
      out.push(`${a.id}:${path.basename(it.local)}:${action}`);
      if (action === 'restore') unlinkItem(it);
    }
  }
  return out;
}

test('unlink restores real files and dirs and keeps the Dropbox copy', () => {
  write(`${A}/.claude/CLAUDE.md`, 'rules A');
  write(`${A}/.claude/skills/s1/SKILL.md`, 'skill');
  run(A, ['claude']);

  assert.deepEqual(unlink(A, ['claude']), ['claude:CLAUDE.md:restore', 'claude:skills:restore']);
  assert.ok(!isLink(`${A}/.claude/CLAUDE.md`) && !isLink(`${A}/.claude/skills`));
  assert.equal(read(`${A}/.claude/CLAUDE.md`), 'rules A');
  assert.equal(read(`${A}/.claude/skills/s1/SKILL.md`), 'skill');
  assert.equal(read(`${root}/claude/CLAUDE.md`), 'rules A');
  assert.deepEqual(fs.readdirSync(`${A}/.claude`).sort(), ['CLAUDE.md', 'skills']); // no tmp/oldlink leftovers

  // Edits after unlinking stay local.
  write(`${A}/.claude/CLAUDE.md`, 'local only');
  assert.equal(read(`${root}/claude/CLAUDE.md`), 'rules A');
});

test('unlink leaves broken and non-linked items alone', () => {
  write(`${A}/.claude/CLAUDE.md`, 'rules A');
  fs.mkdirSync(`${A}/.claude/skills`);
  run(A, ['claude']);
  fs.rmSync(`${root}/claude/skills`, { recursive: true }); // Dropbox copy gone -> broken link
  write(`${A}/.gemini/GEMINI.md`, 'real, never synced');

  assert.deepEqual(unlink(A, ['claude', 'gemini']), [
    'claude:CLAUDE.md:restore',
    'claude:skills:broken',
    'gemini:GEMINI.md:not-linked',
  ]);
  assert.ok(isLink(`${A}/.claude/skills`)); // untouched
  assert.equal(read(`${A}/.gemini/GEMINI.md`), 'real, never synced');
});

test('sync -> unlink -> sync round-trip on both computers', () => {
  write(`${A}/.gemini/GEMINI.md`, 'gem');
  run(A, ['gemini']);
  fs.mkdirSync(`${B}/.gemini`);
  run(B, ['gemini']);
  assert.deepEqual(unlink(B, ['gemini']), ['gemini:GEMINI.md:restore']);
  assert.equal(read(`${B}/.gemini/GEMINI.md`), 'gem');
  // Computer A is unaffected; re-syncing B backs up its real copy and links again.
  assert.ok(isLink(`${A}/.gemini/GEMINI.md`));
  assert.deepEqual(run(B, ['gemini']), ['gemini:GEMINI.md:replace']);
  assert.ok(isLink(`${B}/.gemini/GEMINI.md`));
});

test('status reports synced, partial, broken and unsynced agents', () => {
  write(`${A}/.claude/CLAUDE.md`, 'rules');
  run(A, ['claude', 'windsurf']); // windsurf not installed -> skipped
  fs.mkdirSync(`${A}/.cursor/skills`, { recursive: true });
  fs.mkdirSync(`${A}/.cursor/agents`);
  run(A, ['cursor']);
  removeLink(path.join(A, '.cursor', 'agents')); // unlink one Cursor item -> partial
  write(`${A}/.gemini/GEMINI.md`, 'local');
  run(A, ['gemini']);
  fs.rmSync(`${root}/gemini/GEMINI.md`); // Dropbox copy gone -> broken
  write(`${A}/.codex/AGENTS.md`, 'never synced');

  const st = computeStatus(BUILTIN_AGENTS, root, A);
  const health = Object.fromEntries(st.agents.map((a) => [a.id, a.health]));
  assert.equal(health.claude, 'synced');
  assert.equal(health.cursor, 'partial');
  assert.equal(health.gemini, 'broken');
  assert.equal(health.codex, 'off');
  assert.equal(st.agents.find((a) => a.id === 'gemini').items[0].health, 'broken');
  assert.deepEqual(st.conflicts, []);
});

test('status lists Dropbox agents not linked here and conflicted copies', () => {
  write(`${A}/.codex/AGENTS.md`, 'codex');
  run(A, ['codex']);
  write(`${root}/codex/AGENTS (Evan's conflicted copy 2026-09-29).md`, 'x');

  const st = computeStatus(BUILTIN_AGENTS, root, B); // computer B: codex not installed/linked
  assert.deepEqual(st.notLinkedHere, ['codex']);
  assert.equal(st.conflicts.length, 1);
  assert.match(st.conflicts[0], /conflicted copy/);

  const none = computeStatus(BUILTIN_AGENTS, path.join(base, 'no-such-root'), A);
  assert.equal(none.rootExists, false);
  assert.deepEqual(none.notLinkedHere, []);
});

test('originalOf strips the Dropbox conflict marker from files and folders', () => {
  const d = (...parts) => path.join(base, ...parts);
  assert.equal(originalOf(d('claude', "CLAUDE (Evan's conflicted copy 2026-10-04).md")), d('claude', 'CLAUDE.md'));
  assert.equal(originalOf(d('gemini', 'GEMINI (conflicted copy 2026-10-04).md')), d('gemini', 'GEMINI.md'));
  assert.equal(originalOf(d('claude', "skills (Mac mini's conflicted copy 2026-10-04)")), d('claude', 'skills'));
});

test('resolveConflict: every choice, losers go to the Trash', () => {
  const trash = process.env.AI_AGENT_SYNC_TRASH_DIR;
  const conflict = (dir, name) => `${root}/${dir}/${name}`;

  // keep-current
  write(`${root}/claude/CLAUDE.md`, 'current');
  write(conflict('claude', "CLAUDE (Evan's conflicted copy 2026-10-04).md"), 'other');
  resolveConflict(conflict('claude', "CLAUDE (Evan's conflicted copy 2026-10-04).md"), 'keep-current', A);
  assert.equal(read(`${root}/claude/CLAUDE.md`), 'current');
  assert.equal(read(`${trash}/CLAUDE (Evan's conflicted copy 2026-10-04).md`), 'other');

  // use-conflicted: the previous version goes to Trash
  write(conflict('claude', 'CLAUDE (conflicted copy 2026-10-05).md'), 'newer');
  resolveConflict(conflict('claude', 'CLAUDE (conflicted copy 2026-10-05).md'), 'use-conflicted', A);
  assert.equal(read(`${root}/claude/CLAUDE.md`), 'newer');
  assert.equal(read(`${trash}/CLAUDE.md`), 'current');

  // a second CLAUDE.md in the Trash gets a timestamped name instead of overwriting
  write(conflict('claude', 'CLAUDE (conflicted copy 2026-10-06).md'), 'newest');
  resolveConflict(conflict('claude', 'CLAUDE (conflicted copy 2026-10-06).md'), 'use-conflicted', A);
  assert.equal(read(`${trash}/CLAUDE.md`), 'current');
  assert.equal(fs.readdirSync(trash).filter((n) => n.startsWith('CLAUDE ') && !n.includes('conflicted')).length, 1);

  // restore an orphan, trash another, keep a third
  write(conflict('gemini', 'GEMINI (conflicted copy 2026-10-04).md'), 'gem');
  resolveConflict(conflict('gemini', 'GEMINI (conflicted copy 2026-10-04).md'), 'restore', A);
  assert.equal(read(`${root}/gemini/GEMINI.md`), 'gem');
  write(conflict('codex', 'AGENTS (conflicted copy 2026-10-04).md'), 'x');
  resolveConflict(conflict('codex', 'AGENTS (conflicted copy 2026-10-04).md'), 'trash', A);
  write(conflict('qwen', 'QWEN (conflicted copy 2026-10-04).md'), 'y');
  resolveConflict(conflict('qwen', 'QWEN (conflicted copy 2026-10-04).md'), 'keep-both', A);

  assert.deepEqual(findConflicts(root).map((p) => path.basename(p)), ['QWEN (conflicted copy 2026-10-04).md']);
});

test('removing a link never deletes the files behind it', () => {
  const target = path.join(base, 'target');
  write(path.join(target, 'keep.md'), 'keep');
  const link = path.join(A, 'link');
  fs.symlinkSync(target, link, linkType('dir'));
  removeLink(link);
  assert.ok(!fs.existsSync(link));
  assert.equal(read(path.join(target, 'keep.md')), 'keep');
  assert.throws(() => removeLink(target)); // refuses real folders
});

test('without file links (Windows, no Developer Mode) nothing is moved', () => {
  process.env.AI_AGENT_SYNC_NO_FILE_LINKS = '1';
  write(`${A}/.claude/CLAUDE.md`, 'rules A');
  write(`${A}/.claude/skills/s1/SKILL.md`, 'skill');
  const [claude] = detectAgents(BUILTIN_AGENTS, root, A);
  const [md, skills] = claude.items;
  assert.throws(() => applyItem(planItem(md), md, 'TS'), /Developer Mode/);
  assert.equal(read(`${A}/.claude/CLAUDE.md`), 'rules A'); // untouched
  assert.ok(!fs.existsSync(`${root}/claude/CLAUDE.md`));
  applyItem(planItem(skills), skills, 'TS'); // folders still sync
  assert.ok(isLink(`${A}/.claude/skills`));
});

test('compare: unified diff for files, one line per difference for folders', () => {
  write(`${A}/a.md`, 'one\ntwo\n');
  write(`${A}/b.md`, 'one\nthree\n');
  write(`${A}/same.md`, 'one\ntwo\n');
  assert.equal(compare(`${A}/a.md`, `${A}/same.md`, 'x', 'y'), '');
  assert.equal(compare(`${A}/a.md`, `${A}/b.md`, 'this computer', 'Dropbox'), '--- this computer\n+++ Dropbox\n@@ -1,2 +1,2 @@\n one\n-two\n+three');
  write(`${A}/d1/x.md`, '1');
  write(`${A}/d1/only1.md`, '1');
  write(`${A}/d2/x.md`, '2');
  write(`${A}/d2/sub/only2.md`, '2');
  assert.equal(
    compare(`${A}/d1`, `${A}/d2`, 'this computer', 'Dropbox'),
    'Only in this computer: only1.md\nOnly in Dropbox: sub/\nOnly in Dropbox: sub/only2.md\nFiles differ: x.md',
  );
});
