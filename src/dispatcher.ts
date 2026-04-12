import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ProviderId, PROVIDERS } from './providers';
import { IProcessLauncher } from './core/adapters';
import { getSessionId, captureAndSaveSessionId, AGENT_PROFILE_FILE, stdoutFilePath, exitFilePath, autodevDir } from './sessionState';
import { loadSettingsForRoot } from './core/settingsLoader';
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
    // $OutputEncoding controls pipe encoding; Console.OutputEncoding controls the subprocess.
    // Use UTF8Encoding($false) = UTF-8 without BOM on both.
    // Tee-Object writes the file in the system default encoding (UTF-16 LE on PS5,
    // UTF-8 on PS7) — the Node.js reader detects the BOM and decodes accordingly.
    const utf8NoBom = 'New-Object System.Text.UTF8Encoding($false)';
    return `$OutputEncoding=${utf8NoBom}; [Console]::OutputEncoding=${utf8NoBom}; ${cmd} 2>&1 | Tee-Object -FilePath ${JSON.stringify(outFile)}`;
  }
  return `{ ${cmd}; } 2>&1 | tee ${JSON.stringify(outFile)}`;
}

function withExitFile(cmd: string, exitFile: string): string {
  const q = JSON.stringify(exitFile);
  if (os.platform() === 'win32') {
    return `${cmd}; [System.IO.File]::WriteAllText(${q}, $LASTEXITCODE.ToString())`;
  }
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

/** Combine profile + message into a temp file under .autodev/messages/ and return its path. */
function writeCombinedFile(root: string, agentProfileFile: string, messageFile: string, includeProfile: boolean): string {
  const msgsDir = path.join(root, '.autodev', 'messages');
  if (!fs.existsSync(msgsDir)) { fs.mkdirSync(msgsDir, { recursive: true }); }
  const msgContent = fs.readFileSync(messageFile, 'utf8');
  let combined = msgContent;
  if (includeProfile) {
    const profileContent = fs.readFileSync(agentProfileFile, 'utf8');
    combined = `${profileContent}\n\n${msgContent}`;
  }
  const combinedFile = path.join(msgsDir, `temp_${Date.now()}.md`);
  fs.writeFileSync(combinedFile, combined, 'utf8');
  return combinedFile;
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

/**
 * Build the CLI command and dispatch it via the injected `launcher`.
 * `workspaceRoot` and `launcher` are provided by the caller (VS Code extension
 * passes VsProcessLauncher + workspace root; the SDK passes NodeProcessLauncher
 * + cwd).
 */
export async function sendPromptToAi(
  providerId: ProviderId,
  _prompt: string,
  log: (msg: string) => void,
  launcher: IProcessLauncher,
  workspaceRoot: string,
  includeProfile = true,
  messageFilePath?: string,
): Promise<void> {
  const providerCfg = PROVIDERS[providerId];

  if (providerCfg.isCli) {
    const root = workspaceRoot;
    if (!root) { throw new Error('No workspace root provided'); }

    const agentProfileFile = path.join(root, AGENT_PROFILE_FILE);
    const messageFile = messageFilePath ?? path.join(root, AGENT_PROFILE_FILE.replace('AGENT_PROFILE.md', 'MESSAGE.md'));
    autodevDir(root);
    ensureProjectGitignore(root, '.autodev/');

    const settings = loadSettingsForRoot(root);
    const storedSessionId = settings.resumeSession ? getSessionId(root, providerId) : undefined;

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
      cmd = buildClaudeCliCommand(agentProfileFile, messageFile, resolvedSessionId, includeProfile);
      const stdoutFile = stdoutFilePath(root, providerId);
      try { fs.writeFileSync(stdoutFile, '', 'utf8'); } catch { /* ignore */ }
      cmd = teeCommand(cmd, stdoutFile);
    } else if (providerId === 'copilot-cli') {
      const combinedFile = writeCombinedFile(root, agentProfileFile, messageFile, includeProfile);
      cmd = buildCopilotCliCommand(combinedFile, resolvedSessionId);
    } else {
      const combinedFile = writeCombinedFile(root, agentProfileFile, messageFile, includeProfile);
      cmd = buildOpenCodeCliCommand(combinedFile, resolvedSessionId);
      const stdoutFile = stdoutFilePath(root, providerId);
      try { fs.writeFileSync(stdoutFile, '', 'utf8'); } catch { /* ignore */ }
      cmd = teeCommand(cmd, stdoutFile);
    }

    const exitFile = exitFilePath(root, providerId);
    try { fs.writeFileSync(exitFile, '', 'utf8'); } catch { /* ignore */ }
    cmd = withExitFile(cmd, exitFile);

    const termName = `AutoDev: ${providerCfg.label}`;
    launcher.launch(cmd, termName, root);
    log(`Sent to ${termName}: ${cmd}`);

    if (providerId === 'claude-cli' && !resolvedSessionId) {
      const jsonlSession = findLatestClaudeSession(root);
      if (jsonlSession) { captureAndSaveSessionId(root, providerId, jsonlSession); }
    }
    return;
  }
}
