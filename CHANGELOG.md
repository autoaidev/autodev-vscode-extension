# Changelog

All notable changes to AutoAIDev are documented here.

## [1.0.308] — 2026-06-18

### Added
- **Copilot CLI sessions are now portable.** Export captures each `~/.copilot/session-state/<uuid>/` folder bound to the workspace (matched via `workspace.yaml` `cwd:`); restore copies it into the destination's Copilot store and rewrites `cwd:` to the new path. Resume with `--resume=<uuid>` after a move.
- **Honest, per-provider manifest.** `manifest/session-ids.json` now records every provider family with a `portability` tag (`full` / `partial` / `none`), a human-readable `note`, discovered session IDs, connected IDs, and whether real traces were captured.
- **All seven providers covered.** Backup now reasons about `claude-cli`, `claude-tui`, `copilot-cli`, `copilot-sdk`, `opencode-cli`, `opencode-sdk`, and `grok-tui`.

### Changed
- **Restore relies on the restored `.autodev/session-state.json`.** Connected session IDs travel verbatim with the workspace state instead of a separate merge step, so resume "just works" in the destination folder.
- Export and import surface which providers had traces captured/restored in their completion notifications.

### Notes on portability (verified against on-disk stores)
- **Claude** (`claude-cli` / `claude-tui`) — **full**: JSONL traces in `~/.claude/projects/<encoded>` are re-encoded for the destination path.
- **Copilot CLI** — **full**: `session-state/<uuid>/` copied with `cwd:` rewrite (the SQLite `session-store.db` index is not modified).
- **OpenCode** (`opencode-cli` / `opencode-sdk`) — **none**: sessions live in a shared SQLite `opencode.db`; IDs are recorded for reference but not exported per-session.
- **Copilot SDK** — **none**: in-memory sessions only.
- **Grok TUI** — **none**: keeps no session store.

## [1.0.307] — 2026-06-18

### Added
- **Agent backup import / restore** — new `/import` slash command and `AutoDev: Import Agent Backup (.zip)` command (toolbar `$(cloud-download)` icon). Pick a backup ZIP and a destination folder; the agent is restored and wired up to run there:
  - Workspace state (`.autodev/`, `media/profile/`, `media/skills/`) and root agent docs are extracted into the destination folder
  - Claude session traces are restored into the destination's `~/.claude/projects/<encoded>` dir (recomputed for the new path) so resume works after a move
  - OpenCode session traces are restored into the host session store
  - Connected session IDs from the manifest are merged into the destination `session-state.json`
  - Zip-slip guarded extraction

### Changed
- **Refactored the agent backup feature for SOLID/DRY.** Replaced the monolithic `agentExport.ts` with a cohesive `src/agentBackup/` module:
  - `archive.ts` — `Archive` interface + `AdmZipArchive` (Dependency Inversion; export/import no longer touch `adm-zip` directly)
  - `layout.ts` — single source of truth for what is backed up (workspace dirs, root docs, archive paths, session-store discovery)
  - `manifest.ts` — session manifest read/write
  - `sessionProviders.ts` — `SessionBackupProvider` strategy per provider (Open/Closed)
  - `export.ts` / `import.ts` — slim orchestrators sharing the same layout

## [1.0.306] — 2026-06-18

### Added
- **Session selector dropdown** in the Tasks tab. Lists existing sessions for the active provider and lets you pick one to resume or start a new one:
  - `claude-cli` — enumerates local `.jsonl` session traces for the workspace (newest first, with date + short ID + optional custom name)
  - `opencode-cli` — enumerates sessions via `opencode session list --format json`, filtered by workspace, refreshed live
  - `copilot-cli` / `copilot-sdk` / `opencode-sdk` — shows the currently connected session
- **Agent backup export** — new `/export` slash command and `AutoDev: Export Agent Backup (.zip)` command (toolbar `$(archive)` icon). Bundles agent traces, memory, and protocol files into a single ZIP:
  - Workspace `.autodev/`, `media/profile/`, `media/skills/`
  - Root agent docs (`AGENTS.md`, `CLAUDE.md`, `SOUL.md`, `JOURNAL.md`, `CONTRACTS.md`, `TODO.md`, `DONE.md`, `TASKS.md`, `LESSONS.md`, `NOTES.md`, `SCRATCHPAD.md`)
  - Claude `.jsonl` session traces + matching `agent-*` sidecars
  - OpenCode session directories/files for the connected sessions
  - A `manifest/session-ids.json` recording connected + discovered session IDs across all providers
  - Uses the `adm-zip` library (no hand-rolled ZIP encoding)

### Changed
- All `file://` references in generated agent files (`AGENT_PROFILE.md`, `MESSAGE.md`, profile builder) now use **relative paths** (`file://./…`) instead of absolute paths, so an agent folder stays valid after being moved or exported.

### Fixed
- OpenCode agent showed as **idle** in Pixel Office while actually working. When the loop latches onto an already-running task (e.g. after an extension restart mid-task), it now emits a `task_start` event so the agent flips from idle back to active.

## [1.0.2] — 2026-04-05

### Added
- OpenCode session ID capture via `opencode session list` (no dummy prompt needed)
- Project-local MCP server config written to `.claude/settings.local.json`, `.vscode/mcp.json`, `opencode.json`, and `.mcp.json` on activation
- Memory MCP server (`@modelcontextprotocol/server-memory`) with project-relative storage at `.autodev/MEMORY.md`
- Sequential-thinking MCP server (`@modelcontextprotocol/server-sequential-thinking`)
- Settings UI now syncs immediately when `.vscode/autodev.json` is edited externally
- `resumeSession` flag preserved correctly on settings save
- Profile dropdown in Settings tab with built-in profiles and custom path fallback

### Changed
- Removed Claude UI and Copilot UI providers — CLI-only mode
- MCP server config is now project-local only; global CLI config files are no longer modified
- OpenCode `run` command uses a local `$autodev_msg` variable to safely pass multi-file content as a single argument on Windows
- Default provider changed from `claude` to `claude-cli`

### Fixed
- Settings save did not call `_push()` so the webview showed stale data after saving
- Path comparison in OpenCode session list is now case-insensitive on Windows

## [1.0.0] — 2026-04-01

### Added
- Initial release
- Autonomous task loop: reads `TODO.md`, dispatches to Claude CLI, Copilot CLI, or OpenCode
- Sidebar panel with Tasks and Settings tabs
- Session resume for all CLI providers
- Discord bot integration (receive tasks, post updates)
- A2A webhook server polling and posting
- MCP server auto-sync (Playwright)
- Split prompt files: `.autodev/AGENT_PROFILE.md` + `.autodev/MESSAGE.md`
- Built-in agent profiles with frontmatter (`title`, `description`, `noCommit`)
- Rate-limit detection and auto-resume
- Task timeout and check-in reminders
