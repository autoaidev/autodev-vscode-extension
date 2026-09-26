# Changelog

All notable changes to AutoAIDev are documented here.

## [1.0.361] — 2026-09-26

### Fixed
- **grok resume waits much longer under a many-agents-at-once launch** — bundles CLI 1.4.185. When you start ~17 grok agents at once, grok serializes on its shared session index and a headless `--resume` can legitimately take minutes to produce its first output. The previous single ~180s grace window was too impatient and tripped a false stateless fallback. The resume hang-probe is now exponential and multi-round: after the first 90s window it grants up to 15 further windows (growing 8s ×2, capped at 22s → ~6.7min of total patience), but each extension is **gated on real progress** — grok must have written NEW session events during that window. A silent window with no first token still falls back immediately, so a genuinely hung resume is abandoned fast while a slow-but-alive one is waited out. The office log now shows honest progress (`--resume still loading after Ns (round K/15, grok is writing session events) — waiting up to ~Ms more`) instead of a scary stall. The run watchdog default is raised 10min → 20min so a slow load still leaves ≥13min of real work budget. All thresholds are env-overridable (`AUTODEV_GROK_RESUME_MAX_EXTENSIONS`, `AUTODEV_GROK_RESUME_EXT_BASE_MS`, `AUTODEV_GROK_RESUME_EXT_CAP_MS`, `AUTODEV_GROK_MAX_RUN_MS`).

## [1.0.359] — 2026-09-26

### Fixed
- **Unfinished tasks are never falsely marked DONE anymore** — bundles CLI 1.4.183. When a provider (observed live on a Windows grok-cli office loop) crashed / hit a StopFailure and exited leaving a task `[~]` in-progress, the loop's stranded sweep called `markDone()` on it — reporting a half-done task as SUCCESS (false-green). On a locked/unwritable `TODO.md` (Windows file lock) that write failed silently, the task stayed `[~]`, and the branch re-picked it instantly → the `✅ Auto-marked 1 stranded [~] task as done` line flooded ~40×/second. The stranded reconciliation is now truthful: a stranded task is **never** marked done — it is reset to pending and re-attempted a bounded number of times (`maxStrandRetries`, default 3), then flagged **blocked / needs-attention** (reported the same way a provider hard-failure is). The strand counter and the blocked promotion advance purely in-memory *before* and *independently of* any `TODO.md` write, so a permanently locked file can no longer flood — a task is reconciled at most MAX+1 times total — and the branch waits out the normal loop interval instead of hot-looping. Correctness over efficiency: a task the agent genuinely finished but forgot to mark gets safely re-done, rather than a crashed task being falsely completed.

## [1.0.358] — 2026-09-25

### Fixed
- **grok agents no longer fail every resumed turn in an infinite retry loop** — bundles CLI 1.4.182. After 1.4.181 forced grok to RESUME its session, every resumed turn failed instantly (~1s) and looped forever at `retry 1/10`. The headless session-log tailer seeded/tailed the *newest-by-mtime* grok session dir, but the resumed session is not always the newest on disk (a later stateless-fallback turn mints a newer, unrelated dir); the tailer then read the resumed session from offset 0 and surfaced a PRIOR turn's errored `turn_ended` as this turn's result. The tailer now seeds and tails the KNOWN session dir (`grokSessionDirFor`) for resume and new-persistent launches, so a newer unrelated dir can never divert it. Two further guards: a `turn_ended` is only honored once this turn has demonstrably started in the tailed window (never a stale backlog record), and a resume that errors before producing any output is marked non-resumable and falls back to a fresh stateless relaunch instead of re-resuming the same broken session forever.

## [1.0.350] — 2026-09-25

### Fixed
- **A logged-out grok agent now asks for re-login instead of silently failing every turn** — bundles CLI 1.4.173. When grok's credential file (`~/.grok/auth.json`) goes missing its silent token refresh fails (`Failed(ManualLogin)`) and the turn dies with grok's native "Turn failed: Grok stopped before this turn finished" banner. The grok provider previously detected only the interactive OAuth login gate, so this slipped through as a false idle (a completed-looking turn that lost the task) or a generic session-exit — never the 🔑 needs-auth state. grok auth failures (missing/empty auth.json, `Failed(ManualLogin)`, a failed silent refresh, or a login gate) are now classified as `reauth_required` on BOTH the task-loop and operate paths: the loop pauses for re-login and the office/app show the 🔑 needs-auth state (the reauth sentinel + `Failed(ManualLogin)` are now matched by the auth detector, which they were not before). Auth failures are NEVER retried in a tight loop — a missing token can only be fixed by re-login.
- **Transient grok turn failures now retry instead of vanishing** — grok's turn-failure banner WITH credentials still present is classified as a transient `turn-failed` hard-failure and retried with exponential backoff (the 1.0.349 mechanic), up to `maxProviderRetries` (default 10), instead of being misread as a clean idle. Reauth and transient-retry stay distinct.

