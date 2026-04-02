import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { ProviderId, PROVIDERS } from './providers';

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

interface ClaudeJsonlEntry {
  type?: string;
  message?: { role?: string; content?: Array<{ type?: string; text?: string }> | string };
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
        const entry = JSON.parse(trimmed) as ClaudeJsonlEntry;
        if (entry.type === 'assistant' || entry.message?.role === 'assistant') {
          const content = entry.message?.content;
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
// OS-level keystroke: Ctrl+V then Enter
// ---------------------------------------------------------------------------

export function sendPasteAndEnter(log: (msg: string) => void): void {
  const platform = process.platform;
  let cmd: string;
  if (platform === 'win32') {
    cmd = String.raw`powershell -NoProfile -WindowStyle Hidden -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v{ENTER}')"`;
  } else if (platform === 'darwin') {
    cmd = `osascript -e 'tell application "System Events" to keystroke "v" using command down' -e 'tell application "System Events" to key code 36'`;
  } else {
    cmd = 'xdotool key ctrl+v Return';
  }
  exec(cmd, err => { if (err) { log(`sendPasteAndEnter error: ${err.message}`); } });
  log(`Paste+Enter sent (${platform})`);
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

// Whether the bypass-permissions setting was changed this session (needs a fresh conversation)
// Removed — bypass is always active, no need to force new conversations.

export async function sendPromptToAi(
  providerId: ProviderId,
  prompt: string,
  log: (msg: string) => void
): Promise<void> {
  const providerCfg = PROVIDERS[providerId];

  if (!vscode.extensions.getExtension(providerCfg.extensionId)) {
    throw new Error(`"${providerCfg.label}" extension is not installed`);
  }

  if (providerId === 'claude') {
    const existingPanel = vscode.window.tabGroups.all
      .flatMap(g => g.tabs)
      .find(t => t.input instanceof vscode.TabInputWebview &&
        t.input.viewType.includes('claudeVSCodePanel'));

    if (existingPanel) {
      // Reuse the open panel
      await vscode.env.clipboard.writeText(prompt);
      await Promise.resolve(vscode.commands.executeCommand('claude-vscode.focus'));
      await sleep(400);
      sendPasteAndEnter(log);
      log('Sent to existing Claude panel');
    } else {
      // No panel open — start a fresh conversation
      await Promise.resolve(vscode.commands.executeCommand('claude-vscode.newConversation'));
      await sleep(800);
      await vscode.env.clipboard.writeText(prompt);
      await Promise.resolve(vscode.commands.executeCommand('claude-vscode.focus'));
      await sleep(400);
      sendPasteAndEnter(log);
      log('Sent to Claude via new conversation');
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
