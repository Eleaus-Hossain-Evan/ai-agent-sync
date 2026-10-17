// Built-in registry. Each agent is synced into Dropbox/AIAgentsShared/<id>/,
// one entry per item, stored under the item's basename.
//
// Only instruction files and skill/rule/prompt folders are listed. Settings
// and MCP files (settings.json, mcp.json, opencode.json, ...) are never
// synced: they hold API keys and machine-specific paths.
//
// An agent counts as installed when any `detect` path exists. Lines in
// AIAgentsShared/tools.conf with the same id replace these entries.
//
// Paths: ~ is the home folder on every OS; @appdata / @localappdata are the
// per-user app data folders (see paths.js). An entry may override detect or
// items for Windows under `win32`. Most agents use ~/.<name> everywhere.

import { isWindows } from './platform.js';

const file = (path) => ({ path, kind: 'file' });
const dir = (path) => ({ path, kind: 'dir' });

const REGISTRY = [
  {
    id: 'claude',
    name: 'Claude Code',
    detect: ['~/.claude'],
    items: [file('~/.claude/CLAUDE.md'), dir('~/.claude/skills')],
  },
  {
    id: 'universal',
    name: 'Universal skills',
    detect: ['~/.agents'],
    items: [dir('~/.agents/skills')],
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    detect: ['~/.config/opencode'],
    items: [
      file('~/.config/opencode/AGENTS.md'),
      dir('~/.config/opencode/skills'),
      dir('~/.config/opencode/agents'),
      dir('~/.config/opencode/commands'),
    ],
  },
  {
    id: 'cursor',
    name: 'Cursor',
    detect: ['/Applications/Cursor.app', '@localappdata/Programs/cursor', '~/.cursor'],
    items: [dir('~/.cursor/skills'), dir('~/.cursor/agents')],
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    detect: ['~/.gemini'],
    items: [file('~/.gemini/GEMINI.md')],
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    detect: ['/Applications/Antigravity.app', '@localappdata/Programs/Antigravity', '~/.gemini/antigravity'],
    items: [dir('~/.gemini/antigravity/skills'), dir('~/.gemini/antigravity/global_workflows')],
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    detect: ['/Applications/Windsurf.app', '@localappdata/Programs/Windsurf', '~/.codeium/windsurf'],
    items: [file('~/.codeium/windsurf/memories/global_rules.md'), dir('~/.codeium/windsurf/global_workflows')],
  },
  {
    id: 'vscode-copilot',
    name: 'VS Code (Copilot)',
    detect: ['@appdata/Code/User'],
    items: [dir('@appdata/Code/User/prompts')],
  },
  {
    id: 'copilot-cli',
    name: 'GitHub Copilot CLI',
    detect: ['~/.copilot'],
    items: [dir('~/.copilot/skills')],
  },
  {
    id: 'codex',
    name: 'Codex',
    detect: ['~/.codex'],
    items: [file('~/.codex/AGENTS.md')],
  },
  {
    id: 'kiro',
    name: 'Kiro',
    detect: ['~/.kiro'],
    items: [dir('~/.kiro/steering')],
  },
  {
    id: 'amp',
    name: 'Amp',
    detect: ['~/.config/amp'],
    items: [file('~/.config/amp/AGENTS.md')],
  },
  {
    id: 'qwen',
    name: 'Qwen Code',
    detect: ['~/.qwen'],
    items: [file('~/.qwen/QWEN.md')],
  },
  {
    id: 'zed',
    name: 'Zed',
    detect: ['~/.config/zed'],
    items: [dir('~/.config/zed/prompts')],
    // Zed on Windows keeps settings in %APPDATA%\Zed and data (prompts) in %LOCALAPPDATA%\Zed.
    win32: { detect: ['@appdata/Zed', '@localappdata/Zed'], items: [dir('@localappdata/Zed/prompts')] },
  },
];

// The registry as seen on this OS.
export const BUILTIN_AGENTS = REGISTRY.map(({ win32, ...a }) => (isWindows && win32 ? { ...a, ...win32 } : a));