## [1.0.349] — 2026-09-24

### Added
- **Transient provider failures are retried instead of lost** — bundles CLI 1.4.172. A provider hard-failure (token blip, timeout, watchdog no-output, "provider stopped/timed out", crash, session-error) on a task now retries the SAME task up to 10 times with exponential backoff (2s → 4s → … → 64s → 120s cap, ±15% jitter) before the task is finally reported failed/blocked. During retries the task stays in-progress and claimable and the office reads "working" (a soft `retrying (N/10)` progress note), so a brief grok/claude auth or timeout blip no longer strands the task until a human re-assigns it. `reauth_required` is excluded — genuine auth-expiry keeps its own pause/resume + re-auth path. Configurable via `maxProviderRetries` (default 10).

## [1.0.348] — 2026-09-24

### Fixed
- **A missing `PROGRAM.md` no longer fails a task** — bundles CLI 1.4.171. `writeCombinedFile` now reads `.autodev/PROGRAM.md` defensively (never throws when the file is absent) and `rebuildProfile` assembles the profile body in a try/catch so a throw can't prevent the `PROGRAM.md` write. Fixes office grok agents failing tasks with `ENOENT … open '.autodev\PROGRAM.md'`.

## [1.0.346] — 2026-09-24

### Fixed
- **grok can start on Windows again** — bundles CLI 1.4.168, which TOML-escapes the double-quoted `[folders."<path>"]` key in `~/.grok/trusted_folders.toml`. A raw Windows path (`C:\Users\…`) previously injected invalid TOML escapes (`\U`,`\u`,`\a`,`\.`), making grok's whole trust store unparseable so `grok --always-approve` fell back to the interactive trust prompt. The CLI now also repairs a store already corrupted by the old bug (re-escaping every folders key, preserving `trusted`/`decided_at`, backing up the broken original).

## [1.0.343] — 2026-09-15

### Added
- **Master `autodev` Agent Skill bundled** (from CLI 1.4.163) — a single keyword-triggered skill (`media/skills/autodev/SKILL.md`) that routes agents to the on-disk `.autodev/profile/*` protocol files on demand; supplements the always-loaded PROGRAM.md. `copy-cli-media` now syncs `media/skills/` from the sibling CLI (additive) alongside `media/profile/`.
- **Keyword metadata on every profile pillar** — each of the 38 pillars now carries an `<!-- autodev-keywords: … -->` trigger line, re-synced to the bundled media.

## [1.0.337] — 2026-09-10

### Changed
- **Bundled agent-profile media refreshed to CLI 1.4.158** — anti-stall pillars, workflow reinforcement, and the new top-of-file `> **Digest:**` summary lines now ship to VS Code users (all 35 profile sections re-synced from the sibling CLI).

## [1.0.319] — 2026-09-03

### Fixed
- **Windows: existing Claude Code install is now detected.** The Step-0 provider-readiness probe was Unix-only — it ran `${SHELL:-bash} -lc "command -v claude"`, which on Windows has no `$SHELL`, no POSIX `command -v`, and looked for a bare `claude` rather than `claude.exe`/`claude.cmd`. A perfectly-installed user (`C:\Users\user\.local\bin\claude.exe`) was reported "not installed" and kept getting the install-Claude banner. Detection now resolves the executable on disk first (cross-platform: `.exe`/`.cmd`/`.bat` + `PATHEXT`, `~/.local/bin` / `%APPDATA%\npm` / `%LOCALAPPDATA%`, PATH split on `;`), then falls back to `where` on Windows / login-shell `command -v` on Unix. Unix detection is unchanged. New pure `detectBinPath()` helper (`src/binDetect.ts`) with unit tests.

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
