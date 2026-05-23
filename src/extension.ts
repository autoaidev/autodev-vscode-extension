import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { taskLoopRunner } from './taskLoop';
import { openSettingsFile, loadSettings } from './settings';
import { pruneTodoToArchive } from './todo';
import { TodoViewProvider } from './sidebar';
import { sendPromptToAi } from './dispatcher';
import { closeClaudeTuiClient, closeAllClaudeTuiClients } from './providers/claudeTuiProvider';
import { closeCopilotSdkSession, closeAllCopilotSdkSessions } from './providers/copilotSdkProvider';
import { closeOpencodeSdkClient, closeAllOpencodeSdkClients } from './providers/opencodeSdkProvider';
import { VsFileWatcher, VsProcessLauncher } from './vscode/vsAdapters';
import { ConfigManager } from './configManager';
import { PROVIDERS } from './providers';
import { areClaudeHooksInstalled, areCopilotHooksInstalled, installHooks } from './hooksManager';
import { isOpenCodeHooksInstalled, installOpenCodeHooks } from './openCodeHooksManager';
import { saveSettings } from './settings';

let _out: vscode.OutputChannel;
// eslint-disable-next-line no-control-regex
const _stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b[^[]/g, '');
export function log(msg: string): void { _out?.appendLine(`[AutoDev] ${_stripAnsi(msg)}`); }

