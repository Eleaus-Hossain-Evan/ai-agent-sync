#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import * as p from '@clack/prompts';
import pc from 'picocolors';

import { BUILTIN_AGENTS } from '../src/agents.js';
import { findDropbox, sharedRoot, SHARED_DIR_NAME, DROPBOX_INSTALL_URL } from '../src/dropbox.js';
import { readToolsConf, mergeAgents, readIgnore, addToToolsConf, addToIgnore } from '../src/store.js';
import { detectAgents, discoverAgents, itemState } from '../src/scan.js';
import { planItem, applyItem, diffItem, timestamp, ACTION_TEXT, CHANGES, LINK_ACTIONS, UPLOAD_ACTIONS, planUnlink, unlinkItem, UNLINK_TEXT } from '../src/sync.js';
import { installChecker, hookInstalled, checkerPath, HOOK_SNIPPET } from '../src/checker.js';
import { computeStatus, findConflicts } from '../src/status.js';
import { originalOf, conflictDiff, resolveConflict } from '../src/conflicts.js';
import { tilde, exists } from '../src/paths.js';
import { banner, guard, actionColor, compactPaths } from '../src/ui.js';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const args = process.argv.slice(2);

if (args.includes('--version') || args.includes('-v')) {
  console.log(pkg.version);
  process.exit(0);
}
if (args.includes('--help') || args.includes('-h')) {
  console.log(`ai-agent-sync ${pkg.version}

Sync the global rules and skills of your AI coding agents between Macs
through Dropbox. Run it on each Mac: whatever is already in Dropbox is
linked (local copies backed up first); anything else can be uploaded.

Usage:
  npx ai-agent-sync [--dry-run]          Sync agents through Dropbox
  npx ai-agent-sync unlink [--dry-run]   Restore real files on this Mac
  npx ai-agent-sync status               Show what is synced, broken or conflicted
  npx ai-agent-sync resolve [--dry-run]  Fix Dropbox conflicted copies

Options:
  --dry-run   Scan and show the plan without changing anything
  -h, --help  Show this help
  -v, --version`);
  process.exit(0);
}
const dryRun = args.includes('--dry-run');

const command = args[0] && !args[0].startsWith('-') ? args[0] : 'sync';
if (!['sync', 'unlink', 'status', 'resolve'].includes(command)) {
  console.error(`Unknown command "${command}". Run ai-agent-sync --help.`);
  process.exit(1);
}
// status only reports, so it also works in scripts and CI logs.
if (command !== 'status' && (!process.stdin.isTTY || !process.stdout.isTTY)) {
  console.error('ai-agent-sync is interactive. Run it in a terminal.');
  process.exit(1);
}
if (process.platform !== 'darwin') {
  console.error('ai-agent-sync currently supports macOS only.');
  process.exit(1);
}

// "(~/.claude/{CLAUDE.md, skills})" label suffix.
const paths = (items) => pc.dim(`(${compactPaths(items.map((i) => tilde(i.local ?? i.path)))})`);

// Shared start of every command: banner, Dropbox, registry + tools.conf.
// Without a spinner (status), progress lines are simply not shown.
function setup(s = { start() {}, stop() {}, error() {} }) {
  banner(pkg.version, dryRun);
  s.start('Looking for Dropbox');
  const dropbox = findDropbox();
  if (!dropbox) {
    s.error('Dropbox not found');
    p.cancel(`Install Dropbox from ${DROPBOX_INSTALL_URL}, sign in, then run this again.`);
    process.exit(1);
  }
  const root = sharedRoot(dropbox);
  const confFile = path.join(root, 'tools.conf');
  s.stop(`Dropbox: ${pc.dim(tilde(root))}`);
  return { root, confFile, ignoreFile: path.join(root, 'tools.ignore'), agents: mergeAgents(BUILTIN_AGENTS, readToolsConf(confFile)) };
}

