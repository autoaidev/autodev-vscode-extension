import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ProviderId, PROVIDERS } from './providers';
import { getSessionId, captureAndSaveSessionId, AGENT_PROFILE_FILE, MESSAGE_FILE, stdoutFilePath, exitFilePath, autodevDir } from './sessionState';
import { loadSettings } from './settings';
import { buildClaudeCliCommand, findLatestClaudeSession, probeClaudeSession } from './providers/claudeCliProvider';
import { buildCopilotCliCommand, probeCopilotSession } from './providers/copilotCliProvider';
import { buildOpenCodeCliCommand, getLatestOpenCodeSessionId } from './providers/opencodeCliProvider';

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

function teeCommand(cmd: string, outFile: string): string {
  if (os.platform() === 'win32') {
    return `$OutputEncoding=[System.Text.Encoding]::UTF8; ${cmd} 2>&1 | Tee-Object -FilePath ${JSON.stringify(outFile)}`;
  }
  // bash/zsh: tee writes stdout+stderr to file while still printing to terminal
  return `{ ${cmd}; } 2>&1 | tee ${JSON.stringify(outFile)}`;
}

/**
 * Append a shell snippet that writes the CLI exit code to `exitFile` after the
 * command finishes.  Works for both PowerShell (Windows) and bash/zsh (Unix).
 */
function withExitFile(cmd: string, exitFile: string): string {
  const q = JSON.stringify(exitFile);
  if (os.platform() === 'win32') {
    // PowerShell: run cmd, capture $LASTEXITCODE, write to file
    return `${cmd}; [System.IO.File]::WriteAllText(${q}, $LASTEXITCODE.ToString())`;
  }
  // bash/zsh
  return `{ ${cmd}; echo $? > ${q}; }`;
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

    // Split files (.autodev/AGENT_PROFILE.md + .autodev/MESSAGE.md) were written
    // by buildMessage() before this is called. Derive their absolute paths here.
    const agentProfileFile = path.join(root, AGENT_PROFILE_FILE);
    const messageFile = path.join(root, MESSAGE_FILE);
    autodevDir(root); // ensure .autodev/ exists
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
        resolvedSessionId = await getLatestOpenCodeSessionId(root, log);
      }
      if (resolvedSessionId) {
        captureAndSaveSessionId(root, providerId, resolvedSessionId);
      }
    }

    let cmd: string;
    if (providerId === 'claude-cli') {
      cmd = buildClaudeCliCommand(agentProfileFile, messageFile, resolvedSessionId);
      // Capture stdout+stderr per-provider so rate-limit detection never reads stale data.
      const stdoutFile = stdoutFilePath(root, providerId);
      try { fs.writeFileSync(stdoutFile, '', 'utf8'); } catch { /* ignore */ }
      // Force UTF-8 output so Node can read the file without encoding issues.
      cmd = teeCommand(cmd, stdoutFile);
    } else if (providerId === 'copilot-cli') {
      // Write combined prompt to a project-local temp file so we can pass a
      // single `@path` argument — avoids all PowerShell multi-line quoting issues.
      const msgsDir = path.join(root, '.autodev', 'messages');
      if (!fs.existsSync(msgsDir)) { fs.mkdirSync(msgsDir, { recursive: true }); }
      const profileContent = fs.readFileSync(agentProfileFile, 'utf8');
      const msgContent = fs.readFileSync(messageFile, 'utf8');
      const combinedFile = path.join(msgsDir, `temp_${Date.now()}.md`);
      fs.writeFileSync(combinedFile, `${profileContent}\n\n${msgContent}`, 'utf8');
      cmd = buildCopilotCliCommand(combinedFile, resolvedSessionId);
    } else {
      // opencode: session ID is captured via the probe (--format json ".").
      // Main run uses normal output mode — no JSON parsing needed.
      cmd = buildOpenCodeCliCommand(agentProfileFile, messageFile, resolvedSessionId);
    }

    // Clear the exit file before launching so a stale value from a previous run
    // is never mistaken for the current task completing.
    const exitFile = exitFilePath(root, providerId);
    try { fs.writeFileSync(exitFile, '', 'utf8'); } catch { /* ignore */ }

    // Wrap every CLI command so the shell writes the process exit code to the
    // exit file once it finishes.  taskLoop.ts watches this file to detect
    // when the provider has exited (for all providers, not just claude-cli).
    cmd = withExitFile(cmd, exitFile);

    const termName = `AutoDev: ${providerCfg.label}`;
    // Dispose any existing terminal with this name — CLI tools (copilot, opencode)
    // write TUI/ANSI sequences that corrupt the shell state. A fresh terminal
    // every task guarantees a clean prompt.
    vscode.window.terminals.find(t => t.name === termName)?.dispose();
    const terminal = vscode.window.createTerminal({ name: termName, cwd: root });
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
}