// ---------------------------------------------------------------------------
// Extension lifecycle
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext): void {
  _out = vscode.window.createOutputChannel('AutoDev');

  const sidebar = new TodoViewProvider(context.extensionUri, context);
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  applyAutoAcceptSettings();
  ConfigManager.applyAll(root, log);
  const extVersion = context.extension.packageJSON?.version ?? 'unknown';
  log(`Extension activated v${extVersion}`);

  // Migrate legacy hooks (homedir-scoped JSONL sink) to the per-workspace
  // form on every activation. `installHooks` is idempotent — it strips any
  // existing autodev entries and writes fresh commands carrying this
  // workspace's absolute path. Required because two VS Code instances on
  // the same host would otherwise both write to ~/.autodev/hooks-events.jsonl
  // and each forward every line under its own slug, mis-attributing hooks.
  if (root) {
    try {
      const s = loadSettings();
      // Check Claude and Copilot independently — areHooksInstalled is an OR
      // (either side is enough for the UI badge), but we want to migrate if
      // *either* side is stale or has duplicate legacy entries lingering.
      if (s.hooksEnabled && (!areClaudeHooksInstalled(root) || !areCopilotHooksInstalled(root))) {
        log('Migrating hook commands to per-workspace JSONL sink…');
        installHooks('project', root);
      }
      // Auto-install OpenCode hooks when hooksEnabled is true and the active
      // provider is opencode-cli or opencode-sdk. The plugin is idempotent —
      // re-installing only overwrites if the workspace path changed.
      const isOpenCodeProvider = s.provider === 'opencode-cli' || s.provider === 'opencode-sdk';
      if (s.hooksEnabled && isOpenCodeProvider && !isOpenCodeHooksInstalled(root)) {
        log('Auto-installing OpenCode hooks plugin…');
        installOpenCodeHooks(root);
        // Persist the enabled flag so the UI badge appears correctly.
        saveSettings({ ...s, openCodeHooksEnabled: true });
        log('OpenCode hooks plugin installed');
      }
    } catch (err) {
      log(`Hook migration check failed: ${(err as Error).message}`);
    }
  }

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
      const loopRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
      const launcher = new VsProcessLauncher();
      void taskLoopRunner.start({
        workspaceRoot: loopRoot,
        fileWatcher: new VsFileWatcher(),
        sendToAi: (prompt, taskLabel, includeProfile, messageFile) => {
          log(`Dispatching task: ${taskLabel}`);
          return sendPromptToAi(
            sidebar.selectedProvider, prompt, log, launcher, loopRoot, includeProfile, messageFile,
            // showOutput: reveal the AutoDev output channel so Claude TUI output is visible
            () => _out.show(true),
          );
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
        setActiveProvider: (id) => sidebar.setActiveProviderTransient(id),
      });
    }),

    vscode.commands.registerCommand('autodev.stopTaskLoop', () => {
      if (taskLoopRunner.state !== 'running' && taskLoopRunner.state !== 'paused') {
        vscode.window.showInformationMessage('AutoDev: Task loop is not running.');
        return;
      }
      // Send Ctrl+C to the provider terminal to interrupt the running CLI process
      const termName = `AutoDev: ${PROVIDERS[sidebar.selectedProvider]?.label ?? sidebar.selectedProvider}`;
      const term = vscode.window.terminals.find(t => t.name === termName);
      if (term) { term.sendText('\x03', false); }
      const loopRoot2 = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
      if (sidebar.selectedProvider === 'claude-tui') { closeClaudeTuiClient(loopRoot2, log); }
      if (sidebar.selectedProvider === 'copilot-sdk') { closeCopilotSdkSession(loopRoot2, log); }
      if (sidebar.selectedProvider === 'opencode-sdk') { closeOpencodeSdkClient(loopRoot2, log); }
      taskLoopRunner.stop();
      vscode.window.showInformationMessage('AutoDev: Task loop stopping');
    }),

    vscode.commands.registerCommand('autodev.retryLoop', () => {
      if (taskLoopRunner.state !== 'paused') { return; }
      taskLoopRunner.retry();
      vscode.window.showInformationMessage('AutoDev: Resuming after rate limit');
    }),

    vscode.commands.registerCommand('autodev.restartTaskLoop', () => {
      vscode.window.showInformationMessage('AutoDev: Restarting task loop…');
      void taskLoopRunner.restart();
    }),

    vscode.commands.registerCommand('autodev.clearSession', () => {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!root) { vscode.window.showWarningMessage('AutoDev: No workspace folder open.'); return; }
      const provider = sidebar.selectedProvider as import('./providers').ProviderId;
      vscode.window.showInformationMessage('AutoDev: Running /clear on session…');
      void taskLoopRunner.clearSession(root, provider);
    }),

    vscode.commands.registerCommand('autodev.openSettings', () => openSettingsFile()),

    vscode.commands.registerCommand('autodev.archiveTodo', () => {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!root) { vscode.window.showWarningMessage('AutoDev: No workspace folder open.'); return; }
      const settings = loadSettings();
      const todoPath = settings.todoPath || path.join(root, 'TODO.md');
      try {
        const pruned = pruneTodoToArchive(todoPath, root);
        if (pruned > 0) {
          vscode.window.showInformationMessage(`AutoDev: Archived ${pruned} completed task(s) \u2192 TODO_ARCHIVE.md`);
        } else {
          vscode.window.showInformationMessage('AutoDev: No completed tasks to archive.');
        }
      } catch (e) {
        vscode.window.showErrorMessage(`AutoDev: Archive failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }),
  );

  // Auto-start the task loop when a workspace was bound via the autodev CLI
  // (`--setup-url` / `--connect`) and `autoStartLoop: true` is set in
  // .autodev/settings.json. Without this, the user has to click ▶ Start every
  // time they reopen the IDE — which is surprising for the CLI-driven flow.
  if (root) {
    try {
      const s = loadSettings();
      if (s.autoStartLoop && s.wsUrl) {
        log(`autoStartLoop=true and wsUrl set → starting task loop in 1s`);
        setTimeout(() => {
          if (taskLoopRunner.state === 'idle') {
            void vscode.commands.executeCommand('autodev.startTaskLoop');
          }
        }, 1000);
      }
    } catch (err) {
      log(`autoStart check failed: ${(err as Error).message}`);
    }
  }
}

export function deactivate(): void {
  // Close any persistent SDK servers / TUI processes so they don't linger
  // as orphaned processes after VS Code restarts or the extension reloads.
  closeAllOpencodeSdkClients();
  closeAllClaudeTuiClients();
  closeAllCopilotSdkSessions();
}

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