async function main() {
  const s = p.spinner();
  const { root, confFile, ignoreFile, agents } = setup(s);

  // Scan and plan every item: the Dropbox copy wins, local-only items can be uploaded.
  s.start('Scanning ~ for AI agents');
  const detected = detectAgents(agents, root);
  for (const a of detected) for (const it of a.items) it.action = planItem(it);
  const discovered = discoverAgents(agents, readIgnore(ignoreFile));
  const has = (a, set) => a.items.some((it) => set.has(it.action));
  const synced = detected.filter((a) => !has(a, CHANGES) && a.items.some((it) => it.action === 'ok'));
  const toLink = detected.filter((a) => has(a, LINK_ACTIONS));
  const toUpload = detected.filter((a) => has(a, UPLOAD_ACTIONS));
  s.stop(
    `Found ${pc.bold(detected.length + discovered.length)} agents` +
      (synced.length ? pc.dim(` (${synced.length} already synced)`) : ''),
  );

  if (synced.length) p.note(synced.map((a) => `${pc.green('✔')} ${a.name}`).join('\n'), 'Already synced');
  // Keep the Claude conflict checker in place whenever Claude is synced.
  if (!dryRun && detected.some((a) => a.id === 'claude' && a.items.some((it) => it.action === 'ok'))) installChecker(root);
  if (!toLink.length && !toUpload.length && !discovered.length) {
    p.outro('Everything on this Mac is already synced.');
    return;
  }

  const itemsFor = (a, set) => a.items.filter((it) => set.has(it.action));

  // Step 1: link from Dropbox (all checked).
  let linkPicked = new Set();
  if (toLink.length) {
    linkPicked = new Set(
      guard(
        await p.multiselect({
          message: 'Link these agents to their Dropbox copies?',
          options: toLink.map((a) => ({ value: a.id, label: `${a.name} ${paths(itemsFor(a, LINK_ACTIONS))}` })),
          initialValues: toLink.map((a) => a.id),
          required: false,
        }),
      ),
    );
  }

  // Step 2: only on this Mac (all unchecked).
  let uploadPicked = new Set();
  const groups = {};
  if (toUpload.length) {
    groups['On this Mac, not in Dropbox'] = toUpload.map((a) => ({
      value: a.id,
      label: `${a.name} ${paths(itemsFor(a, UPLOAD_ACTIONS))}`,
    }));
  }
  if (discovered.length) {
    groups['Possible agents (not in the registry)'] = discovered.map((a) => ({
      value: `new:${a.id}`,
      label: `${a.name} ${paths(a.items)}`,
    }));
  }
  if (toUpload.length || discovered.length) {
    uploadPicked = new Set(
      guard(
        await p.groupMultiselect({
          message: `${toLink.length ? 'Also sync these from this Mac?' : 'Which agents do you want to sync from this Mac?'} ${pc.dim('(check that Dropbox is "Up to date" first)')}`,
          options: groups,
          initialValues: [],
          required: false,
          selectableGroups: false,
          groupSpacing: 1,
        }),
      ),
    );
  }

  const newAgents = discovered.filter((a) => uploadPicked.has(`new:${a.id}`));
  const notPicked = discovered.filter((a) => !uploadPicked.has(`new:${a.id}`));
  let hide = [];
  if (notPicked.length) {
    hide = guard(
      await p.multiselect({
        message: 'Hide any of the other possible agents from future scans?',
        options: notPicked.map((a) => ({ value: a.detect[0], label: `${a.name} ${pc.dim(`(${a.detect[0]})`)}` })),
        initialValues: [],
        required: false,
      }),
    );
  }

  // What will happen, per step.
  const newDetected = detectAgents(newAgents, root);
  for (const a of newDetected) for (const it of a.items) it.action = planItem(it);
  const linkWork = toLink
    .filter((a) => linkPicked.has(a.id))
    .map((a) => ({ agent: a, items: itemsFor(a, LINK_ACTIONS) }));
  const uploadWork = [...toUpload.filter((a) => uploadPicked.has(a.id)), ...newDetected]
    .map((a) => ({ agent: a, items: itemsFor(a, UPLOAD_ACTIONS) }))
    .filter((w) => w.items.length);
  const work = [...linkWork, ...uploadWork];
  if (!work.length) {
    if (hide.length && !dryRun) addToIgnore(ignoreFile, hide);
    p.outro(hide.length && !dryRun ? `Hidden ${hide.length} folder(s). Nothing else changed.` : 'Nothing selected. Nothing changed.');
    return;
  }

  const width = Math.max(...work.flatMap((w) => w.items.map((it) => tilde(it.local).length)));
  const describe = (it) => {
    if (it.action !== 'replace') return ACTION_TEXT[it.action];
    return diffItem(it) ? 'back up, then link (differs from Dropbox)' : 'back up, then link (same as Dropbox)';
  };
  const section = (title, list) =>
    `${pc.underline(title)}\n\n` +
    list
      .map(
        (w) =>
          `${pc.bold(w.agent.name)}\n` +
          w.items.map((it) => `  ${tilde(it.local).padEnd(width)}  ${actionColor(it.action, describe(it))}`).join('\n'),
      )
      .join('\n\n');
  const sections = [];
  if (linkWork.length) sections.push(section('Link from Dropbox', linkWork));
  if (uploadWork.length) sections.push(section('Upload from this Mac', uploadWork));
  if (newAgents.length) sections.push(pc.dim(`Records ${newAgents.map((a) => a.name).join(', ')} in ${SHARED_DIR_NAME}/tools.conf`));
  if (hide.length) sections.push(pc.dim(`Hides ${hide.join(', ')} from future scans`));
  p.note(sections.join('\n\n'), dryRun ? 'Plan (dry run)' : 'Plan');

  if (dryRun) {
    p.outro('Dry run: nothing changed.');
    return;
  }
  if (!guard(await p.confirm({ message: 'Apply this plan?' }))) {
    p.cancel('Nothing changed.');
    return;
  }

  // Apply
  if (hide.length) addToIgnore(ignoreFile, hide);
  for (const a of newAgents) addToToolsConf(confFile, a);
  const ts = timestamp();
  const backups = [];
  let failed = 0;
  for (const { agent, items } of work) {
    for (const it of items) {
      try {
        const backup = applyItem(it.action, it, ts);
        if (backup) backups.push(backup);
        p.log.success(`${agent.name}: ${tilde(it.local)} ${pc.dim('→')} ${pc.dim(tilde(it.shared))}`);
      } catch (err) {
        failed++;
        p.log.error(`${agent.name}: ${tilde(it.local)}: ${err.message}`);
      }
    }
  }

  // Claude conflict checker
  let hookMissing = false;
  if (work.some((w) => w.agent.id === 'claude') || synced.some((a) => a.id === 'claude')) {
    installChecker(root);
    hookMissing = !hookInstalled();
  }

  // Verify
  const touched = work.flatMap((w) => w.items);
  const linked = touched.filter((it) => itemState(it.local, it.shared) === 'linked' && exists(it.local)).length;
  p.log.step(`${linked}/${touched.length} items linked to Dropbox${failed ? pc.red(`, ${failed} failed`) : ''}`);
  if (backups.length) p.note(backups.map((b) => tilde(b)).join('\n'), 'Backups (delete once you have checked them)');
  if (hookMissing) p.note(`Add this to ~/.claude/settings.json so Claude warns about Dropbox conflicts:\n\n${HOOK_SNIPPET}`, 'Claude hook');

  p.outro(
    [
      'Done.',
      `${pc.dim('•')} In Finder, right-click Dropbox › ${SHARED_DIR_NAME} › Make available offline`,
      `${pc.dim('•')} Run ${pc.cyan('npx ai-agent-sync')} on your other Mac too`,
    ].join('\n   '),
  );
}

