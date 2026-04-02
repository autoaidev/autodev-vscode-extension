# AutoDev

Autonomous AI task loop for VS Code. Reads `TODO.md`, dispatches each task to **Claude Code** or **GitHub Copilot**, waits for the agent to finish and mark the task done, then moves to the next one — continuously, without human intervention.

**GitHub:** https://github.com/autoaidev/autodev-vscode-extension

---

## How it works

1. You write tasks in `TODO.md` using the `- [ ] task text` format
2. AutoDev picks the first pending task and sends it to Claude or Copilot
3. The agent works, edits files, and marks the task `- [x] YYYY-MM-DD  task text` when done
4. AutoDev detects the `[x]` marker and moves to the next task
5. New tasks can be added at any time via the sidebar, Discord, or directly editing `TODO.md`

---

## Features

### Autonomous Task Loop
- Runs forever — no max iteration limit
- At startup, resets any `[~]` in-progress tasks back to `[ ]` (configurable)
- Sends a periodic reminder to the AI if a task has been running longer than the check-in interval without being marked done
- Configurable task timeout — on timeout, either mark failed or retry the task

### Sidebar Panel
Click the AutoDev icon in the Activity Bar to open the panel.

- **Tasks tab** — live list of all tasks from `TODO.md` with ✓ / ◑ / ○ status
- **Settings tab** — configure all options without editing JSON directly
- **Add task** input — append a new `[ ]` task to `TODO.md` instantly
- **Start / Stop** loop button

### Provider Support

| Provider | Extension required |
|---|---|
| **Claude** (default) | [Claude Code](https://marketplace.visualstudio.com/items?itemName=anthropic.claude-code) |
| **Copilot** | [GitHub Copilot Chat](https://marketplace.visualstudio.com/items?itemName=GitHub.copilot-chat) |

Switch providers from the sidebar. AutoDev applies Claude Code permission bypass settings on activation so no permission prompts interrupt the loop.

### Task Notifications
AutoDev posts messages to Discord and/or an A2A webhook server as the loop runs:

| Event | Discord / Webhook |
|---|---|
| Loop started | 🚀 |
| Task started | ▶️ task label + remaining count |
| Check-in (long task) | ⏳ elapsed time + AI reminder to mark TODO.md |
| Task done | ✅ |
| Task failed / timed out | ❌ |
| All tasks done | ✅ All tasks done! |
| Loop ended | 👋 |

### Discord Bot Poller
AutoDev can receive new tasks from Discord. Messages from allowed owners in the configured channel are appended to `TODO.md` as new `[ ]` tasks. History before the loop started is ignored.

### A2A Webhook Server
AutoDev can poll an autodev server (`/v1/logs`) for incoming tasks and post structured `StreamResponse` events to `/webhook/{slug}` matching the autodev server protocol.

### Auto-Accept Edits
On activation, AutoDev sets:

| VS Code Setting | Value |
|---|---|
| `chat.editing.autoAcceptDelay` | 800 ms |
| `chat.editing.autoAccept` | `true` |
| `github.copilot.chat.agent.runTasks` | `true` |

---

## TODO.md Format

```markdown
## Todo
- [ ] build the login page
- [ ] add unit tests for auth module

## In Progress
- [~] refactor database layer

## Done
- [x] 2026-04-01  set up project scaffold
```

Tasks move through: `[ ]` → `[~]` (AutoDev marks in-progress) → `[x] YYYY-MM-DD` (AI marks done).

> **The AI must mark tasks done with two spaces between the date and text:**
> `- [x] 2026-04-02  task text`

---

## Settings

Stored in `.vscode/autodev.json` in your workspace. Edit via the **⚙ Settings** tab or the raw JSON file.

### Server
| Key | Description |
|---|---|
| `serverBaseUrl` | Base URL of your autodev server (e.g. `https://myserver.com`) |
| `serverApiKey` | API key (`Authorization: Bearer`) |
| `webhookSlug` | Slug for `/webhook/{slug}` events and `/v1/logs?endpoint_slug={slug}` polling |

### Discord
| Key | Description |
|---|---|
| `discordToken` | Bot token (`Bot xxxx`) |
| `discordChannelId` | Channel ID to post messages to and poll for task input |
| `discordWebhookUrl` | Webhook URL alternative (simpler, no bot required, send-only) |
| `discordOwners` | Comma-separated usernames or user IDs allowed to send tasks |

### Loop
| Key | Default | Description |
|---|---|---|
| `provider` | `claude` | `claude` or `copilot` |
| `loopInterval` | `30` | Seconds to wait when no tasks are pending |
| `taskTimeoutMinutes` | `30` | Minutes before a running task is timed out |
| `taskCheckInMinutes` | `20` | Minutes between check-in reminders to the AI |
| `retryOnTimeout` | `false` | Retry timed-out tasks instead of marking failed |
| `autoResetPendingTasks` | `true` | Reset `[~]` tasks to `[ ]` on loop start |

### Paths
| Key | Default | Description |
|---|---|---|
| `todoPath` | `TODO.md` in workspace root | Path to the task file |
| `profilePath` | `AUTODEV.md` in workspace root | Path to the agent instructions file |

---

## Agent Instructions (AUTODEV.md)

Place an `AUTODEV.md` file in your workspace root to give the agent project-specific context — coding standards, architecture notes, tool preferences. If none exists, a built-in default is used.

The most critical instruction is already in the default profile:

> Mark each task done in `TODO.md` as `- [x] YYYY-MM-DD  task text` (two spaces, lowercase x) before stopping.

---

## Requirements

- VS Code 1.99 or later
- At least one of:
  - [Claude Code](https://marketplace.visualstudio.com/items?itemName=anthropic.claude-code) — signed in
  - [GitHub Copilot Chat](https://marketplace.visualstudio.com/items?itemName=GitHub.copilot-chat) — signed in
- **Linux only:** `xdotool` for auto-submit (`sudo apt install xdotool`)

---

## Output Logs

Open **Output → AutoDev** to see live logs:

```
[AutoDev] Task loop starting — TODO: /workspace/TODO.md
[AutoDev] Auto-reset in-progress tasks to [ ]
[AutoDev] ▶ Task [1]: build the login page
[AutoDev] Dispatching task: build the login page
[AutoDev] ✅ Task done: build the login page
[AutoDev] ▶ Task [2]: add unit tests for auth module
[AutoDev] ⚠️ Check-in: reminding AI to mark TODO.md if done
[AutoDev] ✅ Task done: add unit tests for auth module
[AutoDev] All tasks completed ✓
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

## Project Structure

```
autodev-vscode-extension/
├── media/
│   └── icon.svg          # Activity bar icon
├── src/
│   └── extension.ts      # All extension logic
├── .vscode/
│   ├── launch.json       # F5 debug config
│   └── tasks.json        # Compile / watch tasks
├── package.json
└── tsconfig.json
```

---

## How Completion Detection Works

AutoDev uses the **VS Code Language Model API** (`vscode.lm`) to send requests directly to the AI model rather than delegating to a chat panel. This means:

1. AutoDev owns the stream — it knows **exactly** when the last token arrives.
2. The moment the stream ends, the sidebar entry flips from **⚡ Thinking** to **✓ Done**.
3. No heuristics, no timers, no clicking required.

**Fallback mode** (when the LM API returns no models for the selected provider): AutoDev opens the chat panel directly and uses a `activeTextEditor` focus-change heuristic — the entry marks Done when you click back into a code file after reading the response.
