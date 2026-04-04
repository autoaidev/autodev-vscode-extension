import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ProviderId, PROVIDERS } from './providers';
import { getSessionId, captureAndSaveSessionId, PROMPT_FILE, stdoutFilePath, autodevDir } from './sessionState';
import { loadSettings } from './settings';
import { buildClaudeCliCommand, findLatestClaudeSession, probeClaudeSession } from './providers/claudeCliProvider';
import { buildCopilotCliCommand, probeCopilotSession } from './providers/copilotCliProvider';
import { buildOpenCodeCliCommand, probeOpenCodeSession } from './providers/opencodeCliProvider';
import { sendClaudeUi } from './providers/claudeUiProvider';
import { sendCopilotUi } from './providers/copilotUiProvider';

// Re-export session helpers so taskLoop.ts imports don't need to change.
export {
  findLatestClaudeSession,
  getClaudeSessionCursor,
  parseClaudeStateSince,
  hasClaudeEndTurnSince,
  readClaudeOutputSince,
  ClaudeSessionState,
} from './providers/claudeCliProvider';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACCEPT_CMDS = [
  'chatEditor.action.acceptAllHunks',
  'workbench.action.chat.editing.acceptAllFiles',
  'workbench.action.chat.editing.acceptAll',
  'github.copilot.chat.acceptAllEdits',
  'chat.acceptAllEdits',
];

function teeCommand(cmd: string, outFile: string): string {
  if (os.platform() === 'win32') {
    return `$OutputEncoding=[System.Text.Encoding]::UTF8; ${cmd} 2>&1 | Tee-Object -FilePath ${JSON.stringify(outFile)}`;
  }
  // bash/zsh: tee writes stdout+stderr to file while still printing to terminal
  return `{ ${cmd}; } 2>&1 | tee ${JSON.stringify(outFile)}`;
}


function ensureProjectGitignore(root: string, entry: string): void {
  const gitignorePath = path.join(root, '.gitignore');
  try {
    let content = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf8') : '';
    if (content.split('\n').map(l => l.trim()).includes(entry)) { return; }
    if (content.length > 0 && !content.endsWith('\n')) { content += '\n'; }
    fs.writeFileSync(gitignorePath, content + `${entry}\n`, 'utf8');
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

export async function sendPromptToAi(
  providerId: ProviderId,
  prompt: string,
  log: (msg: string) => void,
  _focusOnly = false,
): Promise<void> {
  const providerCfg = PROVIDERS[providerId];

  // ── CLI providers — run in a VS Code terminal ──────────────────────────
  if (providerCfg.isCli) {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) { throw new Error('No workspace folder open'); }

    const promptFile = path.join(root, PROMPT_FILE);
    autodevDir(root); // ensure .autodev/ exists
    fs.writeFileSync(promptFile, prompt, 'utf8');
    ensureProjectGitignore(root, '.autodev/');

    const settings = loadSettings();
    const storedSessionId = settings.resumeSession ? getSessionId(root, providerId) : undefined;

    // For each CLI provider, probe for a session ID when none is stored yet,
    // then build the main command with --resume / --session / --continue.
    let resolvedSessionId = storedSessionId;
    if (!resolvedSessionId && settings.resumeSession) {
      if (providerId === 'claude-cli') {
        resolvedSessionId = await probeClaudeSession(root, log);
      } else if (providerId === 'copilot-cli') {
        resolvedSessionId = await probeCopilotSession(root, log);
      } else if (providerId === 'opencode-cli') {
        resolvedSessionId = await probeOpenCodeSession(root, log);
      }
      if (resolvedSessionId) {
        captureAndSaveSessionId(root, providerId, resolvedSessionId);
      }
    }

    let cmd: string;
    if (providerId === 'claude-cli') {
      cmd = buildClaudeCliCommand(promptFile, resolvedSessionId);
      // Capture stdout+stderr per-provider so rate-limit detection never reads stale data.
      const stdoutFile = stdoutFilePath(root, providerId);
      try { fs.writeFileSync(stdoutFile, '', 'utf8'); } catch { /* ignore */ }
      // Force UTF-8 output so Node can read the file without encoding issues.
      cmd = teeCommand(cmd, stdoutFile);
    } else if (providerId === 'copilot-cli') {
      cmd = buildCopilotCliCommand(promptFile, resolvedSessionId);
    } else {
      // opencode: --format json output contains sessionID in every event line.
      // Tee to capture file so we can parse the session ID after the run.
      cmd = buildOpenCodeCliCommand(promptFile, resolvedSessionId);
      const stdoutFile = stdoutFilePath(root, providerId);
      try { fs.writeFileSync(stdoutFile, '', 'utf8'); } catch { /* ignore */ }
      cmd = teeCommand(cmd, stdoutFile);
    }

    const termName = `AutoDev: ${providerCfg.label}`;
    const terminal = vscode.window.terminals.find(t => t.name === termName)
      ?? vscode.window.createTerminal({ name: termName, cwd: root });
    terminal.show(true);
    terminal.sendText(cmd);
    log(`Sent to ${termName}: ${cmd}`);

    // For claude-cli, try to capture session ID from the JSONL files only
    // when the probe didn't already save one (probe result takes precedence).
    if (providerId === 'claude-cli' && !resolvedSessionId) {
      const jsonlSession = findLatestClaudeSession(root);
      if (jsonlSession) { captureAndSaveSessionId(root, providerId, jsonlSession); }
    }
    return;
  }

  // ── UI providers — drive the VS Code extension ─────────────────────────
  if (!vscode.extensions.getExtension(providerCfg.extensionId)) {
    throw new Error(`"${providerCfg.label}" extension is not installed`);
  }

  if (providerId === 'claude') {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    const settings = loadSettings();
    const uiSessionId = settings.resumeSession ? getSessionId(root, providerId) : undefined;
    await sendClaudeUi(prompt, root, uiSessionId, log);
  } else {
    await sendCopilotUi(prompt, log);
  }

  // Periodically accept AI edits for 10 minutes
  const interval = setInterval(() => {
    ACCEPT_CMDS.forEach(c => vscode.commands.executeCommand(c).then(() => {}, () => {}));
  }, 800);
  setTimeout(() => clearInterval(interval), 10 * 60 * 1000);
}
