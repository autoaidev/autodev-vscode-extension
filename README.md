# AutoDev — Autonomous AI Development Agent for VS Code

**AutoDev** turns VS Code into a home for an autonomous coding agent. It reads a `TODO.md`, dispatches each task to an AI CLI (Claude, Grok, Copilot, or OpenCode), watches the agent work, marks the task done, and moves to the next one — continuously, without human intervention. A sidebar gives you tasks, live agent activity, session management, and settings.

**Package:** `autoaidev` (publisher `AutoAIDev`) · **Repo:** https://github.com/autoaidev/autodev-vscode-extension

## Links

- **VS Code Marketplace:** <https://marketplace.visualstudio.com/items?itemName=AutoAIDev.autoaidev>
- **VSIX download:** <https://autoaidev.com/releases/autoaidev-latest.vsix>
- **Siblings:** [autodev-cli](https://www.npmjs.com/package/autodev-cli) · [desktop app](https://autoaidev.com/releases/AutoAIDev-desktop-latest.AppImage) · [Pixel Office](https://app.pixeloffice.org)
- **Product sites:** [autoaidev.com](https://autoaidev.com) · [pixeloffice.org](https://pixeloffice.org)

---

## Where this fits in AutoDev

AutoDev is a suite for running autonomous AI coding agents that show up as characters in a live "office". This extension is the **in-editor** front-end for one agent. Its sibling repos:

| Repo | What it is |
|---|---|
| **[pixel-office](https://autodev.code.aioffice.works)** | The hub — the "AI Agent Command Center" (Laravel + Vue 3 + Pixi.js). Hosts the office UI, the WebSocket presence server, and the MCP endpoints (`/api/mcp`, `/api/mcp/a2a`, `/api/office-mcp`). |
| **`autodev-cli`** ([npm](https://www.npmjs.com/package/autodev-cli)) | The engine. A TypeScript agent loop + the `autodev` CLI. **This extension is a thin VS Code UI over that engine** — it imports the loop, providers, dispatcher, and config sync from `autodev-cli` and adds the sidebar, webviews, and editor glue. |
| **`autodev-app`** ([npm](https://www.npmjs.com/package/autodev-app)) | The AutoDev desktop app (Electron). Bundles the CLI and drives agents in a GUI. |
| **`agent-vm-deployer`** ([live](https://deployer.code.aioffice.works)) | Spawns headless agents on SSH / Docker / K8s with managed GitHub + Claude auth. |

There are two ways an agent shows up in an office: a **loop agent** (this extension, or the CLI/deployer, running the autonomous task loop) and an **MCP-only agent** (a plain AI chat session wired to `office-mcp`). You don't strictly need this extension to operate an office from an editor — **native VS Code + GitHub Copilot can drive an office through the `office-mcp` bridge** with no extension installed. The extension exists to give a *loop* agent a rich in-editor cockpit.

---

## Table of Contents

- [Quick Start](#quick-start)
- [How It Works](#how-it-works)
- [Task Loop — In Detail](#task-loop--in-detail)
- [TODO.md Format](#todomd-format)
- [AI Providers](#ai-providers)
- [Session Resuming](#session-resuming)
- [Agent Backup Export / Import](#agent-backup-export--import)
- [Agent Profile](#agent-profile)
- [Prompt Structure](#prompt-structure)
- [MCP Servers](#mcp-servers)
- [Desktop Sharing (RDP / VNC)](#desktop-sharing-rdp--vnc)
- [Discord Integration](#discord-integration)
- [Webhook / Office Integration](#webhook--office-integration)
- [Settings Reference](#settings-reference)
- [File Layout](#file-layout)
- [Sidebar UI](#sidebar-ui)
- [Permissions & Auto-Accept](#permissions--auto-accept)
- [Development](#development)
- [Requirements](#requirements)

---

## Quick Start

1. Install and authenticate at least one provider CLI (e.g. [Claude Code](https://claude.ai/code) — `claude` — and `claude login`).
2. Install this extension (from the Marketplace, or the bundled [`autoaidev-1.0.316.vsix`](autoaidev-1.0.316.vsix) via **Extensions → Install from VSIX…**).
3. Open a workspace and create a `TODO.md` with some `- [ ]` tasks.
4. Click the **AutoDev AI** icon in the Activity Bar → **Start**.

The loop runs until every task is done, then waits for new ones.

### Or use the `autodev-cli` launcher

[`autodev-cli`](https://www.npmjs.com/package/autodev-cli) is the companion command-line tool. It can scaffold a workspace, open it in your IDE, and bind it to a [pixel-office](https://autodev.code.aioffice.works) character in one shot — the extension then picks up the credentials automatically.

```bash
npm install -g autodev-cli

# Init + open in VS Code or Cursor
autodev --ide=vscode .
autodev --ide=cursor ./myproject

# Bind to an office character via a signed setup URL
autodev --setup-url='https://autodev.code.aioffice.works/api/cli/setup/<id>?expires=…&signature=…' .

# Or paste the WS URL directly
autodev --connect='wss://host/ws?token=<api_key>&endpoint=<slug>' .

# Combine — init, open the IDE, and bind credentials at once
autodev --setup-url='…' --ide=vscode .
```

Settings are written to `.autodev/settings.json`; the extension reads them on the next activation.

---

## How It Works

```
TODO.md  →  pick task  →  build prompt  →  run AI provider
                                                 ↓
                                   AI edits files + marks [x]
                                                 ↓
                                     detect [x] on that line
                                                 ↓
                                        save session ID
                                                 ↓
                                          next task  →  ...
```

1. AutoDev picks the first `[ ]` task and marks it `[~]` (in progress).
2. It writes the agent profile + task instruction to `.autodev/`.
3. It launches the selected provider with those files as the prompt.
4. It watches `TODO.md` for `[x]` on that exact line number.
5. When done, it captures the session ID, fires webhooks/Discord, and picks the next task.
6. If no tasks remain, it waits `loopInterval` seconds and polls again.

The loop engine itself lives in `autodev-cli` (`taskLoopRunner`, `dispatcher`, per-provider modules). The extension supplies VS Code implementations of the file-watcher and process-launcher, the sidebar, and the config sync.

---

## Task Loop — In Detail

### States

| State | Meaning |
|---|---|
| `idle` | Not started |
| `running` | Active — polling / dispatching |
| `paused` | Waiting for a rate-limit reset or manual resume |
| `stopping` | Stop requested, cleaning up |

### Completion detection

AutoDev watches `TODO.md` and looks for the specific **line number** it marked `[~]` to change to `[x]`. Keying on the line number (not the text) is robust against the AI rephrasing the task.

- If the provider exits before `[x]` appears → a one-time reminder: *"Please mark the task done in TODO.md"*.
- If the AI goes silent for `taskCheckInMinutes` → a check-in reminder is sent.
- **Hard timeout** (`taskTimeoutMinutes`, default 30) → the task is retried or skipped, per `retryOnTimeout`.

### Rate-limit handling

When a rate-limit error is detected, the task is reset from `[~]` back to `[ ]`, the loop enters `paused`, and a resume timer fires at the parsed reset time (e.g. `"resets 9pm (Europe/Sofia)"`). The **Retry Now** button forces an immediate resume.

### Background pollers

While a task runs, pollers keep pulling new tasks from the configured **Discord** channel and **office/webhook** endpoint (~3s intervals). Tasks appended mid-run are picked up on the next loop iteration.

---

## TODO.md Format

```markdown
## Todo

- [ ] Build a music game
- [ ] Add high score table

## In Progress

- [~] Implement login page

## Done

- [x] 2025-04-07  Create project structure
```

| Marker | Set by | Meaning |
|---|---|---|
| `[ ]` | You / Discord / office | Pending |
| `[~]` | AutoDev (loop start) | In progress |
| `[x] YYYY-MM-DD  text` | AI agent | Done |

> Two spaces between the date and the text are required for correct parsing.

Add tasks via the sidebar input, Discord, the office/webhook API, or by editing `TODO.md` directly.

---

## AI Providers

Pick the provider from the dropdown in the sidebar. The engine supports eight provider modes; the default is **`claude-cli`**.

| Family | Modes | Notes |
|---|---|---|
| **Claude** | `claude-tui`, `claude-cli` | Claude Code. `claude-tui` drives a persistent TUI client; `claude-cli` runs headless per task. Full session portability (JSONL traces). |
| **Grok** | `grok-tui`, `grok-cli` | Grok agent (beta). No persistent session store. |
| **Copilot** | `copilot-cli`, `copilot-sdk` | GitHub Copilot. `copilot-cli` sessions are portable; `copilot-sdk` is in-memory. |
| **OpenCode** | `opencode-cli`, `opencode-sdk` | [opencode](https://opencode.ai). Sessions live in a shared SQLite store. |

Each family needs its own CLI installed and authenticated (see [Requirements](#requirements)). Per-provider model overrides are available via the `claudeModel` / `grokModel` / `copilotModel` / `opencodeModel` settings, and a `fallbackProvider` can take over when the primary provider is unavailable.

For the exact command each provider is launched with, see the modules under `autodev-cli/out/providers/`.

---

## Session Resuming

Enable the **Resume Session** checkbox in the sidebar (CLI/TUI providers). After each completed task, the session ID is extracted from provider output and stored in `.autodev/session-state.json` (per provider). The next task resumes that conversation so the AI keeps full prior context. Click **New** to clear the ID and start fresh.

### Session selector

The Tasks tab includes a **session dropdown** listing existing sessions for the active provider:

| Provider | Sessions listed |
|---|---|
| `claude-cli` / `claude-tui` | Local `.jsonl` session traces for this workspace, newest first (date + short ID + optional name) |
| `opencode-cli` | Sessions from `opencode session list --format json`, filtered by workspace |
| `copilot-cli` / `copilot-sdk` / `opencode-sdk` | The currently connected session |

Selecting `⊕ New session` clears the stored ID; selecting an entry stores it for resume on the next task.

---

## Agent Backup Export / Import

Move an agent between machines or workspaces. Run **`AutoDev: Export Agent Backup (.zip)`** (command palette, the `$(archive)` toolbar icon, or the `/export` slash command in the Add-task input) to bundle everything the agent needs:

```
agent-export/
├── workspace/    ← .autodev/, media/profile/, media/skills/, and root docs
│                    (AGENTS, CLAUDE, SOUL, JOURNAL, CONTRACTS, TODO, DONE, …)
├── sessions/     ← claude/ .jsonl traces + copilot-cli/ session-state folders
└── manifest/     ← session-ids.json (per-provider portability + notes)
```

**Provider portability** (verified against on-disk stores):

| Provider | Portability | What travels |
|---|---|---|
| `claude-cli` / `claude-tui` | **full** | JSONL traces from `~/.claude/projects`, re-encoded for the destination path |
| `copilot-cli` | **full** | `~/.copilot/session-state/<uuid>/` copied, `workspace.yaml` `cwd:` rewritten |
| `opencode-cli` / `opencode-sdk` | none | sessions live in a shared SQLite `opencode.db`; IDs recorded for reference only |
| `copilot-sdk` | none | in-memory sessions only |
| `grok-tui` / `grok-cli` | none | keeps no session store |

Because generated agent files use **relative** `file://./…` references, an exported folder stays valid after being moved.

**`AutoDev: Import Agent Backup (.zip)`** (`$(cloud-download)` icon or `/import`) reconstructs the agent in a chosen destination: workspace state and root docs are extracted, Claude/Copilot session traces are restored and re-pathed so `--resume` keeps working, and connected session IDs travel inside the restored `session-state.json`. Extraction is zip-slip guarded.

The feature lives in [`src/agentBackup/`](src/agentBackup) — slim `export.ts` / `import.ts` orchestrators over the shared backup logic in `autodev-cli`.

---

## Agent Profile

The agent profile gives the AI project-specific context: coding standards, architecture notes, conventions. Resolution order:

1. `profilePath` setting (absolute path)
2. `AUTODEV.md` beside `TODO.md`
3. Built-in default ([`media/AUTODEV.default.md`](media/AUTODEV.default.md))

The extension also ships a modular protocol profile under [`media/profile/`](media/profile) (identity, memory-MCP, living-docs, skill-files, core loop, etc.) and reusable skills under [`media/skills/`](media/skills). Frontmatter is supported:

```markdown
---
title: My Project Agent
description: Custom agent for this repo
noCommit: true
---
```

- `noCommit: true` omits the "commit your changes" step from task instructions.

The profile body (frontmatter stripped) is written to `.autodev/AGENT_PROFILE.md` before each task.

---

## Prompt Structure

Each task dispatch writes two files:

- **`.autodev/AGENT_PROFILE.md`** — the resolved agent profile body.
- **`.autodev/MESSAGE.md`** — the task instruction:

```markdown
# Current TODO.md
- [x] 2025-04-07  Create project structure
- [~] Build a music game
- [ ] Add high score table

# Active Task
Build a music game

## Instructions
0. Immediately mark the task [~] in TODO.md
1. Read and understand the full codebase
2. Implement the task completely, including tests
3. When done, mark as [x] 2025-04-07  Build a music game in TODO.md
4. Commit your changes with git
5. Stop — do not work on any other task
```

Claude receives both files via `-p "@profile" "@message"`; providers that take a single prompt (e.g. Copilot CLI) get them combined into one timestamped file.

---

## MCP Servers

At activation the extension syncs a default set of MCP servers into every project-level config file:

| Server | Package | Purpose |
|---|---|---|
| `memory` | `@modelcontextprotocol/server-memory` | Persistent memory (stored under `.autodev/`) |
| `playwright` | `@playwright/mcp@latest` | Browser automation and UI testing |
| `sequential-thinking` | `@modelcontextprotocol/server-sequential-thinking` | Structured multi-step reasoning |

Config files kept in sync:

| File | Used by |
|---|---|
| `.claude/settings.local.json` | Claude CLI (project-local) |
| `.vscode/mcp.json` | VS Code Claude extension |
| `opencode.json` | OpenCode CLI |
| `.mcp.json` | Copilot CLI |

The **Settings → MCP** panel lets you add custom servers, plus guided forms for Jira/Atlassian and email (IMAP) MCP servers, with a live "test" button for the email server. Built-in servers can be disabled per workspace (`disabledBuiltinMcp`).

---

## Desktop Sharing (RDP / VNC)

For headless/remote agent machines, AutoDev can stream the agent's desktop into the pixel-office browser front-end.

### RDP (Guacamole)

Streams an XFCE/xrdp desktop over WebSocket using the Guacamole HTML5 protocol:

```
Browser (pixel-office)
   │  WSS  /guac-ws?token=…
   ▼
guacamole-lite :4567   (Node WS bridge)
   │  Guacamole protocol (TCP)
   ▼
guacd :4822            (C proxy)
   │  RDP :3389
   ▼
xrdp / XFCE            (agent machine)
```

On an `rdp_session` message, the extension builds a base64 Guacamole connection token from the RDP credentials/resolution and sends `rdp_guac_token` back; the browser connects to `<rdpGuacWsUrl>?token=…` and renders the desktop, with bidirectional clipboard. Configure the **RDP** section in Settings — `rdpGuacWsUrl` (a public `wss://…/guac-ws`) is required when pixel-office is served over HTTPS.

### VNC (RFB)

For machines running a VNC server (TigerVNC, x11vnc, …), the extension speaks the RFB protocol directly in Node — no external tools. It connects over TCP, authenticates, relays compressed framebuffer rectangles to pixel-office (`vnc_fbu`), forwards mouse/keyboard events, and syncs the clipboard. Configure the **VNC** section in Settings.

---

## Discord Integration

Configure **Bot Token**, **Channel ID**, and **Allowed Owners** in Settings.

- **Receiving tasks** — the Discord poller reads new channel messages from allowed owners and appends them to `TODO.md` as `- [ ]`, reacting ✅ to each accepted message. History before the loop started is ignored.
- **Sending status** — loop start/stop, task start/done/failed, rate-limit, and all-done events are posted to the channel. A send-only **Discord Webhook URL** is supported as a simpler alternative (no bot token).

---

## Webhook / Office Integration

Configure the office connection via **`wsUrl`** (which is parsed into `serverBaseUrl` + `serverApiKey`) or the individual **Server Base URL**, **API Key**, and **Webhook Slug** fields.

- **Outgoing (A2A)** — loop events follow the Agent-to-Agent streaming protocol (`task`, `statusUpdate`, `artifactUpdate`, `message` envelopes). When a WebSocket connection is open they are streamed over it; otherwise they are POSTed as `application/a2a+json` to the configured office endpoint (`serverBaseUrl`, with `ws://`/`wss://` rewritten to `http://`/`https://`).
- **Incoming** — the webhook poller reads `GET <baseUrl>/v1/logs?status=pending&endpoint_slug=<slug>` (with `ETag` caching), extracts new `user_message` events into `TODO.md`, and acknowledges via `PATCH /v1/logs/{id}`.

This is how an in-editor loop agent stays bound to its [pixel-office](https://autodev.code.aioffice.works) character.

---

## Settings Reference

Stored in `.autodev/settings.json` (auto-added to `.gitignore`). The legacy `.vscode/autodev.json` is still read for back-compat and migrated to the new path on the next save. Edit via the **Settings** tab or the raw JSON file. Defaults live in `autodev-cli/core/settingsLoader` (`SETTINGS_DEFAULTS`).

### Core

| Key | Default | Description |
|---|---|---|
| `provider` | `claude-cli` | Active provider mode (see [AI Providers](#ai-providers)) |
| `fallbackProvider` / `fallbackProviderEnabled` | `opencode-cli` / `false` | Provider to fall back to when the primary is unavailable |
| `claudeModel` / `grokModel` / `copilotModel` / `opencodeModel` | _(empty)_ | Per-provider model override |
| `autoStartLoop` | `false` | Start the loop automatically on activation |

### Loop

| Key | Default | Description |
|---|---|---|
| `loopInterval` | `30` | Seconds to wait between polls when TODO is empty |
| `taskTimeoutMinutes` | `30` | Hard timeout per task |
| `taskCheckInMinutes` | `20` | Minutes of AI silence before a check-in reminder |
| `retryOnTimeout` | `false` | Re-queue timed-out tasks (vs. skipping) |
| `autoResetPendingTasks` | `true` | Reset `[~]` tasks to `[ ]` when the loop starts |
| `maxTaskAttempts` | `3` | Max attempts before giving up on a task |
| `resumeSession` | `false` | Reuse session IDs across tasks |

### Office / Server & Discord

| Key | Description |
|---|---|
| `wsUrl` | Office WebSocket URL (parsed into `serverBaseUrl` + `serverApiKey`) |
| `serverBaseUrl` / `serverApiKey` / `webhookSlug` | Office/webhook base URL, Bearer key, and endpoint slug |
| `discordToken` / `discordChannelId` / `discordWebhookUrl` / `discordOwners` | Discord bot token, channel, send-only webhook, and allowed submitters |

### Paths & profile

| Key | Default | Description |
|---|---|---|
| `todoPath` | `TODO.md` | Path to the task file |
| `profilePath` | `AUTODEV.md` | Path to the agent profile |
| `enabledProfileSections` / `customProfileRefs` | `[]` | Selected built-in protocol sections and extra profile file refs |

### Integrations & automation

| Key | Default | Description |
|---|---|---|
| `hooksEnabled` / `hooksScope` / `openCodeHooksEnabled` | `false` / `project` / `false` | Install provider hooks (real-time activity events) |
| `mcpUpdateEnabled` | `false` | Keep MCP config files updated |
| `gitEnabled` | `false` | Enable git automation in the loop |
| `enableFileBrowser` | `false` | Expose a file browser to the office front-end |
| `exportEnabled` / `exportDailyBackup` | `false` | Enable agent export / scheduled daily backup |
| RDP: `rdpEnabled`, `rdpHost`, `rdpPort` (3389), `rdpUsername`, `rdpPassword`, `rdpDomain`, `rdpGuacWsUrl` | | Desktop sharing via Guacamole |
| VNC: `vncEnabled`, `vncHost`, `vncPort` (5900), `vncPassword` | | Desktop sharing via RFB |

Other tuning keys exist (`autoCompact`, `pruneTodoEveryNTasks`, `journalLearnEveryNTasks`, `resetSessionEveryNTurns`, `opencodeTimeout`, …); see `SETTINGS_DEFAULTS` for the full list.

---

## File Layout

```
<workspace>/
├── TODO.md                         ← task list (read/written by the loop)
├── AUTODEV.md                      ← agent profile (optional, per-project)
├── .vscode/
│   ├── mcp.json                    ← MCP servers for VS Code
│   └── settings.json               ← auto-accept / permission settings
├── .claude/
│   ├── settings.json               ← Claude CLI permissions (allow: *)
│   └── settings.local.json         ← Claude CLI MCP servers (project-local)
├── .mcp.json                       ← Copilot CLI MCP servers
├── opencode.json                   ← OpenCode config + MCP servers
└── .autodev/                       ← runtime files (all gitignored)
    ├── settings.json               ← AutoDev settings (canonical location)
    ├── AGENT_PROFILE.md            ← resolved profile (written before each task)
    ├── MESSAGE.md                  ← task instruction (written before each task)
    ├── session-state.json          ← stored session IDs per provider
    ├── messages/                   ← combined prompt files for single-prompt providers
    └── output/                     ← per-provider stdout + exit-code captures
```

---

## Sidebar UI

Click the **AutoDev AI** icon in the Activity Bar. The webview has **Tasks**, **Settings**, and **Profile** panels.

### Tasks tab

| Element | Purpose |
|---|---|
| Provider dropdown | Switch provider mode |
| Resume Session checkbox | Reuse session IDs across tasks |
| Session dropdown | Pick a session to resume or start new |
| New button | Clear the stored session ID |
| Start / Stop / Retry Now | Control the loop |
| Loop status | Current state + active task + live tool activity (e.g. *Editing: src/game.ts*) |
| Add-task input | Append `- [ ]` to TODO.md; slash commands: `/restart`, `/clear`, `/archive`, `/export`, `/import` |
| Task list | Pending tasks (click to jump to the line) + completed tasks |

### Settings & Profile tabs

Grouped fields for provider, loop, office/Discord, MCP, RDP/VNC, and paths, with **Save**, **Edit raw JSON**, and an MCP config editor. The Profile tab selects and previews built-in profiles/sections.

### Commands

| Command | Icon |
|---|---|
| `AutoDev: Start Task Loop` | `$(play)` |
| `AutoDev: Stop Task Loop` | `$(stop)` |
| `AutoDev: Open Settings` | `$(gear)` |
| `AutoDev: Export Agent Backup (.zip)` | `$(archive)` |
| `AutoDev: Import Agent Backup (.zip)` | `$(cloud-download)` |

---

## Permissions & Auto-Accept

So the AI can operate without interactive prompts, the extension writes provider permission files at activation — e.g. `~/.claude/settings.json` (`defaultMode: bypassPermissions`), project `.claude/settings.json` (`{ "permissions": { "allow": ["*"] } }`), and `.vscode/settings.json` (`chat.editing.autoAccept`, `claudeCode.initialPermissionMode: bypassPermissions`). These run agents in full-autonomy mode — use them in workspaces you trust.

---

## Development

The engine is a sibling package: `autodev-cli` is referenced via `file:../autodev-cli` and path-mapped in [`tsconfig.json`](tsconfig.json) to `../autodev-cli/out/*`. **Build `autodev-cli` first**, then this extension:

```bash
git clone https://github.com/autoaidev/autodev-vscode-extension
cd autodev-vscode-extension
npm install
npm run compile     # tsc -p ./  then  esbuild bundle → out/extension.bundle.js
```

| Script | Does |
|---|---|
| `npm run compile` | Type-check with `tsc`, then bundle with esbuild into `out/extension.bundle.js` |
| `npm run watch` | Incremental `tsc -watch` |
| `npm run lint` | `eslint src --ext ts` |

Press **F5** to launch the Extension Development Host. There is no automated test suite in this repo; test interactively in the dev host. Ad-hoc provider probes live in [`scripts/`](scripts) (`test-grok-tui.js`, `copilot-diag.js`), run with `node scripts/<file>.js`.

Package / publish (see [PUBLISH.md](PUBLISH.md)):

```bash
npm install -g @vscode/vsce
vsce package        # → autoaidev-<version>.vsix
vsce publish
```

### Project structure

The extension is intentionally thin — VS Code-specific UI and glue only; the loop, providers, dispatcher, backup, and config logic come from `autodev-cli`.

```
src/
├── extension.ts              # Activation, commands, auto-accept, hook migration
├── sidebar.ts                # Webview provider + message handling
├── sidebarTasksPanel.ts      # Tasks panel HTML
├── sidebarSettingsPanel.ts   # Settings panel HTML
├── sidebarProfilePanel.ts    # Profile panel HTML
├── sidebarMcpConfig.ts       # MCP config UI (custom / Jira / email forms)
├── sidebarCss.ts             # Webview styles
├── settings.ts               # VS Code-aware settings load/save over the CLI loader
├── vscode/vsAdapters.ts      # VsFileWatcher + VsProcessLauncher (engine adapters)
└── agentBackup/              # export.ts / import.ts / index.ts wrappers
media/
├── AUTODEV.default.md        # default agent profile
├── profile/                  # modular protocol sections (00-identity … 19-subagent…)
├── skills/                   # reusable skill files
└── icon.svg / icon.png
```

See [CHANGELOG.md](CHANGELOG.md) for release history and [SUPPORT.md](SUPPORT.md) for support.

---

## Requirements

- VS Code **1.99** or later.
- At least one provider installed and authenticated:
  - **Claude** — `claude` CLI ([Claude Code](https://claude.ai/code))
  - **Grok** — `grok` CLI (beta)
  - **Copilot** — `copilot` or `gh copilot` CLI
  - **OpenCode** — `opencode` ([opencode.ai](https://opencode.ai))
- **Linux**: `xdotool` for keyboard automation (`sudo apt install xdotool`).

---

## License

MIT — see [LICENSE](LICENSE).
