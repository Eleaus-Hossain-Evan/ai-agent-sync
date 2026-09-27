# ai-agent-sync

Keep the global rules and skills of **every AI coding agent** in sync between your devices, through Dropbox.

```sh
npx ai-agent-sync
```

Claude Code, Cursor, Codex, Gemini CLI, Antigravity, OpenCode, Windsurf, VS Code Copilot, Copilot CLI, Kiro, Amp, Qwen Code, Zed, and any agent released next.

<p align="center">
  <img src="https://raw.githubusercontent.com/Eleaus-Hossain-Evan/ai-agent-sync/main/docs/demo.gif" alt="ai-agent-sync demo: scan, pick agents from one checklist, review the plan, apply" width="720">
</p>

## Why

> **Multi-device synchronization**

AI agents read instructions at two levels:

| Level | Examples | Synced across devices? |
|---|---|---|
| **Project** | `CLAUDE.md`, `AGENTS.md`, `.claude/skills` in the repo | Yes, through Git |
| **User (global)** | `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.cursor/skills` … | **No**, they stay on each device |

So when you open **the same project on a different device**, the agent works from different global instructions and skills, and **gives different output**.

**Why not Git?** Every agent keeps its config in its own folder, and those folders are full of things that must not be shared: MCP settings, `settings.json`, `opencode.json` (which may contain API keys), caches and session data. Only a handful of files need syncing, and committing and pulling after every edit is friction you shouldn't need.

**Why file sync?** A file-based service such as Dropbox, Google Drive or OneDrive fits this job: it mirrors every change to the cloud and to your other devices automatically. `ai-agent-sync` uses **Dropbox**.

## Quick start

1. Install [Dropbox](https://www.dropbox.com/install) on both Macs, sign in, and set the default sync state to **Available offline** (see [How it works](#how-it-works)).
2. On the Mac with the files you want to keep:
   ```sh
   npx ai-agent-sync      # choose "Primary"
   ```
3. Wait until Dropbox shows **Up to date**, then on the other Mac:
   ```sh
   npx ai-agent-sync      # choose "Secondary"
   ```

Try `npx ai-agent-sync --dry-run` first: it scans and shows the plan without changing anything.

## How it works

`ai-agent-sync` moves each agent's global files (`CLAUDE.md`, `AGENTS.md`, skills, rules, instructions and prompts) into Dropbox and leaves a **symlink** at the original location.

```
~/.claude/CLAUDE.md  ──symlink──▶  Dropbox/AIAgentsShared/claude/CLAUDE.md  ◀──sync──▶  other devices
```

1. **The agent reads and writes its usual path.** macOS resolves the symlink, so every read and edit actually happens in the Dropbox copy. The agent doesn't notice any difference.
2. **Dropbox uploads the change** to the cloud as soon as the file is saved.
3. **Your other device downloads it** as soon as Dropbox runs there, and its agents pick up the updated config.

> [!IMPORTANT]
> Make the files **available offline**, so they are always on disk and never online-only placeholders. In the Dropbox app, open **Settings › Account › Sync & storage** and set the default sync state to **Available offline**, or right-click `Dropbox/AIAgentsShared` in Finder and choose **Make available offline**.

The shared folder is organized by agent:

```
Dropbox/AIAgentsShared/
├── claude/        CLAUDE.md, skills/
├── gemini/        GEMINI.md
├── cursor/        skills/, agents/
├── <agent>/       one folder per agent
├── tools.conf     agents found by discovery
└── tools.ignore   folders you chose to hide
```

- **Primary** moves each selected file or folder into `AIAgentsShared/<agent>/` and links it back.
- **Secondary** shows a diff against the Dropbox copy, asks, keeps a `.bak-<timestamp>` backup, then links.
- Nothing is overwritten in Dropbox. Re-running is safe; synced agents are listed as *Already synced*.

## New agents, automatically

Besides the built-in registry, every run scans the hidden folders in `~`, `~/.config` and `~/Library/Application Support` for anything that looks like an agent (`AGENTS.md`, `QWEN.md`-style files, `skills/`, `rules/`, `prompts/`, `steering/`, `workflows/`). They appear under **Possible agents**:

- **Select** one and it is recorded in `AIAgentsShared/tools.conf` and synced. The other Mac reads the same file, so it knows the agent too.
- **Hide** false matches once; they go to `tools.ignore` and never show again.

The scan takes well under a second, never walks your Documents or projects, and skips folders protected by macOS privacy settings.

## What is never synced

Settings and MCP files (`settings.json`, `mcp.json`, `opencode.json`, `config.toml` …). They hold API keys, tokens and machine-specific paths. Only instructions, rules, prompts, skills and workflows are synced.

## Claude Code conflict warning

If Claude is synced, `~/.claude/check-dropbox-conflicts.sh` is installed. Add the `SessionStart` hook the CLI prints, and Claude will tell you whenever Dropbox creates a *conflicted copy* of your config.

## Supported agents

| Agent | Synced |
|---|---|
| Claude Code | `~/.claude/CLAUDE.md`, `~/.claude/skills` |
| Universal skills | `~/.agents/skills` |
| OpenCode | `~/.config/opencode/{AGENTS.md, skills, agents, commands}` |
| Cursor | `~/.cursor/{skills, agents}` |
| Gemini CLI | `~/.gemini/GEMINI.md` |
| Antigravity | `~/.gemini/antigravity/{skills, global_workflows}` |
| Windsurf | `~/.codeium/windsurf/memories/global_rules.md`, `global_workflows` |
| VS Code (Copilot) | `~/Library/Application Support/Code/User/prompts` |
| GitHub Copilot CLI | `~/.copilot/skills` |
| Codex | `~/.codex/AGENTS.md` |
| Kiro | `~/.kiro/steering` |
| Amp | `~/.config/amp/AGENTS.md` |
| Qwen Code | `~/.qwen/QWEN.md` |
| Zed | `~/.config/zed/prompts` |

Missing one? Discovery usually finds it. To add it for everyone, open a PR against [`src/agents.js`](src/agents.js): one entry per agent.

## Requirements

macOS, Node.js 18+, Dropbox desktop app.

## Development

```sh
npm install
npm test                    # node:test, temp home folders, no real files touched
node bin/cli.js --dry-run
```

## License

MIT
