# AutoDev — Autonomous AI Development Agent for VS Code

**AutoDev** runs a continuous autonomous task loop inside VS Code. It reads a `TODO.md` file, dispatches each task to an AI CLI tool (Claude, Copilot, or OpenCode) running in the integrated terminal, waits for the agent to mark the task done, then moves on — continuously, without human intervention.

**GitHub:** https://github.com/autoaidev/autodev-vscode-extension

---

## Table of Contents

- [Quick Start](#quick-start)
- [How It Works](#how-it-works)
- [Task Loop — In Detail](#task-loop--in-detail)
- [TODO.md Format](#todomd-format)
- [AI Providers](#ai-providers)
- [Session Resuming](#session-resuming)
- [Agent Profile (AUTODEV.md)](#agent-profile-autodevmd)
- [Prompt Structure](#prompt-structure)
- [MCP Servers](#mcp-servers)
- [RDP Desktop Sharing](#rdp-desktop-sharing)
- [VNC Desktop Sharing](#vnc-desktop-sharing)
- [Discord Integration](#discord-integration)
- [Webhook / Server Integration](#webhook--server-integration)
- [Settings Reference](#settings-reference)
- [File Layout](#file-layout)
- [Sidebar UI](#sidebar-ui)
- [Permissions & Auto-Accept](#permissions--auto-accept)
- [Output Logs](#output-logs)
- [Development](#development)

---

## Quick Start

1. Install [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) and sign in (`claude login`)
2. Install this extension
3. Open a workspace, create a `TODO.md` with some `- [ ] tasks`
4. Click the **AutoDev** icon in the Activity Bar → **Start**

The loop runs until all tasks are done, then waits for new ones.

### Or use the [autodev-cli](https://www.npmjs.com/package/autodev-cli) launcher

`autodev-cli` is a companion command-line tool that scaffolds a workspace, installs this extension, opens it in your IDE, and (optionally) binds it to a [Pixel Office](https://github.com/autoaidev/pixel-office) agent — all in one shot.

```bash
npm install -g autodev-cli

# Init + open in VS Code or Cursor
autodev --ide=vscode .
autodev --ide=cursor ./myproject

# Bind to a Pixel Office agent via a signed setup URL
autodev --setup-url='https://pixel-office.example.com/api/cli/setup/<id>?expires=…&signature=…' .

# Or paste the WS URL directly
autodev --connect='wss://host/ws?token=<api_key>&endpoint=<slug>' .

# Combine — init, open the IDE, and bind credentials in one command
autodev --setup-url='…' --ide=vscode .
```

The CLI writes settings to `.autodev/settings.json`. The extension picks them up automatically on next activation.

---

## How It Works

```
TODO.md  →  pick task  →  build prompt  →  run AI in terminal
                                                   ↓
                                     AI edits files + marks [x]
                                                   ↓
                                          detect [x] on line
                                                   ↓
                                         save session ID
                                                   ↓
                                           next task  →  ...
```

1. AutoDev picks the first `[ ]` task and marks it `[~]` (in progress)
2. It writes the agent profile + task instruction to `.autodev/`
3. It spawns the AI CLI in a VS Code terminal with the prompt files as arguments
4. It watches `TODO.md` for `[x]` on that exact line number
5. When done, it captures the session ID, fires webhooks/Discord, and picks the next task
6. If no tasks remain, it waits `loopInterval` seconds and polls again

---

## Task Loop — In Detail

`src/taskLoop.ts`

### States

| State | Meaning |
|---|---|
| `idle` | Not started |
| `running` | Active — polling / dispatching |
| `paused` | Waiting for rate-limit reset or manual resume |
| `stopping` | Stop requested, cleaning up |

### Completion detection

AutoDev watches `TODO.md` via the VS Code file system watcher. It looks for the specific **line number** it marked `[~]` to change to `[x]`. This is robust against the AI rephrasing the task text.

- If the CLI exits (exit code file written) before `[x]` appears → one-time reminder: *"Please mark the task done in TODO.md"*
- If no Claude JSONL activity for **15 minutes** → check-in reminder sent
- **Hard timeout** (default 30 min): either retries the task or moves on, based on `retryOnTimeout`

### Rate limit handling

When a rate-limit error is detected in the JSONL stream or stdout capture:
1. Task is reset from `[~]` back to `[ ]`
2. Loop enters `paused` state
3. Resume timer fires at the parsed reset time (e.g. `"resets 9pm (Europe/Sofia)"`)
4. **Retry Now** button in the sidebar forces immediate resume

### Background pollers

While an AI task is running, two pollers continue on 3-second intervals:
- **Discord poller** — pulls new task messages from the configured channel
- **Webhook poller** — pulls pending tasks from the AutoDev server API

New tasks appended during an active run are picked up on the next loop iteration.

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
| `[ ]` | You / Discord / webhook | Pending |
| `[~]` | AutoDev (loop start) | In progress |
| `[x] YYYY-MM-DD  text` | AI agent | Done |

> Two spaces between date and text is required for correct parsing.

Tasks can be added via the sidebar input, Discord messages, the webhook API, or by editing `TODO.md` directly.

---

## AI Providers

All three providers run as CLI tools in a VS Code integrated terminal. Switch via the dropdown in the sidebar.

### claude-cli

Runs Claude Code CLI with full permissions:

```
claude --dangerously-skip-permissions --enable-auto-mode \
  -p "@.autodev/AGENT_PROFILE.md" "@.autodev/MESSAGE.md"
```

**Completion detection:** JSONL file (`~/.claude/projects/<encoded>/*.jsonl`) is polled every 3 s for `stop_reason: end_turn` or `subtype: turn_duration`.

**Live activity:** Tool use is parsed from JSONL and shown in the sidebar in real time — e.g. `Editing: src/game.ts`, `Searching: *.ts`, `Fetching: https://...`

**Stdout capture:** via `Tee-Object` (Windows) / `tee` (Unix) → `.autodev/output/claude-cli.txt`

**Requirements:** `claude` CLI installed and authenticated

### copilot-cli

```
copilot --autopilot --yolo --no-ask-user --allow-all \
  --max-autopilot-continues 2000 -p "@.autodev/messages/<timestamp>.md"
```

The agent profile and task message are combined into a single timestamped file (Copilot CLI does not support two `-p` arguments).

**Requirements:** `gh copilot` or `copilot` CLI installed

### opencode-cli

```
# Windows
$msg = (Get-Content AGENT_PROFILE.md -Raw) + "`n`n" + (Get-Content MESSAGE.md -Raw)
opencode run [-s <sessionId> | -c] $msg

# Unix
opencode run [-s <id> | -c] "$(cat AGENT_PROFILE.md)\n\n$(cat MESSAGE.md)"
```

`-c` starts a new session; `-s <id>` resumes an existing one.

**Requirements:** [opencode](https://opencode.ai) installed

---

## Session Resuming

Enable **Resume Session** checkbox in the sidebar (CLI providers only).

After each completed task, the session ID is extracted from provider output and stored in `.autodev/session-state.json`:

```json
{
  "claude-cli": "abc123def456",
  "copilot-cli": "ses_xyz789",
  "opencode-cli": "ses_abc123"
}
```

On the next task, the stored ID is passed as `--resume <id>` (claude-cli / copilot-cli) or `-s <id>` (opencode-cli). The AI continues in the same conversation with full prior context.

Click **New** in the sidebar to clear the session ID and start fresh.

### How session IDs are found

| Provider | Source | Field |
|---|---|---|
| claude-cli | `~/.claude/projects/<encoded>/*.jsonl` | `"session_id"` |
| copilot-cli | Stdout capture file | `"sessionId"` |
| opencode-cli | `opencode session list --format json` | `"id"` (filtered by cwd) |

If no stored session exists, the extension probes for a live session before the first task.

---

## Agent Profile (AUTODEV.md)

The agent profile gives the AI project-specific context: coding standards, architecture notes, tool preferences, commit conventions, etc.

**Resolution order:**
1. `profilePath` setting (absolute path)
2. `AUTODEV.md` in the same directory as `TODO.md`
3. Built-in default (`media/AUTODEV.default.md`)

### Frontmatter

```markdown
---
title: My Project Agent
description: Custom agent for this repo
noCommit: true
---

# Agent Instructions
...
```

- `noCommit: true` — omits the "commit your changes" step from task instructions

The profile body (frontmatter stripped) is written to `.autodev/AGENT_PROFILE.md` before each task.

---

## Prompt Structure

`src/messageBuilder.ts`

Each task dispatch writes two files:

**`.autodev/AGENT_PROFILE.md`** — agent profile body (roles, standards, conventions)

**`.autodev/MESSAGE.md`** — task instruction:

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

The AI receives both files via `-p "@profile" "@message"` (claude-cli) or combined into one file (copilot-cli / opencode-cli).

---

## MCP Servers

Applied automatically at extension activation. Three MCP servers are written to all project-level config files:

| Server | Package | Purpose |
|---|---|---|
| `memory` | `@modelcontextprotocol/server-memory` | Persistent key-value memory (stored in `.autodev/MEMORY.jsonl`) |
| `playwright` | `@playwright/mcp@latest` | Browser automation and UI testing |
| `sequential-thinking` | `@modelcontextprotocol/server-sequential-thinking` | Structured multi-step reasoning |

Config files updated:

| File | Used by |
|---|---|
| `.claude/settings.local.json` | Claude CLI (project-local) |
| `.vscode/mcp.json` | VS Code Claude extension |
| `opencode.json` | OpenCode CLI |
| `.mcp.json` | Copilot CLI |

---

## RDP Desktop Sharing

AutoDev can stream the agent machine's XFCE desktop to a **pixel-office** browser front-end over WebSocket, using the Guacamole HTML5 protocol. This lets you watch and interact with the remote desktop directly in the browser — no RDP client required.

### Architecture

```
Browser (pixel-office)
    │
    │  WebSocket (wss://…/guac-ws?token=…)
    ▼
guacamole-lite  :4567          ← Node.js WS bridge
    │
    │  Guacamole protocol (TCP)
    ▼
guacd  :4822                   ← C proxy daemon
    │
    │  RDP  :3389
    ▼
xrdp / XFCE session            ← running on the agent machine
```

### Requirements on the agent machine

All three services are installed automatically by the Packer `install.sh` when you build the Hetzner snapshot:

| Service | Package | Port |
|---|---|---|
| `xrdp` | built from source (0.9.24) | 3389 |
| `guacd` | `guacd` apt package | 4822 |
| `guacamole-lite` | npm `guacamole-lite` | 4567 |

If you're setting up manually:
```bash
# xrdp (Ubuntu 22.04) — build from source for clipboard fix
# See: install.sh STEP 5

# guacd
apt-get install -y guacd libguac-client-rdp0

# guacamole-lite
mkdir -p /opt/guacamole-lite && cd /opt/guacamole-lite
npm install guacamole-lite
# + copy server.js from install.sh STEP 5b
systemctl start guacd guacamole-lite
```

### Extension settings

Open the **Settings** tab in the AutoDev sidebar and fill in the **RDP** section:

| Setting | Description | Example |
|---|---|---|
| `rdpEnabled` | Enable RDP sharing | `true` |
| `rdpHost` | IP or hostname of the xrdp server | `127.0.0.1` |
| `rdpPort` | xrdp port | `3389` |
| `rdpUsername` | OS user to log in as | `code1` |
| `rdpPassword` | OS user password | `secret` |
| `rdpDomain` | Windows domain (usually blank) | _(empty)_ |
| `rdpGuacWsUrl` | Public WSS URL of guacamole-lite | `wss://myhost.com/guac-ws` |

**`rdpGuacWsUrl` is required when pixel-office is served over HTTPS.** The browser cannot connect to a plain `ws://` URL from an HTTPS page, so guacamole-lite must be exposed through an HTTPS/WSS reverse proxy path (e.g. Apache `proxy_wstunnel` at `/guac-ws`).

If left empty, the extension falls back to `ws://<rdpHost>:4567` — fine for local/HTTP setups.

### How it works

1. pixel-office sends `rdp_open` to the extension over the AutoDev WebSocket.
2. The extension builds a Guacamole connection token (base64-encoded JSON) containing the RDP credentials and resolution:
   ```json
   {
     "connection": {
       "type": "rdp",
       "settings": {
         "hostname": "127.0.0.1",
         "port": "3389",
         "username": "code1",
         "password": "secret",
         "width": 1280,
         "height": 800,
         "color-depth": 24,
         "ignore-cert": "true"
       }
     }
   }
   ```
3. The extension sends `rdp_guac_token` back to pixel-office with the token and the `wsUrl`.
4. The browser's `GuacCanvas.vue` connects to `<wsUrl>?token=<token>` and renders the desktop using `guacamole-common-js`.
5. Mouse and keyboard events are sent back over the same WebSocket connection.

### Clipboard

Bidirectional clipboard is enabled automatically. Copy in the browser → paste on the remote desktop, and vice versa.

### Pixel-office proxy setup (Apache)

On the pixel-office server, add to the virtual host:

```apache
# Enable required modules:
# a2enmod proxy proxy_http proxy_wstunnel

ProxyPass        /guac-ws  ws://168.119.177.181:4567
ProxyPassReverse /guac-ws  ws://168.119.177.181:4567
```

Replace `168.119.177.181` with the agent machine's IP. The browser then connects to `wss://pixel-office.tools.ooyes.net/guac-ws?token=…`.

---

## VNC Desktop Sharing

AutoDev also supports VNC (RFB protocol) for machines running a VNC server (TigerVNC, TightVNC, x11vnc, etc.).

### Requirements

A VNC server must be running on the agent machine:
```bash
# TigerVNC server
apt-get install -y tigervnc-standalone-server
vncserver :1 -geometry 1280x800 -depth 24

# Or x11vnc (share an existing X display)
x11vnc -display :0 -passwd secret -forever -bg
```

### Extension settings

| Setting | Description | Example |
|---|---|---|
| `vncEnabled` | Enable VNC sharing | `true` |
| `vncHost` | IP or hostname of the VNC server | `127.0.0.1` |
| `vncPort` | VNC port (5900 + display number) | `5900` |
| `vncPassword` | VNC password | `secret` |

### How it works

The extension implements the RFB protocol directly in Node.js (no external tools required). It:
1. Connects to `<vncHost>:<vncPort>` over TCP
2. Performs RFB handshake and VNC authentication
3. Requests FramebufferUpdates and relays compressed bitmap rectangles to pixel-office via `vnc_fbu` WebSocket messages
4. Forwards mouse (`pe`) and keyboard (`ke`) events from the browser to the VNC server
5. Syncs clipboard bidirectionally

pixel-office renders VNC frames on an HTML5 canvas using the same batched deflate-compressed update protocol as RDP.

---

## Discord Integration

Configure **Discord Bot Token**, **Channel ID**, and **Allowed Owners** in Settings.

### Receiving tasks

The `DiscordPoller` polls the channel every 3 s (`GET /channels/{id}/messages?after={cursor}`). Messages from allowed owners (matched by username or user ID) are appended to `TODO.md` as `- [ ]` tasks. File attachments are read and used as task text. The bot reacts with ✅ to each accepted message.

History before the loop started is ignored (cursor is seeded at activation).

### Sending status updates

| Event | Message |
|---|---|
| Loop start | Agent online |
| Task start | ▶ Working on: `<task>` |
| Task done | ✅ Completed: `<task>` |
| Task failed | ❌ Failed: `<task>` — `<error>` |
| Rate limited | ⏳ Rate limited — resuming at `<time>` |
| All done | All tasks completed |
| Loop stopped | Agent offline |

Alternatively, configure a **Discord Webhook URL** (no bot token required) for send-only status posting.

---

## Webhook / Server Integration

Configure **Server Base URL**, **API Key**, and **Webhook Slug** in Settings.

### Outgoing — A2A protocol

All loop events are POSTed as `application/a2a+json` to `<baseUrl>/v1/stream`, following the Agent-to-Agent streaming protocol with envelope types `task`, `statusUpdate`, `artifactUpdate`, and `message`.

### Incoming — task polling

The `WebhookPoller` polls `GET <baseUrl>/v1/logs?status=pending&endpoint_slug=<slug>` every 3 s (with `ETag` caching). New `user_message` events are extracted and appended to `TODO.md`, then acknowledged via `PATCH /v1/logs/{id}`.

---

## Settings Reference

Stored in `.autodev/settings.json` (auto-added to `.gitignore`). The legacy path `.vscode/autodev.json` is still read for back-compat — the next save migrates it to the new location automatically. Edit via the Settings tab or the raw JSON file.

### Server

| Key | Description |
|---|---|
| `serverBaseUrl` | AutoDev server base URL (e.g. `https://myserver.com`) |
| `serverApiKey` | Bearer API key for server auth |
| `webhookSlug` | Endpoint slug for outgoing events and incoming task polling |

### Discord

| Key | Description |
|---|---|
| `discordToken` | Bot token (`Bot xxxx`) |
| `discordChannelId` | Channel to watch for tasks and post status to |
| `discordWebhookUrl` | Webhook URL (simpler send-only alternative, no bot) |
| `discordOwners` | Comma-separated usernames or user IDs allowed to submit tasks |

### Loop

| Key | Default | Description |
|---|---|---|
| `loopInterval` | `30` | Seconds to wait between polls when TODO is empty |
| `taskTimeoutMinutes` | `30` | Hard timeout per task |
| `taskCheckInMinutes` | `20` | Minutes of AI silence before sending a check-in reminder |
| `retryOnTimeout` | `false` | Re-queue timed-out tasks (vs. skipping them) |
| `autoResetPendingTasks` | `true` | Reset `[~]` tasks to `[ ]` when the loop starts |
| `resumeSession` | `false` | Pass session ID to CLI providers for conversation continuity |

### RDP

| Key | Default | Description |
|---|---|---|
| `rdpEnabled` | `false` | Enable RDP desktop sharing via Guacamole |
| `rdpHost` | _(empty)_ | xrdp server IP / hostname |
| `rdpPort` | `3389` | xrdp port |
| `rdpUsername` | _(empty)_ | OS user to authenticate as |
| `rdpPassword` | _(empty)_ | OS user password |
| `rdpDomain` | _(empty)_ | Windows domain (usually blank for Linux) |
| `rdpGuacWsUrl` | _(empty)_ | Public WSS URL of guacamole-lite — required for HTTPS frontends (e.g. `wss://myhost.com/guac-ws`) |

### VNC

| Key | Default | Description |
|---|---|---|
| `vncEnabled` | `false` | Enable VNC desktop sharing |
| `vncHost` | _(empty)_ | VNC server IP / hostname |
| `vncPort` | `5900` | VNC port (5900 + display number) |
| `vncPassword` | _(empty)_ | VNC password |

### Paths

| Key | Default | Description |
|---|---|---|
| `todoPath` | `TODO.md` in workspace root | Path to task file |
| `profilePath` | `AUTODEV.md` in workspace root | Path to agent profile |

---

## File Layout

```
<workspace>/
├── TODO.md                         ← task list (read/written by the loop)
├── AUTODEV.md                      ← agent profile (optional, per-project)
├── .vscode/
│   ├── autodev.json                ← AutoDev settings
│   ├── mcp.json                    ← MCP servers for VS Code
│   └── settings.json               ← VS Code settings (auto-accept, permissions)
├── .claude/
│   ├── settings.json               ← Claude CLI permissions (allow: *)
│   └── settings.local.json         ← Claude CLI MCP servers (project-local)
├── .mcp.json                       ← Copilot CLI MCP servers
├── opencode.json                   ← OpenCode config + MCP servers
└── .autodev/                       ← runtime files (all gitignored)
    ├── AGENT_PROFILE.md            ← resolved profile (written before each task)
    ├── MESSAGE.md                  ← task instruction (written before each task)
    ├── session-state.json          ← stored session IDs per provider
    ├── MEMORY.jsonl                ← MCP memory server storage
    ├── messages/                   ← combined prompt files for Copilot CLI
    └── output/
        ├── claude-cli.txt          ← stdout capture
        ├── claude-cli-exit.txt     ← exit code
        ├── copilot-cli.txt
        ├── copilot-cli-exit.txt
        ├── opencode-cli.txt
        └── opencode-cli-exit.txt
```

---

## Sidebar UI

Click the **AutoDev** icon in the Activity Bar.

### Tasks tab

| Element | Purpose |
|---|---|
| Provider dropdown | Switch between `claude-cli`, `copilot-cli`, `opencode-cli` |
| Resume Session checkbox | Enable session ID reuse across tasks |
| New button | Clear stored session ID (start fresh conversation) |
| Session ID badge | Shows the currently stored session ID |
| Start / Stop / Retry Now | Control the loop |
| Loop status | Current state + active task + live tool activity |
| Add task input | Type a task + Enter to append `- [ ]` to TODO.md |
| Task list | Pending tasks (click to jump to line in editor) + completed tasks |

### Settings tab

- Grouped fields for Server, Discord, Loop, and Paths
- **Save** — writes `.autodev/settings.json`
- **Edit raw JSON** — opens settings file in editor
- **Profile** dropdown — built-in profiles from `media/*.md`

---

## Permissions & Auto-Accept

Written automatically at activation so the AI can operate without interactive prompts.

**`~/.claude/settings.json`** (Claude CLI global):
```json
{
  "permissions": {
    "defaultMode": "bypassPermissions",
    "skipDangerousModePermissionPrompt": true
  }
}
```

**`.claude/settings.json`** (project-local):
```json
{ "permissions": { "allow": ["*"] } }
```

**`.vscode/settings.json`** (workspace):
```json
{
  "chat.editing.autoAccept": true,
  "claudeCode.initialPermissionMode": "bypassPermissions",
  "claudeCode.allowDangerouslySkipPermissions": true
}
```

---

## Output Logs

Open **Output → AutoDev** for live logs:

```
[AutoDev] Extension activated
[AutoDev] Task loop starting — TODO: h:\project\TODO.md
[AutoDev] Auto-reset in-progress tasks to [ ]
[AutoDev] Loop: running
[AutoDev] ▶ Task [1]: Build a music game
[AutoDev] Dispatching task: Build a music game
[AutoDev] ✅ Task done: Build a music game
[AutoDev] ▶ Task [2]: Add high score table
[AutoDev] ⚠️ Check-in: reminding AI to mark TODO.md if done
[AutoDev] ✅ Task done: Add high score table
[AutoDev] All tasks completed ✓
[AutoDev] No pending tasks — waiting 30s…
```

---

## Development

```bash
git clone https://github.com/autoaidev/autodev-vscode-extension
cd autodev-vscode-extension
npm install
npm run compile
```

Press `F5` to launch the Extension Development Host. Use `npm run watch` for incremental rebuilds.

### Project Structure

```
src/
├── extension.ts          # Activation, commands, auto-accept settings
├── taskLoop.ts           # Core task loop engine
├── dispatcher.ts         # Routes tasks to the correct provider terminal
├── sidebar.ts            # Webview sidebar panel (HTML + message handling)
├── configManager.ts      # MCP + permission config sync
├── sessionState.ts       # Session ID persistence + file paths
├── settings.ts           # Settings load/save (.autodev/settings.json, legacy .vscode/autodev.json)
├── todo.ts               # TODO.md parser and writer
├── messageBuilder.ts     # Prompt builder (profile + task instruction)
├── webhook.ts            # Discord REST + A2A webhook client
├── webhookPoller.ts      # Incoming task polling from AutoDev server
├── discordPoller.ts      # Incoming task polling from Discord
├── mcpManager.ts         # MCP server config read/write
└── providers/
    ├── claudeCliProvider.ts    # JSONL parsing, command builder, session probe
    ├── copilotCliProvider.ts   # Command builder, session probe
    └── opencodeCliProvider.ts  # Command builder, session list query
media/
├── icon.svg
└── AUTODEV.default.md    # Built-in agent profile
```

---

## Requirements

- VS Code 1.99 or later
- At least one provider installed and authenticated:
  - **claude-cli**: `claude` CLI ([Claude Code](https://claude.ai/code))
  - **copilot-cli**: `copilot` or `gh copilot` CLI
  - **opencode-cli**: `opencode` ([opencode.ai](https://opencode.ai))
- **Linux only**: `xdotool` for keyboard automation (`sudo apt install xdotool`)

---

## License

MIT
