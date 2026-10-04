#!/usr/bin/env node
// Checks the Node version before loading anything else, so older Node gets a
// clear message instead of a syntax error from a dependency.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 20 || (major === 20 && minor < 12)) {
  console.error(`ai-agent-sync needs Node.js 20.12 or newer (you have ${process.versions.node}).`);
  console.error('Update Node (https://nodejs.org) and run it again.');
  process.exit(1);
}
await import('../src/cli.js');
