import * as p from '@clack/prompts';
import pc from 'picocolors';

export function banner(version, dryRun) {
  console.log();
  p.intro(`${pc.bgCyan(pc.black(' ai-agent-sync '))} ${pc.dim('v' + version)}${dryRun ? ' ' + pc.yellow('dry run') : ''}`);
}

// Ends the run cleanly when the user presses Ctrl+C / Esc at a prompt.
export function guard(value) {
  if (p.isCancel(value)) {
    p.cancel('Cancelled. Nothing changed.');
    process.exit(0);
  }
  return value;
}

// ["~/.x/a", "~/.x/b"] -> "~/.x/{a, b}", so a row fits on one line.
export function compactPaths(paths) {
  const dirs = new Set(paths.map((p) => p.slice(0, p.lastIndexOf('/'))));
  if (paths.length < 2 || dirs.size > 1) return paths.join(', ');
  const [dir] = dirs;
  return `${dir}/{${paths.map((p) => p.slice(dir.length + 1)).join(', ')}}`;
}

const WARN_ACTIONS = new Set(['leave']);

export const actionColor = (action, text) =>
  action === 'ok' ? pc.green(text) : WARN_ACTIONS.has(action) ? pc.yellow(text) : pc.cyan(text);