// `unlink`: replace this Mac's links with real copies of the Dropbox files.
async function unlinkMain() {
  const s = p.spinner();
  const { root, agents } = setup(s);

  s.start('Looking for linked agents');
  const linked = detectAgents(agents, root).filter((a) => a.items.some((i) => i.state === 'linked'));
  s.stop(`Found ${pc.bold(linked.length)} linked agent${linked.length === 1 ? '' : 's'}`);
  if (!linked.length) {
    p.outro('Nothing on this Mac is linked to Dropbox.');
    return;
  }

  const picked = new Set(
    guard(
      await p.multiselect({
        message: 'Which agents do you want to unlink?',
        options: linked.map((a) => ({ value: a.id, label: `${a.name} ${paths(a.items)}` })),
        initialValues: [],
        required: false,
      }),
    ),
  );
  const chosen = linked.filter((a) => picked.has(a.id));
  if (!chosen.length) {
    p.outro('Nothing selected. Nothing changed.');
    return;
  }

  // Plan
  for (const a of chosen) for (const it of a.items) it.action = planUnlink(it);
  const width = Math.max(...chosen.flatMap((a) => a.items.map((it) => tilde(it.local).length)));
  const color = (action, text) => (action === 'restore' ? pc.cyan(text) : pc.yellow(text));
  p.note(
    chosen
      .map(
        (a) =>
          `${pc.bold(a.name)}\n` +
          a.items.map((it) => `  ${tilde(it.local).padEnd(width)}  ${color(it.action, UNLINK_TEXT[it.action])}`).join('\n'),
      )
      .join('\n\n'),
    dryRun ? 'Plan (dry run)' : 'Plan',
  );
  if (dryRun) {
    p.outro('Dry run: nothing changed.');
    return;
  }
  if (!guard(await p.confirm({ message: 'Unlink these agents?' }))) {
    p.cancel('Nothing changed.');
    return;
  }

  // Apply
  const fullyRestored = [];
  let failed = 0;
  for (const a of chosen) {
    let ok = true;
    for (const it of a.items) {
      if (it.action !== 'restore') {
        if (it.action === 'broken') ok = false;
        continue;
      }
      try {
        unlinkItem(it);
        p.log.success(`${a.name}: ${tilde(it.local)} ${pc.dim('restored from Dropbox')}`);
      } catch (err) {
        ok = false;
        failed++;
        p.log.error(`${a.name}: ${tilde(it.local)}: ${err.message}`);
      }
    }
    if (ok) fullyRestored.push(a);
  }

  // Optionally remove the Dropbox copies (default: keep them).
  const folders = fullyRestored.map((a) => path.join(root, a.id)).filter(exists);
  if (folders.length) {
    const names = folders.map((f) => `${SHARED_DIR_NAME}/${path.basename(f)}`).join(', ');
    const remove = guard(
      await p.confirm({
        message: `Also delete ${names} from Dropbox? Your other Mac's links for ${folders.length === 1 ? 'it' : 'them'} will break. Dropbox keeps deleted files recoverable for a while.`,
        initialValue: false,
      }),
    );
    if (remove) {
      for (const f of folders) {
        fs.rmSync(f, { recursive: true, force: true });
        p.log.warn(`Deleted ${tilde(f)}`);
      }
    }
  }

  // Verify
  const after = detectAgents(chosen, root)
    .flatMap((a) => a.items)
    .filter((it) => chosen.some((a) => a.items.some((c) => c.local === it.local && c.action === 'restore')));
  const real = after.filter((it) => it.state === 'real').length;
  p.log.step(`${real}/${after.length} items are real files again${failed ? pc.red(`, ${failed} failed`) : ''}`);
  p.outro(`Done. Run ${pc.cyan('npx ai-agent-sync')} any time to sync again.`);
}

