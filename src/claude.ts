import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { ProviderId, PROVIDERS } from './providers';
import { getSessionId, captureAndSaveSessionId, SESSION_OUT_FILE } from './sessionState';
import { loadSettings } from './settings';

// ---------------------------------------------------------------------------
// Claude session helpers
// ---------------------------------------------------------------------------

function claudeProjectFolder(workspacePath: string): string {
  return workspacePath.replace(/[:\\/]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

export function findLatestClaudeSession(workspacePath: string): string | undefined {
  try {
    const claudeDir = process.env['CLAUDE_CONFIG_DIR'] ?? path.join(os.homedir(), '.claude');
    const projectsDir = path.join(claudeDir, 'projects');
    const folders = fs.readdirSync(projectsDir);
    const encoded = claudeProjectFolder(workspacePath);
    const match = folders.find(f => f === encoded || encoded.startsWith(f) || f.startsWith(encoded.slice(0, 8)));
    if (!match) { return undefined; }
    const sessionsDir = path.join(projectsDir, match);
    const files = fs.readdirSync(sessionsDir)
      .filter(f => f.endsWith('.jsonl') && !f.startsWith('agent-'))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(sessionsDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    return files[0]?.name.replace('.jsonl', '');
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Claude JSONL session output reader
// ---------------------------------------------------------------------------

/** Resolve the path to the most recent Claude session JSONL for this workspace. */
function resolveClaudeJsonl(workspacePath: string): string | undefined {
  try {
    const claudeDir = process.env['CLAUDE_CONFIG_DIR'] ?? path.join(os.homedir(), '.claude');
    const projectsDir = path.join(claudeDir, 'projects');
    const encoded = claudeProjectFolder(workspacePath);
    const folders = fs.readdirSync(projectsDir);
    const match = folders.find(f => f === encoded || encoded.startsWith(f) || f.startsWith(encoded.slice(0, 8)));
    if (!match) { return undefined; }
    const sessionsDir = path.join(projectsDir, match);
    const files = fs.readdirSync(sessionsDir)
      .filter(f => f.endsWith('.jsonl') && !f.startsWith('agent-'))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(sessionsDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (!files[0]) { return undefined; }
    return path.join(sessionsDir, files[0].name);
  } catch { return undefined; }
}

/**
 * Return the current byte size of the JSONL session file.
 * Call this just before sending a task to AI; store the result as a cursor.
 */
export function getClaudeSessionCursor(workspacePath: string): number {
  const p = resolveClaudeJsonl(workspacePath);
  if (!p) { return 0; }
  try { return fs.statSync(p).size; } catch { return 0; }
}

/** Rich state parsed from the JSONL transcript since a cursor offset. */
export interface ClaudeSessionState {
  /** True if a definitive turn-end was detected (system.turn_duration or stop_reason=end_turn). */
  hasEndTurn: boolean;
  /** Human-readable label for the tool Claude is currently running, if any. */
  activeToolStatus?: string;
  /** True if a bash_progress or mcp_progress record was seen (command still executing). */
  hasProgress: boolean;
}

function formatToolStatus(toolName: string, input: Record<string, unknown>): string {
  const base = (p: unknown) => (typeof p === 'string' ? path.basename(p) : '');
  switch (toolName) {
    case 'Read':    return `Reading ${base(input['file_path'])}`;
    case 'Edit':    return `Editing ${base(input['file_path'])}`;
    case 'Write':   return `Writing ${base(input['file_path'])}`;
    case 'Bash': {
      const cmd = String(input['command'] ?? '');
      return `Running: ${cmd.length > 60 ? cmd.slice(0, 60) + '\u2026' : cmd}`;
    }
    case 'Glob':      return 'Searching files';
    case 'Grep':      return 'Searching code';
    case 'WebFetch':  return 'Fetching web content';
    case 'WebSearch': return 'Searching the web';
    case 'Task':
    case 'Agent': {
      const desc = typeof input['description'] === 'string' ? input['description'] as string : '';
      return desc ? `Subtask: ${desc.length > 50 ? desc.slice(0, 50) + '\u2026' : desc}` : 'Running subtask';
    }
    case 'AskUserQuestion': return 'Waiting for answer';
    case 'EnterPlanMode':   return 'Planning';
    default: return `Using ${toolName}`;
  }
}

/**
 * Parse the JSONL bytes written since `fromByte` and return a rich state snapshot:
 * - `hasEndTurn`: system.turn_duration fired, or stop_reason=end_turn seen
 * - `activeToolStatus`: label of the most recently invoked tool (cleared on turn end)
 * - `hasProgress`: bash_progress / mcp_progress records were seen (command still running)
 *
 * Processes lines sequentially so the returned values reflect the *latest* state.
 */
export function parseClaudeStateSince(workspacePath: string, fromByte: number): ClaudeSessionState {
  const result: ClaudeSessionState = { hasEndTurn: false, hasProgress: false };
  const p = resolveClaudeJsonl(workspacePath);
  if (!p) { return result; }
  try {
    const size = fs.statSync(p).size;
    if (size <= fromByte) { return result; }
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(size - fromByte);
    fs.readSync(fd, buf, 0, buf.length, fromByte);
    fs.closeSync(fd);
    for (const line of buf.toString('utf8').split('\n')) {
      const t = line.trim();
      if (!t) { continue; }
      try {
        const record = JSON.parse(t) as Record<string, unknown>;
        const rtype = record['type'] as string | undefined;

        if (rtype === 'assistant') {
          const msgContent = (record['message'] as Record<string, unknown> | undefined)?.['content']
            ?? record['content'];
          if (Array.isArray(msgContent)) {
            for (const block of msgContent as Array<Record<string, unknown>>) {
              if (block['type'] === 'tool_use') {
                const name = String(block['name'] ?? '');
                const input = (block['input'] ?? {}) as Record<string, unknown>;
                result.activeToolStatus = formatToolStatus(name, input);
                result.hasEndTurn = false; // new tool use means we're still going
              }
            }
          }
        } else if (rtype === 'user') {
          const msgContent = (record['message'] as Record<string, unknown> | undefined)?.['content']
            ?? record['content'];
          if (Array.isArray(msgContent)) {
            const hasToolResult = (msgContent as Array<Record<string, unknown>>)
              .some(b => b['type'] === 'tool_result');
            if (!hasToolResult) {
              // Plain user message = new turn starting, clear any previous activity
              result.activeToolStatus = undefined;
              result.hasEndTurn = false;
            }
          }
        } else if (rtype === 'system') {
          if ((record['subtype'] as string | undefined) === 'turn_duration') {
            // Definitive end-of-turn signal
            result.hasEndTurn = true;
            result.activeToolStatus = undefined;
          }
        } else if (rtype === 'progress') {
          const data = record['data'] as Record<string, unknown> | undefined;
          const dataType = data?.['type'] as string | undefined;
          if (dataType === 'bash_progress' || dataType === 'mcp_progress') {
            result.hasProgress = true;
          }
        }

        // Fallback: stop_reason=end_turn (older Claude Code versions)
        if ((record['stop_reason'] as string | undefined) === 'end_turn') {
          result.hasEndTurn = true;
        }
      } catch { /* skip malformed lines */ }
    }
  } catch { /* file unreadable */ }
  return result;
}

/**
 * @deprecated Use parseClaudeStateSince instead.
 * Kept for backwards compatibility — returns true if hasEndTurn.
 */
export function hasClaudeEndTurnSince(workspacePath: string, fromByte: number): boolean {
  return parseClaudeStateSince(workspacePath, fromByte).hasEndTurn;
}

/**
 * Read all assistant text blocks appended to the JSONL since `fromByte`.
 * Returns concatenated text, or empty string if nothing new / file not found.
 */
export function readClaudeOutputSince(workspacePath: string, fromByte: number): string {
  const p = resolveClaudeJsonl(workspacePath);
  if (!p) { return ''; }
  try {
    const size = fs.statSync(p).size;
    if (size <= fromByte) { return ''; }
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(size - fromByte);
    fs.readSync(fd, buf, 0, buf.length, fromByte);
    fs.closeSync(fd);
    const parts: string[] = [];
    for (const line of buf.toString('utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) { continue; }
      try {
        const entry = JSON.parse(trimmed) as Record<string, unknown>;
        const entryMsg = entry['message'] as { role?: string; content?: Array<{ type?: string; text?: string }> | string } | undefined;
        if (entry['type'] === 'assistant' || entryMsg?.role === 'assistant') {
          const content = entryMsg?.content;
          if (typeof content === 'string') {
            parts.push(content);
          } else if (Array.isArray(content)) {
            for (const part of content) {
              if (part.type === 'text' && part.text) { parts.push(part.text); }
            }
          }
        }
      } catch { /* skip malformed lines */ }
    }
    return parts.join('\n\n');
  } catch { return ''; }
}

// ---------------------------------------------------------------------------
// Send prompt to AI (dispatches only — does not await AI response)
// ---------------------------------------------------------------------------

const ACCEPT_CMDS = [
  'chatEditor.action.acceptAllHunks',
  'workbench.action.chat.editing.acceptAllFiles',
  'workbench.action.chat.editing.acceptAll',
  'github.copilot.chat.acceptAllEdits',
  'chat.acceptAllEdits',
];

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Bring the VS Code window to the OS foreground so subsequent SendKeys land there.
 * Runs asynchronously — caller should await the returned Promise.
 */
/** Encode a PowerShell script as UTF-16LE base64 for -EncodedCommand (avoids all shell escaping). */
function psEncoded(script: string): string {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return `powershell -NoProfile -WindowStyle Hidden -EncodedCommand ${encoded}`;
}

/**
 * Send Enter once — submits pre-filled prompt in a freshly opened Claude panel.
 */
function sendEnter(log: (msg: string) => void): void {
  let cmd: string;
  if (process.platform === 'win32') {
    cmd = psEncoded(`Add-Type -AssemblyName System.Windows.Forms\n[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')`);
  } else if (process.platform === 'darwin') {
    cmd = `osascript -e 'tell application "System Events" to key code 36'`;
  } else {
    cmd = `xdotool key Return`;
  }
  exec(cmd, err => { if (err) { log(`sendEnter error: ${err.message}`); } });
}

/**
 * Bring VS Code to foreground, focus Claude input, paste clipboard and submit.
 * All in one process to prevent inter-process focus loss.
 */
function pasteAndSubmit(log: (msg: string) => void): void {
  let cmd: string;
  if (process.platform === 'win32') {
    const script = [
      // Force VS Code to OS foreground using AttachThreadInput (reliable even from background)
      `Add-Type -TypeDefinition @'`,
      `using System; using System.Runtime.InteropServices;`,
      `public class WinFocus {`,
      `  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);`,
      `  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();`,
      `  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);`,
      `  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);`,
      `  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();`,
      `}`,
      `'@ -ErrorAction SilentlyContinue`,
      `$p = Get-Process -Name 'Code' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1`,
      `if ($p) {`,
      `  $fg = [WinFocus]::GetForegroundWindow()`,
      `  $fgTid = 0; [WinFocus]::GetWindowThreadProcessId($fg, [ref]$fgTid) | Out-Null`,
      `  $vsTid = 0; [WinFocus]::GetWindowThreadProcessId($p.MainWindowHandle, [ref]$vsTid) | Out-Null`,
      `  [WinFocus]::AttachThreadInput($vsTid, $fgTid, $true) | Out-Null`,
      `  [WinFocus]::SetForegroundWindow($p.MainWindowHandle) | Out-Null`,
      `  [WinFocus]::AttachThreadInput($vsTid, $fgTid, $false) | Out-Null`,
      `  Start-Sleep -Milliseconds 400`,
      `}`,
      // Paste, wait for @file picker to appear, Space to dismiss it, then Enter to submit
      `Add-Type -AssemblyName System.Windows.Forms`,
      `[System.Windows.Forms.SendKeys]::SendWait('^v')`,
      `Start-Sleep -Milliseconds 1000`,
      `[System.Windows.Forms.SendKeys]::SendWait(' ')`,
      `Start-Sleep -Milliseconds 300`,
      `[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')`,
    ].join('\n');
    cmd = psEncoded(script);
  } else if (process.platform === 'darwin') {
    cmd = [
      `osascript -e 'tell application "Visual Studio Code" to activate'`,
      `sleep 0.4`,
      `osascript -e 'tell application "System Events" to keystroke "v" using {command down}'`,
      `sleep 1.0`,
      `osascript -e 'tell application "System Events" to keystroke " "'`,
      `sleep 0.3`,
      `osascript -e 'tell application "System Events" to key code 36'`,
    ].join(' && ');
  } else {
    cmd = [
      `xdotool search --name "Visual Studio Code" windowactivate --sync 2>/dev/null || true`,
      `sleep 0.4`,
      `xdotool key ctrl+v`,
      `sleep 1.0`,
      `xdotool type ' '`,
      `sleep 0.3`,
      `xdotool key Return`,
    ].join(' && ');
  }
  exec(cmd, err => { if (err) { log(`pasteAndSubmit error: ${err.message}`); } });
}

/**
 * Build the shell command to run a CLI AI provider.
 * Prompt is always passed via a file to avoid shell quoting issues.
 * On Windows (PowerShell): pipe via Get-Content.
 * On Unix: stdin redirect.
 */
function buildCliCommand(
  providerId: 'claude-cli' | 'copilot-cli' | 'opencode-cli',
  promptFile: string,
  sessionOutFile: string,
  sessionId?: string,
): string {
  const isWin = process.platform === 'win32';
  const fileArg = JSON.stringify(promptFile);
  const pArg = isWin
    ? `-p (Get-Content ${fileArg} -Raw)`
    : `-p "$(cat ${fileArg})"`;
  const promptRefArg = `-p ${JSON.stringify(`@${promptFile}`)}`;

  // Tee stdout to session capture file (copilot/opencode only — claude uses JSONL)
  const tee = isWin
    ? ` | Tee-Object ${JSON.stringify(sessionOutFile)}`
    : ` | tee ${JSON.stringify(sessionOutFile)}`;

  if (providerId === 'claude-cli') {
    const resume = sessionId ? ` --resume ${sessionId}` : '';
    return `claude --dangerously-skip-permissions${resume} ${pArg}`;
  } else if (providerId === 'copilot-cli') {
    const resume = sessionId ? ` --resume ${sessionId}` : '';
    // For Copilot CLI, pass @file so the CLI reads the file itself.
    return `copilot --autopilot --yolo --no-ask-user --allow-all --allow-all-paths --allow-all-urls --allow-all-tools --enable-all-github-mcp-tools --stream on --max-autopilot-continues 2000${resume} ${promptRefArg}`;
  } else {
    const session = sessionId ? ` --session ${sessionId}` : '';
    const posArg = isWin ? `(Get-Content ${fileArg} -Raw)` : `"$(cat ${fileArg})"`;
    return `opencode run${session} ${posArg}${tee}`;
  }
}

/** Ensure `entry` is present in the project .gitignore (no-op if already there). */
function ensureProjectGitignore(root: string, entry: string): void {
  const gitignorePath = path.join(root, '.gitignore');
  try {
    let content = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf8') : '';
    if (content.split('\n').map(l => l.trim()).includes(entry)) { return; }
    if (content.length > 0 && !content.endsWith('\n')) { content += '\n'; }
    fs.writeFileSync(gitignorePath, content + `${entry}\n`, 'utf8');
  } catch { /* ignore */ }
}

export async function sendPromptToAi(
  providerId: ProviderId,
  prompt: string,
  log: (msg: string) => void,
  _focusOnly = false,
): Promise<void> {
  const providerCfg = PROVIDERS[providerId];

  // CLI providers — run in a VS Code terminal
  if (providerCfg.isCli) {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) { throw new Error('No workspace folder open'); }

    // Write prompt to project folder so multiple instances don't collide
    const promptFile = path.join(root, 'TEMP_PROMPT.md');
    const sessionOutFile = path.join(root, SESSION_OUT_FILE);
    fs.writeFileSync(promptFile, prompt, 'utf8');
    ensureProjectGitignore(root, 'TEMP_PROMPT.md');
    ensureProjectGitignore(root, SESSION_OUT_FILE);
    ensureProjectGitignore(root, '.autodev-session-state.json');

    const settings = loadSettings();
    const cliId = providerId as 'claude-cli' | 'copilot-cli' | 'opencode-cli';
    const sessionId = settings.resumeSession ? getSessionId(root, providerId) : undefined;
    const cmd = buildCliCommand(cliId, promptFile, sessionOutFile, sessionId);

    const termName = `AutoDev: ${providerCfg.label}`;
    const terminal = vscode.window.terminals.find(t => t.name === termName)
      ?? vscode.window.createTerminal({ name: termName, cwd: root });
    terminal.show(true);
    terminal.sendText(cmd);
    log(`Sent to ${termName}${sessionId ? ` (session: ${sessionId})` : ''}: ${cmd}`);

    // After the task completes the taskLoop will call captureAndSaveSessionId.
    // For claude-cli, also pass the JSONL-based session ID as a fallback.
    if (cliId === 'claude-cli') {
      const jsonlSession = findLatestClaudeSession(root);
      if (jsonlSession) {
        captureAndSaveSessionId(root, providerId, jsonlSession);
      }
    }
    return;
  }

  if (!vscode.extensions.getExtension(providerCfg.extensionId)) {
    throw new Error(`"${providerCfg.label}" extension is not installed`);
  }

  if (providerId === 'claude') {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    const settings = loadSettings();
    const sessionId = settings.resumeSession ? getSessionId(root, providerId) : undefined;

    // Check if Claude panel already has an open session tab
    const existingTab = vscode.window.tabGroups.all
      .flatMap(g => g.tabs)
      .find(t =>
        t.input instanceof vscode.TabInputWebview && (
          t.input.viewType.toLowerCase().includes('claude') ||
          t.label.toLowerCase().includes('claude')
        )
      );

    if (existingTab) {
      // Panel is already open — URI prompt param won't be applied (extension ignores it).
      // Write @-ref to clipboard, then one PS script: SetForegroundWindow + Ctrl+Esc
      // (Focus Input) + Ctrl+V + Enter. All in one process so no inter-process focus loss.
      if (root) {
        fs.writeFileSync(path.join(root, 'TEMP_PROMPT.md'), prompt, 'utf8');
        ensureProjectGitignore(root, 'TEMP_PROMPT.md');
      }
      await vscode.env.clipboard.writeText('@TEMP_PROMPT.md');
      await vscode.commands.executeCommand('claude-vscode.focus');
      await sleep(300);
      pasteAndSubmit(log);
      log('Sent to Claude via clipboard paste + Enter (existing panel, @ref)');
    } else {
      // No panel yet — open via vscode:// URI (handles OS-level focus + session resume).
      const promptParam = encodeURIComponent(prompt.slice(0, 2000)); // URL length safety
      const sessionParam = sessionId ? `&session=${encodeURIComponent(sessionId)}` : '';
      const uri = `vscode://anthropic.claude-code/open?prompt=${promptParam}${sessionParam}`;
      await new Promise<void>(resolve => {
        const openCmd = process.platform === 'win32'
          ? psEncoded(`Start-Process "${uri}"`)
          : process.platform === 'darwin'
            ? `open "${uri}"`
            : `xdg-open "${uri}"`;
        exec(openCmd, () => resolve());
      });
      await sleep(1500);
      sendEnter(log);
      log(`Sent to Claude via vscode:// URI + Enter (session=${sessionId ?? 'new'})`);
    }
  } else {
    await Promise.resolve(vscode.commands.executeCommand('workbench.action.chat.open', {
      query: prompt,
      isPartialQuery: false,
    }));
    log('Sent to Copilot chat');
  }

  // Periodically accept AI edits for 10 minutes
  const interval = setInterval(() => {
    ACCEPT_CMDS.forEach(cmd => vscode.commands.executeCommand(cmd).then(() => {}, () => {}));
  }, 800);
  setTimeout(() => clearInterval(interval), 10 * 60 * 1000);
}
