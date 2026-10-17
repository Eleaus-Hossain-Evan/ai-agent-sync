# Windows support: audit and plan

Status: **plan only, no code changed.** Based on `ai-agent-sync` 0.5.1 (commit after `6077e38`).

## Goal

The same `npx ai-agent-sync` works on macOS and Windows. A Mac and a Windows PC can share one `Dropbox/AIAgentsShared` folder. Dropbox syncs the content, and each machine keeps its own links pointing into Dropbox.

## How the core idea maps to Windows

| macOS today | Windows |
|---|---|
| A symlink at the agent's path points into Dropbox | **Folders:** NTFS *junction*, which needs no admin rights. **Files:** a real symlink, which needs **Developer Mode** (or an elevated terminal). |
| Dropbox at `~/Library/CloudStorage/Dropbox` or `~/Dropbox` | `info.json` in `%APPDATA%\Dropbox\` or `%LOCALAPPDATA%\Dropbox\`, else `%USERPROFILE%\Dropbox` |
| `~/.Trash` | Recycle Bin |
| `diff` command | Not available, so the comparison has to be done in JavaScript |
| Conflict checker: a bash `.sh` script | A Node script, the same on both OSes |

Hard links are **not** an option for files. Dropbox, and most editors, save a file by writing a new copy and swapping it in. That silently breaks a hard link, after which the two copies drift apart without any warning.

## Audit: every Windows blocker found

### Blockers: it won't install or run at all

| Where | Problem | Fix |
|---|---|---|
| [package.json](../package.json) `"os": ["darwin"]` | npm refuses to install on Windows (`EBADPLATFORM`) | `["darwin", "win32"]` |
| [src/cli.js:55](../src/cli.js) | Exits with "supports macOS only" | Allow `win32` |

### Linking (the core)

| Where | Problem | Fix |
|---|---|---|
| [src/sync.js:63](../src/sync.js) `link()` | `fs.symlinkSync(shared, tmp)` has no type. Windows needs `'junction'` for folders, and a file symlink fails with `EPERM` unless Developer Mode is on. | Pick the type per item: `junction` for dirs, `file` for files. Turn `EPERM` into a clear "turn on Developer Mode" message. |
| [src/sync.js:68](../src/sync.js) | `rename(tmp, local)` can't replace an existing folder link on Windows | On Windows, remove the old link first, then create the new one. This is a short non-atomic window, but it's safe because the data is in Dropbox. |
| [src/sync.js:101](../src/sync.js) `unlinkItem`, `fs.rmSync(oldLink)` | Removing a folder symlink or junction needs `rmdir`, not `unlink`, and a recursive remove on a junction must never be used | New `removeLink(p)`: lstat → `unlinkSync` or `rmdirSync`, never recursive |
| [src/scan.js:28](../src/scan.js) `itemState` | `readlink(local) === shared` is an exact string comparison. Windows may return a `\\?\` prefix, a different case or different slashes. | Normalize both sides: resolve, strip `\\?\`, compare case-insensitively on win32 |
| [src/sync.js](../src/sync.js) move/rename | Windows locks open files, so a rename fails with `EBUSY`/`EPERM` while an agent has the file open | Catch it and say "close <agent> and run again". The item is skipped and the others continue. |

### Paths

| Where | Problem | Fix |
|---|---|---|
| [src/paths.js:16](../src/paths.js) `tilde()` | Produces `~/.claude\CLAUDE.md` (mixed slashes). These strings are written to the **shared** `tools.conf` and `tools.ignore`. | Always output forward slashes, so lines written on Windows and on a Mac are identical |
| [src/paths.js:9](../src/paths.js) `expand()` | Only understands `~` | Also understand per-OS tokens such as `@appdata` (see Registry) |
| [src/store.js:33](../src/store.js) | Detect paths are colon-separated, so a Windows path like `C:\…` would split in two | Never store drive letters: use `~` and the tokens only, and say so in the `tools.conf` header |
| [src/scan.js:117](../src/scan.js) `isKnown`, `startsWith` | Case-sensitive comparison, while Windows paths aren't case-sensitive | Compare lowercased on win32 |
| [src/ui.js:20](../src/ui.js) `compactPaths` | Splits on `/` | Fine once `tilde()` always uses `/` |

### Agent registry ([src/agents.js](../src/agents.js))

Most agents use the same `~/.<name>` folder on Windows (`%USERPROFILE%\.claude`, `.codex`, `.gemini`, `.cursor`, `.copilot`, `.kiro`, `.qwen`, `.agents`, `.codeium\windsurf`). OpenCode user logs show `~/.config/opencode` on Windows too.

These need per-OS handling:

| Agent | macOS | Windows |
|---|---|---|
| VS Code (Copilot) | `~/Library/Application Support/Code/User/prompts` | `%APPDATA%\Code\User\prompts` |
| Zed | `~/.config/zed/prompts` | `%APPDATA%\Zed\…` (Zed's docs put its settings there) |
| Cursor / Windsurf / Antigravity app detection | `/Applications/X.app` | `%LOCALAPPDATA%\Programs\…`. Optional: their `~/.x` folders already detect them. |

Approach: add a small path token, `@appdata/…`, which expands to `~/Library/Application Support` on macOS and `%APPDATA%` on Windows. Paths listed under a `darwin:` or `win32:` key apply only on that OS. A registry entry stays a single entry.

**Mixed Mac + Windows** works because items are stored by agent id and file name (`AIAgentsShared/vscode-copilot/prompts`), not by local path, so both machines link to the same Dropbox copy.

### Dropbox location ([src/dropbox.js](../src/dropbox.js))

- `info.json` is only read from `~/.dropbox/` (macOS). On Windows it's in `%APPDATA%\Dropbox\info.json` or `%LOCALAPPDATA%\Dropbox\info.json`.
- The fallback list has no Windows default (`%USERPROFILE%\Dropbox` works through `path.join`, but should be tested).

### External commands

| Where | Problem | Fix |
|---|---|---|
| [src/sync.js:49](../src/sync.js) `diffItem`, [src/conflicts.js:20](../src/conflicts.js) `conflictDiff` | `spawnSync('diff')` doesn't exist on Windows, so `.stdout` is `null` and **the program crashes** (`TypeError`) | Compare in JavaScript on every OS. Use the small, widely used `diff` package (jsdiff) for the unified text diff, plus our own recursive folder comparison. The output stays the same and works on both OSes. |

### Trash ([src/conflicts.js:34](../src/conflicts.js) `moveToTrash`)

- `~/.Trash` doesn't exist on Windows. Today the code would quietly create a plain folder called `.Trash` in the home folder.
- Fix on Windows: send the item to the **Recycle Bin** through PowerShell (`Microsoft.VisualBasic.FileIO.FileSystem` with `SendToRecycleBin`). If that fails, fall back to a `~/.ai-agent-sync/trash/<timestamp>/` folder and print where things went.

### Claude conflict checker ([src/checker.js](../src/checker.js))

- It writes a **bash** script, and the hook snippet runs `bash "$HOME/…sh"`. Neither works in Windows' default shell, and `$HOME` isn't expanded there.
- Fix: write `check-dropbox-conflicts.mjs`, run it as `node "<absolute path>"`, and generate the snippet per machine.
- `hookInstalled()` matches the name prefix `check-dropbox-conflicts`, so Macs with the existing `.sh` hook keep working, and the `.sh` file keeps being refreshed there.

### Discovery ([src/scan.js:85](../src/scan.js))

- Hidden `~/.something` folders exist on Windows too, so that part works.
- `~/Library/Application Support` becomes `%APPDATA%` on Windows. It needs a Windows skip list (`Microsoft`, `Packages`, `Temp`, …) in place of the macOS privacy list, so the scan stays fast and quiet.
- Old Windows junctions in the profile (`Application Data`, `Cookies`, …) refuse to be read; the existing `try/catch` already skips them.

### Wording

There are about 20 strings like "this Mac", "your other Mac", "Finder" and "macOS Trash" ([src/cli.js](../src/cli.js), [README.md](../README.md)).

- Use "this computer" / "your other computer".
- "Finder" becomes "File Explorer" on Windows, and "Trash" becomes "Recycle Bin", chosen per OS by a small helper.

### Terminal

- clack and picocolors work in Windows Terminal and PowerShell.
- Git Bash (mintty) doesn't report itself as an interactive terminal, so the existing "Run it in a terminal" message appears. The README should recommend Windows Terminal or PowerShell.

### Tests and CI

- [test/sync.test.js](../test/sync.test.js) hard-codes `/` in expected paths (`/d/claude/CLAUDE.md`, the `Library/Application Support` cases).
  - Build the expected values with `path.join`.
  - Make the Application Support / AppData case depend on the OS.
- [.github/workflows/test.yml](../.github/workflows/test.yml) only uses `macos-latest`. Add `windows-latest`, so every push is tested on real Windows.
- Add a test that forces "file symlinks not allowed", to cover the Developer Mode message, and one that checks folders get junctions.

### Not affected

- Line endings: `tools.conf` parsing already trims `\r`.
- The npm `bin` shim: npm creates `.cmd` launchers on Windows.
- The Node version guard.
- `fs.cpSync` and the timestamps.
- The conflicted-copy naming: Dropbox uses the same pattern on Windows.

### Out of scope

The demo GIF and video tooling ([scripts/demo](../scripts/demo)) stays macOS-only; it's a maintainer tool.

## Decisions needed

1. **Files without Developer Mode.** `CLAUDE.md` and `AGENTS.md` are files, and file symlinks need Developer Mode on Windows.
   - **Recommended:** folders always work (junctions). Before linking files, the CLI checks once whether it may create symlinks. If not, it explains how to turn on Developer Mode (Settings → System → For developers) and offers the folders only.
   - **Alternative, not recommended:** a "copy mode" that copies files back and forth on every run. It isn't live sync, so it can lose edits.
2. **Linux too?** After this work, Linux mostly needs the Dropbox path (`~/.dropbox/info.json`, `~/Dropbox`) and `@appdata` → `~/.config`. It would add maybe 10% more work.

## Implementation phases

1. **Portability layer** (no behaviour change on macOS): a new `src/platform.js` with:
   - `isWindows`;
   - `linkType(kind)`;
   - `removeLink`;
   - `samePath(a, b)`;
   - `trash(p)`;
   - the OS wording (`fileManager`, `trashName`, `device`).

   Also: `tilde()` always outputs `/`, and `expand()` understands `@appdata`.
2. **Linking:** `link()`, `unlinkItem()` and `itemState()` use the layer. Add the symlink-permission check and the friendly `EPERM`/`EBUSY` messages.
3. **No external commands:** switch to the JS diff (add the `diff` dependency) for `diffItem` and `conflictDiff`.
4. **Dropbox and registry:** Windows `info.json` locations; per-OS `@appdata` paths for VS Code and Zed; optional Windows app detection; the AppData discovery skip list.
5. **Conflict checker:** move to Node, with a per-machine hook snippet.
6. **Wording and docs:**
   - OS-neutral strings;
   - README: Windows requirements (Developer Mode, Windows Terminal), File Explorer's "Always keep on this device" for offline files, and a supported-OS table;
   - `package.json` `os` and the description (drop "between Macs").
7. **Tests and CI:** portable paths in tests, the new tests, and `windows-latest` in the matrix.
8. **Release** as **0.6.0**: README, release notes, and the user runs `npm publish`.

## Verification

- **CI:** `npm test` green on macOS and Windows for Node 20, 22 and 24.
- **macOS regression:** sync, status, unlink and resolve on this Mac behave exactly as in 0.5.1, and the existing links are still recognized as `linked`.
- **Real Windows PC (needed once):**
  - `npx ai-agent-sync@<rc>` with Developer Mode **on**: files and folders link; Claude Code, Cursor and Codex read their rules through the links; edits show up on the Mac through Dropbox.
  - With Developer Mode **off**: folders link (junctions), and file items show the Developer Mode message instead of failing.
  - `status`, `unlink` and `resolve` work, and losing versions land in the Recycle Bin.
  - The Windows PC and the Mac share one `AIAgentsShared`: `tools.conf` lines written on either machine work on the other.
- **Safety:** `unlink` on a junction never deletes the Dropbox contents. This gets a dedicated test, because a recursive remove through a junction is the classic data-loss bug.

## Risks

- **Locked files:** Windows refuses to move a file an agent has open. Mitigation: a clear "close it and rerun" message, and the item is skipped while the others continue.
- **Online-only files:** Dropbox's "online-only" (Cloud Files) placeholders. A link to an online-only file makes it download on first read, which is slow but works. The README asks for "Available offline", as on macOS.
- **Antivirus or company policy** can block symlinks or junctions on managed PCs. It's detected by the permission check and explained.

## Sources

- [Dropbox Help: locate the Dropbox folder](https://help.dropbox.com/installs/locate-dropbox-folder)
- [`info.json` in %APPDATA% / %LOCALAPPDATA%](https://www.experts-exchange.com/questions/29086696/Access-VBA-Get-the-DropBox-folder.html)
- [Node: directory symlinks on Windows need elevation or Developer Mode](https://github.com/nodejs/node/issues/18518)
- [Junction fallback, and files can't be junctions](https://github.com/paperclipai/paperclip/pull/5234)
- [Zed settings path per OS](https://github.com/zed-industries/zed/blob/main/docs/src/configuring-zed.md)
- [OpenCode config at `~/.config/opencode` on Windows (user log)](https://github.com/anomalyco/opencode/issues/3730)
