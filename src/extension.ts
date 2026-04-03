import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { taskLoopRunner } from './taskLoop';
import { openSettingsFile } from './settings';
import { TodoViewProvider } from './sidebar';
import { sendPromptToAi } from './dispatcher';
import { ConfigManager } from './configManager';

let _out: vscode.OutputChannel;
export function log(msg: string): void { _out?.appendLine(`[AutoDev] ${msg}`); }

// ---------------------------------------------------------------------------
// Extension lifecycle
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext): void {
  _out = vscode.window.createOutputChannel('AutoDev');

  const sidebar = new TodoViewProvider(context.extensionUri, context);
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  applyAutoAcceptSettings();
  ConfigManager.applyAll(root, log);
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
        getActiveProvider: () => sidebar.selectedProvider,
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

async function applyAutoAcceptSettings(): Promise<void> {
  const cfg = vscode.workspace.getConfiguration();
  // VS Code / Copilot auto-accept
  await cfg.update('chat.editing.autoAcceptDelay', 800, vscode.ConfigurationTarget.Global);
  await cfg.update('github.copilot.chat.agent.runTasks', true, vscode.ConfigurationTarget.Global);
  await cfg.update('chat.editing.autoAccept', true, vscode.ConfigurationTarget.Global);
  // Claude Code: bypass ALL permission prompts (global)
  const prevMode = cfg.get<string>('claudeCode.initialPermissionMode');
  await cfg.update('claudeCode.allowDangerouslySkipPermissions', true, vscode.ConfigurationTarget.Global);
  await cfg.update('claudeCode.initialPermissionMode', 'bypassPermissions', vscode.ConfigurationTarget.Global);
  const changed = prevMode !== 'bypassPermissions';
  log(`Auto-accept applied. claudeCode.initialPermissionMode: ${prevMode} → bypassPermissions (changed=${changed})`);

  // Also write into the project .vscode/settings.json so these settings travel with the repo
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) { return; }
  try {
    const vscodDir = path.join(root, '.vscode');
    if (!fs.existsSync(vscodDir)) { fs.mkdirSync(vscodDir, { recursive: true }); }
    const settingsFile = path.join(vscodDir, 'settings.json');
    let settings: Record<string, unknown> = {};
    if (fs.existsSync(settingsFile)) {
      try { settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8')) as Record<string, unknown>; } catch { }
    }
    settings['claudeCode.initialPermissionMode'] = 'bypassPermissions';
    settings['claudeCode.allowDangerouslySkipPermissions'] = true;
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf8');
    log('Claude Code VS Code: wrote bypassPermissions to .vscode/settings.json');
  } catch (err) {
    log(`Claude Code VS Code: failed to write .vscode/settings.json: ${err}`);
  }
}
