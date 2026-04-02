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
let _bypassJustChanged = false;
export function setBypassChanged(changed: boolean): void { _bypassJustChanged = changed; }

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

    if (existingPanel && !_bypassJustChanged) {
      // Setting was already correct — reuse the open panel
      await vscode.env.clipboard.writeText(prompt);
      await Promise.resolve(vscode.commands.executeCommand('claude-vscode.focus'));
      await sleep(400);
      sendPasteAndEnter(log);
      log('Sent to existing Claude panel (bypass already active)');
    } else {
      // Setting just changed OR no panel open — start a fresh conversation
      _bypassJustChanged = false; // only force-new once
      await Promise.resolve(vscode.commands.executeCommand('claude-vscode.newConversation'));
      await sleep(800);
      await vscode.env.clipboard.writeText(prompt);
      await Promise.resolve(vscode.commands.executeCommand('claude-vscode.focus'));
      await sleep(400);
      sendPasteAndEnter(log);
      log('Sent to Claude via new conversation (bypass permissions now active)');
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
