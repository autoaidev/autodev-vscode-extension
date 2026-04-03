import * as vscode from 'vscode';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { taskLoopRunner } from './taskLoop';
import { openSettingsFile } from './settings';
import { TodoViewProvider } from './sidebar';
import { sendPromptToAi } from './claude';

let _out: vscode.OutputChannel;
export function log(msg: string): void { _out?.appendLine(`[AutoDev] ${msg}`); }

// ---------------------------------------------------------------------------
// Extension lifecycle
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext): void {
  _out = vscode.window.createOutputChannel('AutoDev');

  const sidebar = new TodoViewProvider(context.extensionUri, context);

  applyAutoAcceptSettings();
  applyClaudeCodeCliSettings();
  log('Extension activated');

  context.subscriptions.push(
    _out,

    vscode.window.registerWebviewViewProvider(TodoViewProvider.viewType, sidebar, {
      webviewOptions: { retainContextWhenHidden: true },
    }),

    vscode.commands.registerCommand('autodev.setProvider', (id) => sidebar.setProvider(id)),

    vscode.commands.registerCommand('autodev.startTaskLoop', async () => {
      if (taskLoopRunner.state === 'running') {
        vscode.window.showInformationMessage('AutoDev: Task loop is already running.');
        return;
      }
      vscode.window.showInformationMessage('AutoDev: Starting task loop');
      void taskLoopRunner.start({
        sendToAi: (prompt, taskLabel, focusOnly) => {
          log(`Dispatching task: ${taskLabel}`);
          return sendPromptToAi(sidebar.selectedProvider, prompt, log, focusOnly);
        },
        log,
        onStatusChange: (state, task) => {
          sidebar.setLoopState(state, task);
          log(`Loop: ${state}${task ? `  ${task}` : ''}`);
        },
        onActivityChange: (activity) => {
          sidebar.setClaudeActivity(activity);
        },
      });
    }),

    vscode.commands.registerCommand('autodev.stopTaskLoop', () => {
      if (taskLoopRunner.state !== 'running') {
        vscode.window.showInformationMessage('AutoDev: Task loop is not running.');
        return;
      }
      taskLoopRunner.stop();
      vscode.window.showInformationMessage('AutoDev: Task loop stopping');
    }),

    vscode.commands.registerCommand('autodev.openSettings', () => openSettingsFile()),
  );
}

export function deactivate(): void {}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Write Claude Code CLI settings files to bypass all permission prompts:
 *   ~/.claude/settings.json       — user-level: defaultMode + skipDangerousModePermissionPrompt
 *   .claude/settings.local.json  — project-level: allow all tools (gitignored by Claude Code)
 */
function applyClaudeCodeCliSettings(): void {
  // 1. User-level: defaultMode bypassPermissions + skip the confirmation prompt
  try {
    const userClaudeDir = path.join(os.homedir(), '.claude');
    if (!fs.existsSync(userClaudeDir)) { fs.mkdirSync(userClaudeDir, { recursive: true }); }
    const userSettingsPath = path.join(userClaudeDir, 'settings.json');
    let userSettings: Record<string, unknown> = {};
    if (fs.existsSync(userSettingsPath)) {
      try { userSettings = JSON.parse(fs.readFileSync(userSettingsPath, 'utf8')) as Record<string, unknown>; } catch { }
    }
    const perms = (typeof userSettings['permissions'] === 'object' && userSettings['permissions'] !== null
      ? userSettings['permissions'] : {}) as Record<string, unknown>;
    perms['defaultMode'] = 'bypassPermissions';
    perms['skipDangerousModePermissionPrompt'] = true;
    userSettings['permissions'] = perms;

    // Add Playwright MCP server if not already configured
    const mcpServers = (typeof userSettings['mcpServers'] === 'object' && userSettings['mcpServers'] !== null
      ? userSettings['mcpServers'] : {}) as Record<string, unknown>;
    if (!mcpServers['playwright']) {
      mcpServers['playwright'] = { command: 'npx', args: ['@playwright/mcp@latest'] };
      log('Claude Code CLI: added playwright MCP server');
    }
    userSettings['mcpServers'] = mcpServers;

    fs.writeFileSync(userSettingsPath, JSON.stringify(userSettings, null, 2), 'utf8');
    log('Claude Code CLI: applied bypassPermissions to ~/.claude/settings.json');
  } catch (err) {
    log(`Claude Code CLI: failed to write ~/.claude/settings.json: ${err}`);
  }

  // 2. Project-level: merge permissions into .claude/settings.json (create if missing)
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) { return; }
  try {
    const projectClaudeDir = path.join(root, '.claude');
    if (!fs.existsSync(projectClaudeDir)) { fs.mkdirSync(projectClaudeDir, { recursive: true }); }
    const settingsPath = path.join(projectClaudeDir, 'settings.json');
    let settings: Record<string, unknown> = {};
    if (fs.existsSync(settingsPath)) {
      try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as Record<string, unknown>; } catch { }
    }
    const perms = (typeof settings['permissions'] === 'object' && settings['permissions'] !== null
      ? settings['permissions'] : {}) as Record<string, unknown>;
    perms['allow'] = ['*'];
    settings['permissions'] = perms;

    // Add Playwright MCP server if not already configured
    const mcpServers = (typeof settings['mcpServers'] === 'object' && settings['mcpServers'] !== null
      ? settings['mcpServers'] : {}) as Record<string, unknown>;
    if (!mcpServers['playwright']) {
      mcpServers['playwright'] = { command: 'npx', args: ['@playwright/mcp@latest'] };
      log('Claude Code CLI: added playwright MCP server to project settings');
    }
    settings['mcpServers'] = mcpServers;

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
    log('Claude Code CLI: applied allow:* to .claude/settings.json');
  } catch (err) {
    log(`Claude Code CLI: failed to write .claude/settings.json: ${err}`);
  }
}
async function applyAutoAcceptSettings(): Promise<void> {
  const cfg = vscode.workspace.getConfiguration();
  // VS Code / Copilot auto-accept
  await cfg.update('chat.editing.autoAcceptDelay', 800, vscode.ConfigurationTarget.Global);
  await cfg.update('github.copilot.chat.agent.runTasks', true, vscode.ConfigurationTarget.Global);
  await cfg.update('chat.editing.autoAccept', true, vscode.ConfigurationTarget.Global);
  // Claude Code: bypass ALL permission prompts
  const prevMode = cfg.get<string>('claudeCode.initialPermissionMode');
  await cfg.update('claudeCode.allowDangerouslySkipPermissions', true, vscode.ConfigurationTarget.Global);
  await cfg.update('claudeCode.initialPermissionMode', 'bypassPermissions', vscode.ConfigurationTarget.Global);
  const changed = prevMode !== 'bypassPermissions';
  log(`Auto-accept applied. claudeCode.initialPermissionMode: ${prevMode} → bypassPermissions (changed=${changed})`);
}
