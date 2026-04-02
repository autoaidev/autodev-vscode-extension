# AutoDev AI Prompts

A VS Code extension that sends your selected code or current file to Copilot Chat or Claude Code with one-click predefined prompts. It tracks each task in a dedicated sidebar panel and automatically marks it **Done** when the agent finishes.

---

## Features

### Sidebar Panel (Chat History)
Click the AutoDev icon in the Activity Bar to open the **Chat History** panel.

- Each prompt is tracked as an entry with **⏳ Sent** → **✓ Done** status
- **Mark Done** button on each entry for manual override
- Trash icon in the panel title bar clears all history
- Entries persist for the session (up to 30)

### Provider Selector
Toggle between AI providers directly in the sidebar:

| Provider | Extension required |
|---|---|
| **Copilot** | GitHub Copilot Chat (`GitHub.copilot-chat`) |
| **Claude** | Claude Code (`anthropic.claude-code`) |

The selected provider is persisted across sessions.

### Predefined Prompts
Pick from 7 built-in templates via quick-pick:

| Prompt | What it does |
|---|---|
| Explain | Plain-English explanation of the code |
| Find Bugs | Identifies logic errors and suggests fixes |
| Write Tests | Generates unit tests using the project's framework |
| Refactor | Readability and maintainability improvements |
| Generate Docs | Adds JSDoc / docstring comments without changing logic |
| Security Review | Scans for OWASP-style vulnerabilities |
| Optimize Performance | Finds bottlenecks and suggests concrete optimizations |

### Smart Context
- **Selected text** → sends only the selection
- **No selection** → sends the entire file
- Files over 80,000 characters are automatically truncated with a warning

### Copilot Integration
- Opens GitHub Copilot Chat in full agent mode (can edit files, run tasks, etc.)
- Auto-accepts file edits every second — no need to click "Keep"
- Detects when the agent finishes and marks the entry **Done**

### Claude Code Integration
- Detects if a Claude panel is already open and reuses it
- If no panel is open, resumes the most recent Claude session for the current workspace
- Prompt is automatically submitted — no manual paste required
- Works cross-platform: Windows (SendKeys), macOS (osascript), Linux (xdotool)

### Auto-Accept File Edits
On startup, AutoDev applies these VS Code settings globally:

| Setting | Value |
|---|---|
| `chat.editing.autoAcceptDelay` | 800 ms |
| `chat.editing.autoAccept` | true |
| `github.copilot.chat.agent.runTasks` | true |

This removes the "Keep / Undo" prompt after Copilot edits files.

### Completion Detection
AutoDev uses two strategies simultaneously to detect when an agent is done:

1. **File-save detection** — any file saved by the agent sets a "working" flag
2. **Quiet period** — if no file is saved for 20 seconds after activity, the task is marked Done
3. **User returns to editor** — moving the cursor back into a code editor after activity also marks Done
4. **Safety timeout** — 10-minute hard limit in case detection misses

---

## Usage

### Keyboard Shortcut
Press `Ctrl+Alt+C` (`Cmd+Alt+C` on Mac) from any editor.

### Right-Click Menu
Select code → right-click → **AutoDev: Send to Copilot Chat**

### Command Palette
`Ctrl+Shift+P` → **AutoDev: Send to Copilot Chat**

---

## Requirements

- VS Code 1.99 or later
- At least one of:
  - [GitHub Copilot Chat](https://marketplace.visualstudio.com/items?itemName=GitHub.copilot-chat) — signed in
  - [Claude Code](https://marketplace.visualstudio.com/items?itemName=anthropic.claude-code) — signed in
- **Linux only:** `xdotool` for auto-submit (`sudo apt install xdotool`)

---

## Debugging

Open **Output → AutoDev** to see live logs:

```
[AutoDev] Extension activated
[AutoDev] Task started → 1234567890-abc (Copilot)
[AutoDev] → Agent saved file
[AutoDev] Quiet period (20s) → marking complete
[AutoDev] ✅ Task 1234567890-abc → COMPLETE
```

---

## Running Locally (Development)

```bash
git clone <repo>
cd autodev-vscode-extension
npm install
```

Press `F5` to launch the Extension Development Host.

To rebuild on file changes:

```bash
npm run watch
```

---

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
