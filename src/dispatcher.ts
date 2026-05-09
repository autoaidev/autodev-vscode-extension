import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ProviderId, PROVIDERS } from './providers';
import { IProcessLauncher } from './core/adapters';
import { getSessionId, captureAndSaveSessionId, AGENT_PROFILE_FILE, newMessageOutput, autodevDir } from './sessionState';
import { loadSettingsForRoot } from './core/settingsLoader';
import { buildClaudeCliCommand, findLatestClaudeSession, probeClaudeSession } from './providers/claudeCliProvider';
import { buildCopilotCliCommand, probeCopilotSession } from './providers/copilotCliProvider';
import { buildOpenCodeCliCommand, getLatestOpenCodeSessionId } from './providers/opencodeCliProvider';
import { sendClaudeTuiPrompt } from './providers/claudeTuiProvider';
import { sendOpencodeSdkPrompt } from './providers/opencodeSdkProvider';
import { getManualHookCmd } from './hooksManager';
import { getOpenCodeSessionIdFromHooks } from './openCodeHooksManager';

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

/**
 * Wrap a shell command with synthetic SessionStart / SessionEnd hook events
 * written to <workspaceRoot>/.autodev/hooks-events.jsonl. Used for providers
 * that don't have native hooks (copilot-cli, opencode-cli). Post hook always
 * runs even if the main command fails.
 */
function wrapWithSyntheticHooks(cmd: string, provider: string, workspaceRoot: string, sessionName: string): string {
  const pre  = getManualHookCmd(provider, 'SessionStart', workspaceRoot, sessionName);
  const post = getManualHookCmd(provider, 'SessionEnd',   workspaceRoot, sessionName);
  if (os.platform() === 'win32') {
    return `${pre}; ${cmd}; ${post}`;
  }
  return `${pre}; { ${cmd}; }; ${post}`;
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
  /** Called once when a claude-tui task starts — use to reveal the output channel. */
  showOutput?: () => void,
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
        // Prefer hooks events (fast, no subprocess); fall back to session list
        resolvedSessionId = getOpenCodeSessionIdFromHooks(root)
          ?? await getLatestOpenCodeSessionId(root, log);
      }
      if (resolvedSessionId) {
        captureAndSaveSessionId(root, providerId, resolvedSessionId);
      }
    }

    // Allocate a fresh per-message stdout + exit file pair so back-to-back
    // tasks don't overwrite each other's output. The pointer file also moves
    // so subsequent reads from taskLoop transparently target this message.
    const { messageId, stdoutFile, exitFile } = newMessageOutput(root, providerId);
    try { fs.writeFileSync(stdoutFile, '', 'utf8'); } catch { /* ignore */ }
    try { fs.writeFileSync(exitFile,   '', 'utf8'); } catch { /* ignore */ }
    log(`Message id: ${messageId} (output: ${path.basename(stdoutFile)})`);

    // --- claude-tui: in-process spawn, no terminal ---
    if (providerId === 'claude-tui') {
      const promptFilePath = writeCombinedFile(root, agentProfileFile, messageFile, includeProfile);
      sendClaudeTuiPrompt(root, promptFilePath, resolvedSessionId, stdoutFile, exitFile, log, showOutput);
      log(`Claude TUI: prompt dispatched (session=${resolvedSessionId ?? 'new'})`);
      return;
    }

    // --- opencode-sdk: in-process SDK, no terminal ---
    if (providerId === 'opencode-sdk') {
      const promptFilePath = writeCombinedFile(root, agentProfileFile, messageFile, includeProfile);
      sendOpencodeSdkPrompt(root, promptFilePath, resolvedSessionId, stdoutFile, exitFile, log, settings.opencodeModel || undefined, showOutput);
      log(`OpenCode SDK: prompt dispatched (session=${resolvedSessionId ?? 'new'})`);
      return;
    }

    let cmd: string;
    if (providerId === 'claude-cli') {
      cmd = buildClaudeCliCommand(agentProfileFile, messageFile, resolvedSessionId, includeProfile);
      cmd = teeCommand(cmd, stdoutFile);
    } else if (providerId === 'copilot-cli') {
      const combinedFile = writeCombinedFile(root, agentProfileFile, messageFile, includeProfile);
      cmd = buildCopilotCliCommand(combinedFile, resolvedSessionId, settings.copilotModel || undefined);
      cmd = teeCommand(cmd, stdoutFile);
      if (settings.hooksEnabled) {
        cmd = wrapWithSyntheticHooks(cmd, 'copilot-cli', root, path.basename(root));
      }
    } else {
      const combinedFile = writeCombinedFile(root, agentProfileFile, messageFile, includeProfile);
      cmd = buildOpenCodeCliCommand(combinedFile, resolvedSessionId, settings.opencodeModel || undefined);
      cmd = teeCommand(cmd, stdoutFile);
      if (settings.hooksEnabled) {
        cmd = wrapWithSyntheticHooks(cmd, 'opencode-cli', root, path.basename(root));
      }
    }

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
