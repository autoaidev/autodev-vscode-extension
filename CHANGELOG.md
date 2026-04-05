# Changelog

All notable changes to AutoAIDev are documented here.

## [1.0.2] — 2026-04-05

### Added
- OpenCode session ID capture via `opencode session list` (no dummy prompt needed)
- Project-local MCP server config written to `.claude/settings.local.json`, `.vscode/mcp.json`, `opencode.json`, and `.mcp.json` on activation
- Memory MCP server (`@modelcontextprotocol/server-memory`) with project-relative storage at `.autodev/MEMORY.jsonl`
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
