# AutoDev AI Prompts

A VS Code extension that sends your selected code or current file to an AI model with one-click predefined prompts, streams the response directly into a dedicated sidebar panel, and marks entries as **Done** the moment the stream ends — no guessing, no manual clicking.

---

## Features

### Live Streaming Sidebar
Click the AutoDev icon in the Activity Bar to open the **Chat History** panel.

- Responses stream **word-by-word** into the sidebar in real time
- **⚡ Thinking** badge (animated) while the model generates
- **✓ Done** badge the instant the stream finishes — exact, not a heuristic
- **■ Stop** button cancels a stream mid-response
- **Copy** button copies the full response to the clipboard
- Click any entry header to collapse / expand the response
- Trash icon in the panel title bar clears all history

### Provider Selector
Toggle between AI providers directly in the sidebar:

| Provider | Extension required |
|---|---|
| **Copilot** | GitHub Copilot Chat |
| **Claude** | Claude (by Anthropic) |

The selected provider is persisted across sessions. If a provider's extension is not installed, its button is disabled.

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
  - [Claude](https://marketplace.visualstudio.com/items?itemName=anthropics.claude-code) — signed in

---

## Running Locally (Development)

```bash
git clone <repo>
cd autodev-vscode-extension
npm install
```

Press `F5` to launch the Extension Development Host. The extension loads automatically in the new window.

To rebuild on file changes, run the watch task instead:

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