// `status`: read-only report. Exit code 1 when something is broken or conflicted.
async function statusMain() {
  const { root, agents } = setup();
  p.log.info(`Dropbox: ${pc.dim(tilde(root))}`);
  const st = computeStatus(agents, root);

  const ICON = { synced: pc.green('✔'), partial: pc.yellow('◐'), broken: pc.red('✖'), off: pc.dim('○') };
  const LABEL = {
    synced: pc.green('synced'),
    partial: pc.yellow('partly synced'),
    broken: pc.red('broken'),
    off: pc.dim('not synced'),
  };
  const ITEM = {
    broken: pc.red('linked, but the Dropbox copy is missing'),
    elsewhere: pc.yellow('symlink to somewhere else'),
    local: pc.dim('local only'),
    missing: pc.yellow('in Dropbox, not linked here yet'),
  };
  if (st.agents.length) {
    const nameWidth = Math.max(...st.agents.map((a) => a.name.length));
    const shown = st.agents.filter((a) => a.health === 'partial' || a.health === 'broken').flatMap((a) => a.items.filter((i) => i.health !== 'ok' && i.health !== 'absent'));
    const itemWidth = Math.max(0, ...shown.map((i) => tilde(i.local).length));
    const lines = st.agents.map((a) => {
      let line = `${ICON[a.health]} ${a.name.padEnd(nameWidth)}  ${LABEL[a.health]}`;
      if (a.health === 'partial' || a.health === 'broken') {
        for (const it of a.items.filter((i) => i.health !== 'ok' && i.health !== 'absent')) {
          line += `\n    ${tilde(it.local).padEnd(itemWidth)}  ${ITEM[it.health]}`;
        }
      }
      return line;
    });
    p.note(lines.join('\n'), 'Agents on this Mac');
  } else {
    p.log.info('No known AI agents found on this Mac.');
  }

  if (st.notLinkedHere.length) {
    p.note(
      `${st.notLinkedHere.map((id) => `${SHARED_DIR_NAME}/${id}`).join('\n')}\n\n${pc.dim(`Run ${pc.cyan('npx ai-agent-sync')} to link them here.`)}`,
      'In Dropbox, not linked on this Mac',
    );
  }

  if (st.conflicts.length) {
    p.log.error(
      `Dropbox conflicted copies:\n${st.conflicts.map((c) => tilde(c)).join('\n')}\n${pc.dim(`Run ${pc.cyan('npx ai-agent-sync resolve')} to fix them.`)}`,
    );
  } else if (st.rootExists) {
    p.log.success('No Dropbox conflicts');
  }

  const claude = st.agents.find((a) => a.id === 'claude');
  if (claude && claude.health !== 'off') {
    const script = fs.existsSync(checkerPath());
    if (script && hookInstalled()) p.log.success('Claude conflict hook is set up');
    else if (!script) p.log.warn(`Claude conflict checker ${tilde(checkerPath())} is missing. Run ${pc.cyan('npx ai-agent-sync')} to reinstall it.`);
    else p.note(`Add this to ~/.claude/settings.json so Claude warns about Dropbox conflicts:\n\n${HOOK_SNIPPET}`, 'Claude conflict hook is not set up');
  }

  const broken = st.agents.filter((a) => a.health === 'broken').length;
  const problems = broken + (st.conflicts.length ? 1 : 0);
  if (!st.rootExists) {
    p.outro(`Nothing synced yet. Run ${pc.cyan('npx ai-agent-sync')} to start.`);
  } else if (problems) {
    p.outro(
      pc.red(`${problems} problem${problems === 1 ? '' : 's'} found.`) +
        (broken ? ` Run ${pc.cyan('npx ai-agent-sync')} to relink, or ${pc.cyan('unlink')} to restore local files.` : ''),
    );
    process.exitCode = 1;
  } else {
    p.outro('All good.');
  }
}

