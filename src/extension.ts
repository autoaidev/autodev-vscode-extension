import * as vscode from 'vscode';
import { taskLoopRunner } from './taskLoop';
import { openSettingsFile } from './settings';
import { TodoViewProvider } from './sidebar';
import { sendPromptToAi, setBypassChanged } from './claude';

let _out: vscode.OutputChannel;
export function log(msg: string): void { _out?.appendLine(`[AutoDev] ${msg}`); }

// ---------------------------------------------------------------------------
// Extension lifecycle
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext): void {
  _out = vscode.window.createOutputChannel('AutoDev');

  const sidebar = new TodoViewProvider(context.extensionUri, context);

  applyAutoAcceptSettings();
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
        sendToAi: (prompt, taskLabel) => {
          log(`Dispatching task: ${taskLabel}`);
          return sendPromptToAi(sidebar.selectedProvider, prompt, log);
        },
        log,
        onStatusChange: (state, task) => {
          sidebar.setLoopState(state, task);
          log(`Loop: ${state}${task ? `  ${task}` : ''}`);
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
  setBypassChanged(changed);
  log(`Auto-accept applied. claudeCode.initialPermissionMode: ${prevMode} → bypassPermissions (changed=${changed})`);
}
