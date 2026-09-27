#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import * as p from '@clack/prompts';
import pc from 'picocolors';

import { BUILTIN_AGENTS } from '../src/agents.js';
import { findDropbox, sharedRoot, SHARED_DIR_NAME, DROPBOX_INSTALL_URL } from '../src/dropbox.js';
import { readToolsConf, mergeAgents, readIgnore, addToToolsConf, addToIgnore } from '../src/store.js';
import { detectAgents, discoverAgents } from '../src/scan.js';
import { planItem, applyItem, diffItem, timestamp, ACTION_TEXT, CHANGES } from '../src/sync.js';
import { installChecker, hookInstalled, HOOK_SNIPPET } from '../src/checker.js';
import { tilde, exists } from '../src/paths.js';
import { banner, guard, truncate, actionColor, compactPaths } from '../src/ui.js';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const args = process.argv.slice(2);

if (args.includes('--version') || args.includes('-v')) {
  console.log(pkg.version);
  process.exit(0);
}
if (args.includes('--help') || args.includes('-h')) {
  console.log(`ai-agent-sync ${pkg.version}

Sync the global rules and skills of your AI coding agents between Macs
through Dropbox. Run it on each Mac: once as Primary, then as Secondary.

Usage:
  npx ai-agent-sync [--dry-run]

Options:
  --dry-run   Scan and show the plan without changing anything
  -h, --help  Show this help
  -v, --version`);
  process.exit(0);
}
const dryRun = args.includes('--dry-run');

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error('ai-agent-sync is interactive. Run it in a terminal.');
  process.exit(1);
}
if (process.platform !== 'darwin') {
  console.error('ai-agent-sync currently supports macOS only.');
  process.exit(1);
}

const WAIT_SECONDS = 300;