// `resolve`: walk through Dropbox conflicted copies one by one.
async function resolveMain() {
  const { root } = setup(p.spinner());
  const conflicts = exists(root) ? findConflicts(root).sort() : [];
  if (!conflicts.length) {
    p.outro('No Dropbox conflicts.');
    return;
  }
  p.log.info(`Found ${pc.bold(conflicts.length)} conflicted cop${conflicts.length === 1 ? 'y' : 'ies'}`);

  const MAX_LINES = 30;
  const clip = (text) => {
    const lines = text.split('\n');
    return lines.length <= MAX_LINES ? text : [...lines.slice(0, MAX_LINES), pc.dim(`… ${lines.length - MAX_LINES} more lines`)].join('\n');
  };
  let resolved = 0;
  let kept = 0;
  for (const c of conflicts) {
    if (!exists(c)) continue; // was inside a conflicted folder that is already resolved
    const original = originalOf(c);
    const name = tilde(original);
    let choice;
    if (exists(original)) {
      const diff = conflictDiff(c, original);
      p.note(diff ? clip(diff) : pc.dim('Same content as the current version.'), `${name}: current vs conflicted copy`);
      if (dryRun) continue;
      choice = guard(
        await p.select({
          message: `Which version of ${path.basename(original)} do you want to keep?`,
          options: [
            { value: 'keep-current', label: 'Keep current', hint: 'conflicted copy goes to Trash' },
            { value: 'use-conflicted', label: 'Use the conflicted copy', hint: 'current version goes to Trash' },
            { value: 'keep-both', label: 'Keep both', hint: 'change nothing' },
          ],
        }),
      );
    } else {
      p.note(`${tilde(c)}\n${pc.dim(`There is no ${path.basename(original)} next to it.`)}`, `${name}: original is missing`);
      if (dryRun) continue;
      choice = guard(
        await p.select({
          message: `What should happen to this conflicted copy?`,
          options: [
            { value: 'restore', label: `Restore it as ${path.basename(original)}` },
            { value: 'trash', label: 'Move to Trash' },
            { value: 'keep-both', label: 'Keep as is' },
          ],
        }),
      );
    }
    try {
      const msg = resolveConflict(c, choice);
      if (choice === 'keep-both') {
        kept++;
        p.log.info(msg);
      } else {
        resolved++;
        p.log.success(msg);
      }
    } catch (err) {
      p.log.error(`${tilde(c)}: ${err.message}`);
    }
  }

  if (dryRun) p.outro('Dry run: nothing changed.');
  else p.outro(`${resolved} resolved, ${kept} kept as is.${resolved ? ' Anything replaced is in the Trash.' : ''}`);
}

({ sync: main, unlink: unlinkMain, status: statusMain, resolve: resolveMain })[command]().catch((err) => {
  p.log.error(err.stack || String(err));
  process.exit(1);
});