async function main() {
  banner(pkg.version, dryRun);
  const s = p.spinner();

  // 1. Dropbox
  s.start('Looking for Dropbox');
  const dropbox = findDropbox();
  if (!dropbox) {
    s.error('Dropbox not found');
    p.cancel(`Install Dropbox from ${DROPBOX_INSTALL_URL}, sign in, then run this again.`);
    process.exit(1);
  }
  const root = sharedRoot(dropbox);
  const confFile = path.join(root, 'tools.conf');
  const ignoreFile = path.join(root, 'tools.ignore');
  s.stop(`Dropbox: ${pc.dim(tilde(root))}`);

  // 2. Scan
  s.start('Scanning ~ for AI agents');
  const agents = mergeAgents(BUILTIN_AGENTS, readToolsConf(confFile));
  const detected = detectAgents(agents, root);
  const discovered = discoverAgents(agents, readIgnore(ignoreFile));
  const synced = detected.filter((a) => a.synced);
  const pending = detected.filter((a) => !a.synced);
  s.stop(
    `Found ${pc.bold(detected.length + discovered.length)} agents` +
      (synced.length ? pc.dim(` (${synced.length} already synced)`) : ''),
  );

  if (synced.length) p.note(synced.map((a) => `${pc.green('✔')} ${a.name}`).join('\n'), 'Already synced');
  if (!pending.length && !discovered.length) {
    p.outro('Everything on this Mac is already synced.');
    return;
  }

  // 3. Role
  const role = guard(
    await p.select({
      message: 'What is this Mac?',
      options: [
        { value: 'primary', label: 'Primary', hint: 'has the real files; they move into Dropbox' },
        { value: 'secondary', label: 'Secondary', hint: 'links to the copies already in Dropbox' },
      ],
    }),
  );

  // 4. Checklist (all unchecked)
  const paths = (items) => pc.dim(`(${compactPaths(items.map((i) => tilde(i.local ?? i.path)))})`);
  const groups = {};
  if (pending.length) {
    groups['Detected agents'] = pending.map((a) => ({ value: a.id, label: `${a.name} ${paths(a.items)}` }));
  }
  if (discovered.length) {
    groups['Possible agents (not in the registry)'] = discovered.map((a) => ({
      value: `new:${a.id}`,
      label: `${a.name} ${paths(a.items)}`,
    }));
  }
  const picked = new Set(
    guard(
      await p.groupMultiselect({
        message: 'Which agents do you want to sync?',
        options: groups,
        initialValues: [],
        required: false,
        selectableGroups: false,
        groupSpacing: 1,
      }),
    ),
  );

  const newAgents = discovered.filter((a) => picked.has(`new:${a.id}`));
  const notPicked = discovered.filter((a) => !picked.has(`new:${a.id}`));
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

  const chosen = [
    ...pending.filter((a) => picked.has(a.id)),
    ...detectAgents(newAgents, root),
  ];
  if (!chosen.length) {
    if (hide.length && !dryRun) addToIgnore(ignoreFile, hide);
    p.outro(hide.length && !dryRun ? `Hidden ${hide.length} folder(s). Nothing else changed.` : 'Nothing selected. Nothing changed.');
    return;
  }

  // 5. Secondary: Claude's files must arrive from the primary first.
  const claude = chosen.find((a) => a.id === 'claude');
  if (role === 'secondary' && claude && !dryRun && !claude.items.every((i) => exists(i.shared))) {
    s.start(`Waiting for Claude's files to arrive from Dropbox (up to ${WAIT_SECONDS / 60} min)`);
    const start = Date.now();
    while (!claude.items.every((i) => exists(i.shared)) && Date.now() - start < WAIT_SECONDS * 1000) {
      await sleep(2000);
    }
    const arrived = claude.items.every((i) => exists(i.shared));
    if (arrived) s.stop("Claude's files are in Dropbox");
    else s.error("Claude's files have not arrived yet");
  }

  // 6. Plan
  for (const a of chosen) for (const it of a.items) it.action = planItem(role, it);
  const width = Math.max(...chosen.flatMap((a) => a.items.map((it) => tilde(it.local).length)));
  const planLines = chosen.map(
    (a) =>
      `${pc.bold(a.name)}\n` +
      a.items
        .map((it) => `  ${tilde(it.local).padEnd(width)}  ${actionColor(it.action, ACTION_TEXT[it.action])}`)
        .join('\n'),
  );
  if (newAgents.length) planLines.push(pc.dim(`Records ${newAgents.map((a) => a.name).join(', ')} in ${SHARED_DIR_NAME}/tools.conf`));
  if (hide.length) planLines.push(pc.dim(`Hides ${hide.join(', ')} from future scans`));
  p.note(planLines.join('\n\n'), dryRun ? 'Plan (dry run)' : 'Plan');

  if (dryRun) {
    p.outro('Dry run: nothing changed.');
    return;
  }
  const changes = chosen.flatMap((a) => a.items).filter((it) => CHANGES.has(it.action));
  if (!changes.length && !newAgents.length && !hide.length) {
    p.outro('Nothing to change.');
    return;
  }
  if (!guard(await p.confirm({ message: 'Apply this plan?' }))) {
    p.cancel('Nothing changed.');
    return;
  }

  // 7. Apply
  if (hide.length) addToIgnore(ignoreFile, hide);
  for (const a of newAgents) addToToolsConf(confFile, a);

  const ts = timestamp();
  const backups = [];
  let failed = 0;
  for (const a of chosen) {
    for (const it of a.items) {
      if (!CHANGES.has(it.action)) continue;
      const where = tilde(it.local);
      if (it.action === 'upload') {
        const ok = guard(await p.confirm({ message: `${where} is only on this Mac. Move it into Dropbox?` }));
        if (!ok) {
          p.log.info(`${a.name}: skipped ${where}`);
          continue;
        }
      }
      if (it.action === 'replace') {
        const diff = diffItem(it);
        if (diff) {
          p.note(truncate(diff), `${where}: this Mac vs Dropbox`);
          const ok = guard(await p.confirm({ message: `Replace ${where} with a link to the Dropbox copy? (a backup is kept)` }));
          if (!ok) {
            p.log.info(`${a.name}: skipped ${where}`);
            continue;
          }
        }
      }
      try {
        const backup = applyItem(it.action, it, ts);
        if (backup) backups.push(backup);
        p.log.success(`${a.name}: ${where} ${pc.dim('→')} ${pc.dim(tilde(it.shared))}`);
      } catch (err) {
        failed++;
        p.log.error(`${a.name}: ${where}: ${err.message}`);
      }
    }
  }

  // 8. Claude conflict checker
  let hookMissing = false;
  if (claude || synced.some((a) => a.id === 'claude')) {
    installChecker(root);
    hookMissing = !hookInstalled();
  }

  // 9. Verify
  const after = detectAgents(chosen, root).flatMap((a) => a.items);
  const linked = after.filter((i) => i.state === 'linked').length;
  const broken = after.filter((i) => i.state === 'linked' && !exists(i.local));
  for (const b of broken) p.log.error(`Broken link: ${tilde(b.local)}`);
  p.log.step(`${linked}/${after.length} items linked to Dropbox${failed ? pc.red(`, ${failed} failed`) : ''}`);
  if (backups.length) p.note(backups.map((b) => tilde(b)).join('\n'), 'Backups (delete once you have checked them)');
  if (hookMissing) p.note(`Add this to ~/.claude/settings.json so Claude warns about Dropbox conflicts:\n\n${HOOK_SNIPPET}`, 'Claude hook');

  p.outro(
    [
      'Done.',
      `${pc.dim('•')} In Finder, right-click Dropbox › ${SHARED_DIR_NAME} › Make available offline`,
      role === 'primary'
        ? `${pc.dim("•")} When Dropbox is "Up to date", run ${pc.cyan("npx ai-agent-sync")} on your other Mac`
        : `${pc.dim('•')} Agents added on the other Mac later: just run ${pc.cyan('npx ai-agent-sync')} again`,
    ].join('\n   '),
  );
}

main().catch((err) => {
  p.log.error(err.stack || String(err));
  process.exit(1);
});
