import * as vscode from 'vscode';
import * as path from 'path';
import { execSync } from 'child_process';
import { areHooksInstalled, installHooks, uninstallHooks } from './hooksManager';
import { isOpenCodeHooksInstalled, installOpenCodeHooks, uninstallOpenCodeHooks } from './openCodeHooksManager';
import { ProviderId, ProviderConfig, PROVIDERS } from './providers';
import { LoopState } from './taskLoop';
import { taskLoopRunner } from './taskLoop';
import { loadSettings, saveSettings, AutodevSettings, getBuiltinProfiles } from './settings';
import { Task, parseTodo, appendTask } from './todo';
import { getSessionId, clearSessionId } from './sessionState';

// ---------------------------------------------------------------------------
// TodoViewProvider — sidebar webview that shows TODO.md tasks + loop controls
// ---------------------------------------------------------------------------

const PROVIDER_KEY = 'autodev.selectedProvider';

export class TodoViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'autodev.chatStatus';

  private _view?: vscode.WebviewView;
  private _tasks: Task[] = [];
  private _loopState: LoopState = 'idle';
  private _loopTask?: string;
  private _claudeActivity?: string;
  private _selectedProvider: ProviderId;
  private _watcher?: vscode.FileSystemWatcher;
  private _sessionWatcher?: vscode.FileSystemWatcher;
  private _settingsWatcher?: vscode.FileSystemWatcher;
  private _pollTimer?: ReturnType<typeof setInterval>;
  private _lastNotifyTime = 0;
  private _cozempicInstalled: boolean | null = null;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext
  ) {
    this._selectedProvider =
      this._context.globalState.get<ProviderId>(PROVIDER_KEY) ?? 'claude-cli';
  }

  get selectedProvider(): ProviderId { return this._selectedProvider; }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _ctx: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [this._extensionUri] };
    webviewView.webview.html = buildHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((msg) => {
      switch (msg.command) {
        case 'setProvider': this.setProvider(msg.provider as ProviderId); break;
        case 'addTask':     this._addTask(msg.text as string); break;
        case 'startLoop':   void vscode.commands.executeCommand('autodev.startTaskLoop'); break;
        case 'stopLoop':    void vscode.commands.executeCommand('autodev.stopTaskLoop'); break;
        case 'retryLoop':   void vscode.commands.executeCommand('autodev.retryLoop'); break;
        case 'openTask':    void this._openTaskLine(msg.line as number); break;
        case 'saveSettings': {
          const prev = loadSettings();
          const next = msg.settings as AutodevSettings;
          saveSettings(next);
          this._startWatcher();
          // Sync hooks when enabled/scope changes.
          // Re-load after save so wsUrl is parsed into serverApiKey/serverBaseUrl.
          const saved = loadSettings();
          const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (root) { this._syncHooks(prev, saved, root); }
          this._push();
          vscode.window.showInformationMessage('AutoDev: Settings saved.');
          break;
        }
        case 'openSettings': void vscode.commands.executeCommand('autodev.openSettings'); break;
        case 'openFile': {
          const filePath = msg.filePath as string;
          if (filePath) {
            const uri = vscode.Uri.file(filePath);
            void vscode.workspace.openTextDocument(uri).then(doc => vscode.window.showTextDocument(doc));
          }
          break;
        }
        case 'newSession': {
          const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (root) { clearSessionId(root, this._selectedProvider); this._push(); }
          break;
        }
      }
    });

    webviewView.onDidDispose(() => {
      this._watcher?.dispose(); this._watcher = undefined;
      this._sessionWatcher?.dispose(); this._sessionWatcher = undefined;
      this._settingsWatcher?.dispose(); this._settingsWatcher = undefined;
      if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = undefined; }
    });
    webviewView.onDidChangeVisibility(() => { if (webviewView.visible) { this._refreshTasks(); } });

    this._cozempicInstalled = null; // re-check each time the panel opens
    this._startWatcher();
    this._refreshTasks();
  }

  setLoopState(state: LoopState, task?: string): void {
    this._loopState = state;
    this._loopTask = task;
    this._push();
  }

  setClaudeActivity(activity: string | undefined): void {
    this._claudeActivity = activity;
    this._push();
  }

  setProvider(id: ProviderId): void {
    this._selectedProvider = id;
    this._context.globalState.update(PROVIDER_KEY, id);
    const current = loadSettings();
    saveSettings({ ...current, provider: id });
    this._push();
  }

  refresh(): void { this._refreshTasks(); }

  private _addTask(text: string): void {
    if (!text.trim()) { return; }
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) { vscode.window.showWarningMessage('AutoDev: No workspace folder open.'); return; }
    const settings = loadSettings();
    const todoPath = settings.todoPath || path.join(root, 'TODO.md');
    appendTask(todoPath, text.trim());
    this._refreshTasks();
  }

  private _startWatcher(): void {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) { return; }
    const settings = loadSettings();
    const todoPath = settings.todoPath || path.join(root, 'TODO.md');
    this._watcher?.dispose();
    this._watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(path.dirname(todoPath), path.basename(todoPath))
    );
    const notify = () => { this._lastNotifyTime = Date.now(); this._refreshTasks(); };
    this._watcher.onDidChange(notify);
    this._watcher.onDidCreate(notify);
    this._watcher.onDidDelete(() => { this._lastNotifyTime = Date.now(); this._tasks = []; this._push(); });

    // Watch .autodev/session-state.json so the session ID badge updates immediately
    // when the dispatcher saves a new ID (probe result, post-task capture, etc.).
    this._sessionWatcher?.dispose();
    this._sessionWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(root, '.autodev/session-state.json')
    );
    const sessionNotify = () => this._push();
    this._sessionWatcher.onDidChange(sessionNotify);
    this._sessionWatcher.onDidCreate(sessionNotify);

    // Watch autodev.json so settings tab refreshes when file is edited externally
    this._settingsWatcher?.dispose();
    this._settingsWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(root, '.vscode/autodev.json')
    );
    const settingsNotify = () => this._push();
    this._settingsWatcher.onDidChange(settingsNotify);
    this._settingsWatcher.onDidCreate(settingsNotify);

    // Fallback poll every 5 min — catches missed fs events on Linux
    if (this._pollTimer) { clearInterval(this._pollTimer); }
    this._pollTimer = setInterval(() => {
      const sinceLastNotify = Date.now() - this._lastNotifyTime;
      if (sinceLastNotify > 4.5 * 60 * 1000) { this._refreshTasks(); }
    }, 5 * 60 * 1000);
  }

  private async _openTaskLine(line: number): Promise<void> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) { return; }
    const settings = loadSettings();
    const todoPath = settings.todoPath || path.join(root, 'TODO.md');
    const uri = vscode.Uri.file(todoPath);
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    const pos = new vscode.Position(Math.max(0, line - 1), 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
  }

  private _refreshTasks(): void {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) { this._tasks = []; this._push(); return; }
    const settings = loadSettings();
    const todoPath = settings.todoPath || path.join(root, 'TODO.md');
    this._tasks = parseTodo(todoPath);
    this._push();
  }

  private _syncHooks(prev: AutodevSettings, next: AutodevSettings, root: string): void {
    const wasEnabled = prev.hooksEnabled;
    const isEnabled  = next.hooksEnabled;
    const scope      = next.hooksScope ?? 'global';
    const prevScope  = prev.hooksScope ?? 'global';

    if (!isEnabled) {
      // Uninstall from both scopes to clean up
      if (wasEnabled || areHooksInstalled('project', root)) { uninstallHooks('project', root); }
      if (wasEnabled || areHooksInstalled('global', root))  { uninstallHooks('global', root); }
    } else {
      // If scope changed, uninstall from the old scope first
      if (wasEnabled && prevScope !== scope) { uninstallHooks(prevScope, root); }
      installHooks(scope, root);
    }

    // OpenCode hooks — install/uninstall plugin file
    const wasOcEnabled = prev.openCodeHooksEnabled;
    const isOcEnabled  = next.openCodeHooksEnabled;
    if (!isOcEnabled) {
      if (wasOcEnabled || isOpenCodeHooksInstalled(root)) { uninstallOpenCodeHooks(root); }
    } else {
      installOpenCodeHooks(root);
    }
  }

  private _checkCozempic(): boolean {
    if (this._cozempicInstalled !== null) { return this._cozempicInstalled; }
    // VS Code's process doesn't inherit the user's full shell PATH (e.g. ~/.local/bin
    // where pip/pipx installs cozempic). Use a login shell so profile files are sourced.
    const shell = process.env.SHELL || 'bash';
    try {
      execSync(`${shell} -lc "cozempic --version"`, { stdio: 'pipe' });
      this._cozempicInstalled = true;
    } catch {
      this._cozempicInstalled = false;
    }
    return this._cozempicInstalled;
  }

  private _push(): void {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const sessionId = root ? (getSessionId(root, this._selectedProvider) ?? null) : null;
    this._view?.webview.postMessage({
      command: 'update',
      selectedProvider: this._selectedProvider,
      providers: (Object.entries(PROVIDERS) as [ProviderId, ProviderConfig][]).map(([id, cfg]) => ({
        id,
        label: cfg.label,
        isCli: !!cfg.isCli,
        installed: cfg.isCli ? true : !!vscode.extensions.getExtension(cfg.extensionId),
      })),
      tasks: this._tasks.map(t => ({ text: t.text, status: t.status, completedDate: t.completedDate, line: t.line })),
      loopState: this._loopState,
      loopTask: this._loopTask,
      claudeActivity: this._claudeActivity,
      settings: loadSettings(),
      sessionId,
      resumeAt: taskLoopRunner.resumeAt?.getTime() ?? null,
      profiles: getBuiltinProfiles(),
      cozempicInstalled: this._checkCozempic(),
      hooksInstalled: root ? (areHooksInstalled('project', root) || areHooksInstalled('global', root)) : false,
      openCodeHooksInstalled: root ? isOpenCodeHooksInstalled(root) : false,
    });
  }
}

// ---------------------------------------------------------------------------
// HTML for the sidebar webview (pure function — easy to edit independently)
// ---------------------------------------------------------------------------

function buildHtml(webview: vscode.Webview): string {
  const nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AutoDev</title>
<style nonce="${nonce}">
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);background:transparent;padding:0 8px 12px;overflow-x:hidden}
.provider-row{display:flex;align-items:center;gap:6px;margin:10px 0 10px}
.provider-label{font-size:11px;color:var(--vscode-descriptionForeground);white-space:nowrap;flex-shrink:0}
.provider-select{flex:1;padding:4px 6px;font-family:var(--vscode-font-family);font-size:12px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,var(--vscode-panel-border));border-radius:3px;outline:none;cursor:pointer}
.provider-select:focus{border-color:var(--vscode-focusBorder)}
.resume-row{display:flex;align-items:center;gap:5px;margin:-4px 0 4px;font-size:11px;color:var(--vscode-descriptionForeground)}
.resume-row input{cursor:pointer}
.new-session-btn{margin-left:auto;padding:1px 5px;border-radius:3px;cursor:pointer;border:1px solid var(--vscode-panel-border);background:transparent;color:var(--vscode-descriptionForeground);font-size:12px;line-height:1.4;opacity:.7}
.new-session-btn:hover{opacity:1;background:var(--vscode-list-hoverBackground)}
.session-id-row{margin:0 0 10px;font-size:10px;color:var(--vscode-descriptionForeground);display:flex;align-items:center;gap:4px;min-width:0}
.session-id-val{font-family:var(--vscode-editor-font-family,monospace);color:var(--vscode-foreground);opacity:.7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px}
.session-id-dot{width:6px;height:6px;border-radius:50%;background:var(--vscode-testing-iconPassed,#388a34);flex-shrink:0}
.loop-bar{display:flex;align-items:center;gap:6px;padding:6px 8px;background:var(--vscode-editor-background);border:1px solid var(--vscode-panel-border);border-radius:4px;margin-bottom:10px;font-size:12px}
.loop-status{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--vscode-descriptionForeground)}
.loop-status.running{color:var(--vscode-testing-iconPassed,#388a34);font-weight:600}
.loop-btn{padding:3px 8px;border-radius:3px;cursor:pointer;border:1px solid var(--vscode-button-background);background:transparent;color:var(--vscode-button-background);font-family:var(--vscode-font-family);font-size:11px;white-space:nowrap}
.loop-btn:hover:not(:disabled){background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
.loop-btn:disabled{opacity:.4;cursor:not-allowed}
.loop-btn.stop{border-color:var(--vscode-testing-iconFailed,#c72e2e);color:var(--vscode-testing-iconFailed,#c72e2e)}
.loop-btn.stop:hover{background:var(--vscode-testing-iconFailed,#c72e2e);color:#fff}
.loop-btn.retry{border-color:var(--vscode-statusBarItem-warningBackground,#b5630d);color:var(--vscode-statusBarItem-warningBackground,#b5630d)}
.loop-btn.retry:hover{background:var(--vscode-statusBarItem-warningBackground,#b5630d);color:#fff}
.settings-btn{padding:3px 6px;border-radius:3px;cursor:pointer;border:1px solid var(--vscode-panel-border);background:transparent;color:var(--vscode-descriptionForeground);font-size:13px;line-height:1}
.settings-btn:hover{background:var(--vscode-list-hoverBackground)}
.add-form{display:flex;gap:5px;margin-bottom:12px}
.add-input{flex:1;padding:5px 7px;font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,var(--vscode-panel-border));border-radius:3px;outline:none;min-width:0}
.add-input:focus{border-color:var(--vscode-focusBorder)}
.add-btn{padding:5px 10px;border-radius:3px;cursor:pointer;border:none;background:var(--vscode-button-background);color:var(--vscode-button-foreground);font-family:var(--vscode-font-family);font-size:12px;flex-shrink:0}
.add-btn:hover{opacity:.88}
.section-label{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--vscode-sideBarSectionHeader-foreground,var(--vscode-descriptionForeground));margin-bottom:6px}
.empty{text-align:center;color:var(--vscode-descriptionForeground);font-size:12px;padding:24px 0 8px;line-height:2}
.task{display:flex;align-items:flex-start;gap:7px;padding:5px 6px;border-radius:4px;margin-bottom:2px}
.task{cursor:pointer}.task:hover{background:var(--vscode-list-hoverBackground)}
.task-icon{flex-shrink:0;font-size:14px;line-height:1.3;width:16px;text-align:center}
.task-body{flex:1;min-width:0}
.task-text{font-size:12px;line-height:1.45;word-break:break-word}
.task.done .task-text{opacity:.45;text-decoration:line-through}
.task.in-progress{background:color-mix(in srgb,var(--vscode-statusBarItem-warningBackground,#b5630d) 14%,transparent)}
.task-date{font-size:10px;color:var(--vscode-descriptionForeground);margin-top:1px}
.pulse{animation:pulse 1.4s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.tab-bar{display:flex;border-bottom:1px solid var(--vscode-panel-border);margin-bottom:8px}
.tab-btn{flex:1;padding:5px 0;font-size:12px;cursor:pointer;border:none;background:transparent;color:var(--vscode-descriptionForeground);border-bottom:2px solid transparent;margin-bottom:-1px;font-family:var(--vscode-font-family)}
.tab-btn.active{color:var(--vscode-foreground);border-bottom-color:var(--vscode-button-background);font-weight:600}
.cfg-section{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--vscode-sideBarSectionHeader-foreground,var(--vscode-descriptionForeground));margin:10px 0 5px;padding-top:8px;border-top:1px solid var(--vscode-panel-border)}
.cfg-section:first-child{border-top:none;margin-top:0;padding-top:0}
.cfg-field{margin-bottom:7px}
.cfg-label{display:block;font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:2px}
.cfg-input{width:100%;padding:4px 6px;font-family:var(--vscode-font-family);font-size:12px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,var(--vscode-panel-border));border-radius:3px;outline:none}
.cfg-input:focus{border-color:var(--vscode-focusBorder)}
.cfg-row{display:flex;gap:5px}
.cfg-row .cfg-field{flex:1;min-width:0}
.cfg-save{width:100%;padding:5px;border-radius:3px;cursor:pointer;border:none;background:var(--vscode-button-background);color:var(--vscode-button-foreground);font-family:var(--vscode-font-family);font-size:12px;margin-top:8px}
.cfg-save:hover{opacity:.88}
.cfg-json{display:block;width:100%;padding:4px;border-radius:3px;cursor:pointer;border:1px solid var(--vscode-panel-border);background:transparent;color:var(--vscode-textLink-foreground);font-size:11px;font-family:var(--vscode-font-family);margin-top:5px;text-align:center}
.cfg-json:hover{background:var(--vscode-list-hoverBackground)}
</style>
</head>
<body>
<div class="provider-row">
  <span class="provider-label">Provider:</span>
  <select class="provider-select" id="providerSelect"></select>
</div>
<div class="resume-row" id="resumeRow" style="display:none">
  <input type="checkbox" id="resumeCheck">
  <label for="resumeCheck">Resume session</label>
  <button class="new-session-btn" id="newSessionBtn" title="Clear saved session — next run starts a new session">&#8635; New</button>
</div>
<div class="session-id-row" id="sessionIdRow" style="display:none">
  <span class="session-id-dot"></span>
  <span style="flex-shrink:0">Session:</span>
  <span class="session-id-val" id="sessionIdVal"></span>
</div>
<div class="loop-bar">
  <span class="loop-status" id="loopStatus">&#9711; Idle</span>
  <button class="loop-btn" id="loopBtn">&#9654; Start</button>
</div>
<div class="tab-bar">
  <button class="tab-btn active" id="tabTasks">Tasks</button>
  <button class="tab-btn" id="tabSettings">&#9881; Settings</button>
</div>
<div id="panelTasks">
<form class="add-form" id="addForm">
  <input class="add-input" id="taskInput" placeholder="New task&#x2026;" autocomplete="off">
  <button class="add-btn" type="submit">Add</button>
</form>
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
  <div class="section-label" style="margin-bottom:0">Tasks</div>
  <span id="taskProgress" style="font-size:11px;color:var(--vscode-descriptionForeground)"></span>
</div>
<div id="taskList"></div>
</div>
<div id="panelSettings" style="display:none">
<div id="cozempicBanner" style="display:none;padding:8px 10px;margin-bottom:10px;border-radius:4px;background:color-mix(in srgb,var(--vscode-statusBarItem-warningBackground,#b5630d) 15%,transparent);border:1px solid var(--vscode-statusBarItem-warningBackground,#b5630d);font-size:12px;line-height:1.6">
  <strong>Cozempic not detected</strong> &mdash; prunes bloated Claude Code sessions.<br>
  Install: <code style="font-size:11px">pip install cozempic</code> then run <code style="font-size:11px">cozempic init</code>
</div>
  <div class="cfg-section">Server</div>
  <div class="cfg-field"><label class="cfg-label">WebSocket URL</label><input class="cfg-input" id="cfg_wsUrl" placeholder="wss://host/ws?token=agt_xxx&amp;endpoint=my-slug"></div>
  <div class="cfg-section">Discord</div>
  <div class="cfg-field"><label class="cfg-label">Bot Token</label><input class="cfg-input" id="cfg_discordToken" type="password" placeholder="Bot token"></div>
  <div class="cfg-field"><label class="cfg-label">Channel ID</label><input class="cfg-input" id="cfg_discordChannelId" placeholder="123456789"></div>
<div class="cfg-field"><label class="cfg-label">Allowed Owners</label><input class="cfg-input" id="cfg_discordOwners" placeholder="user1,user2"></div>
  <div class="cfg-section">Loop</div>
  <div class="cfg-row">
    <div class="cfg-field"><label class="cfg-label">Idle Interval (s)</label><input class="cfg-input" id="cfg_loopInterval" type="number" min="1" max="3600"></div>
    <div class="cfg-field"><label class="cfg-label">Task Timeout (min)</label><input class="cfg-input" id="cfg_taskTimeoutMinutes" type="number" min="1" max="1440"></div>
    <div class="cfg-field"><label class="cfg-label">Check-in Interval (min)</label><input class="cfg-input" id="cfg_taskCheckInMinutes" type="number" min="1" max="1440"></div>
  </div>
  <div class="cfg-row">
    <div class="cfg-field cfg-check"><label><input type="checkbox" id="cfg_retryOnTimeout"> Retry on timeout</label></div>
    <div class="cfg-field cfg-check"><label><input type="checkbox" id="cfg_autoResetPendingTasks"> Auto-reset pending tasks on start</label></div>
  </div>
  <div class="cfg-section">VNC</div>
  <div class="cfg-row">
    <div class="cfg-field cfg-check"><label><input type="checkbox" id="cfg_vncEnabled"> Enable VNC</label></div>
  </div>
  <div class="cfg-row" id="vncFields">
    <div class="cfg-field"><label class="cfg-label">VNC Host</label><input class="cfg-input" id="cfg_vncHost" placeholder="(auto-detect from IP)"></div>
    <div class="cfg-field"><label class="cfg-label">VNC Port</label><input class="cfg-input" id="cfg_vncPort" type="number" min="1" max="65535"></div>
    <div class="cfg-field"><label class="cfg-label">VNC Password</label><input class="cfg-input" id="cfg_vncPassword" type="password" placeholder="(leave empty for no-auth)"></div>
  </div>
  <div class="cfg-section">RDP</div>
  <div class="cfg-row">
    <div class="cfg-field cfg-check"><label><input type="checkbox" id="cfg_rdpEnabled"> Enable RDP</label></div>
  </div>
  <div class="cfg-row" id="rdpFields">
    <div class="cfg-field"><label class="cfg-label">RDP Host</label><input class="cfg-input" id="cfg_rdpHost" placeholder="hostname or IP"></div>
    <div class="cfg-field"><label class="cfg-label">RDP Port</label><input class="cfg-input" id="cfg_rdpPort" type="number" min="1" max="65535"></div>
    <div class="cfg-field"><label class="cfg-label">Username</label><input class="cfg-input" id="cfg_rdpUsername" placeholder=""></div>
    <div class="cfg-field"><label class="cfg-label">Password</label><input class="cfg-input" id="cfg_rdpPassword" type="password"></div>
    <div class="cfg-field"><label class="cfg-label">Domain</label><input class="cfg-input" id="cfg_rdpDomain" placeholder="(optional)"></div>
    <div class="cfg-field"><label class="cfg-label">Guac WS URL</label><input class="cfg-input" id="cfg_rdpGuacWsUrl" placeholder="wss://myhost.com/guac-ws (for HTTPS frontends)"></div>
  </div>
  <div class="cfg-row">
    <div class="cfg-field cfg-check"><label><input type="checkbox" id="cfg_enableFileBrowser"> Enable File Browser (proxy access to project folder)</label></div>
    <div class="cfg-field cfg-check"><label><input type="checkbox" id="cfg_gitEnabled"> Enable Git Panel (exposes repo to browser UI)</label></div>
  </div>
  <div class="cfg-section">Hook Events</div>
  <div class="cfg-row">
    <div class="cfg-field cfg-check"><label><input type="checkbox" id="cfg_hooksEnabled"> Stream hook events to Pixel Office in real time</label></div>
  </div>
  <div id="hooksScopeRow" class="cfg-row" style="display:none">
    <div class="cfg-field cfg-check"><label><input type="radio" name="hooksScope" id="hooksScopeGlobal" value="global"> Global <small style="opacity:.6">~/.claude/settings.json — same file as cozempic</small></label></div>
    <div class="cfg-field cfg-check"><label><input type="radio" name="hooksScope" id="hooksScopeProject" value="project"> Project <small style="opacity:.6">.claude/settings.json in workspace</small></label></div>
  </div>
  <div id="hooksStatusBadge" style="display:none;font-size:11px;margin-bottom:4px;padding:3px 7px;border-radius:3px;background:color-mix(in srgb,var(--vscode-testing-iconPassed,#388a34) 15%,transparent);color:var(--vscode-testing-iconPassed,#388a34);border:1px solid var(--vscode-testing-iconPassed,#388a34)">&#10003; Hooks installed — events streaming to Pixel Office</div>
  <div class="cfg-row">
    <div class="cfg-field cfg-check"><label><input type="checkbox" id="cfg_openCodeHooksEnabled"> Stream OpenCode hook events to Pixel Office <small style="opacity:.6">(.opencode/plugins/autodev-hooks.ts)</small></label></div>
  </div>
  <div id="openCodeHooksStatusBadge" style="display:none;font-size:11px;margin-bottom:4px;padding:3px 7px;border-radius:3px;background:color-mix(in srgb,var(--vscode-testing-iconPassed,#388a34) 15%,transparent);color:var(--vscode-testing-iconPassed,#388a34);border:1px solid var(--vscode-testing-iconPassed,#388a34)">&#10003; OpenCode plugin installed — events streaming to Pixel Office</div>
  <div class="cfg-section">Paths</div>
  <div class="cfg-field"><label class="cfg-label">TODO.md Path</label><input class="cfg-input" id="cfg_todoPath" placeholder="(workspace root)"></div>
  <div class="cfg-field">
    <label class="cfg-label">Agent Profile</label>
    <div style="display:flex;gap:4px;align-items:center">
      <select class="cfg-input" id="cfg_profileSelect" style="flex:1"></select>
      <button id=\"openProfileBtn\" title=\"Open profile file\" class=\"cfg-save\" style=\"margin-top:0;width:auto;padding:5px 10px\" type=\"button\">Open</button>
    </div>
    <input class="cfg-input" id="cfg_profilePath" placeholder="Custom profile path..." style="margin-top:4px;display:none">
  </div>
  <button class="cfg-save" id="saveSettingsBtn">Save Settings</button>
  <button class="cfg-json" id="editJsonBtn">Edit raw JSON</button>
</div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
let state = {selectedProvider:'copilot',providers:[],tasks:[],loopState:'idle',loopTask:null,settings:{}};
let activeTab = 'tasks'; // track which tab is currently visible
let _pendingResume = null; // user's in-flight resumeSession toggle (null = no pending)

function showTab(tab) {
  activeTab = tab;
  document.getElementById('tabTasks').className   = 'tab-btn' + (tab==='tasks'?' active':'');
  document.getElementById('tabSettings').className = 'tab-btn' + (tab==='settings'?' active':'');
  document.getElementById('panelTasks').style.display    = tab==='tasks'?'':'none';
  document.getElementById('panelSettings').style.display = tab==='settings'?'':'none';
  if(tab==='settings'){populateSettings(state.settings||{});}
}

function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

function statusIcon(s){
  if(s==='done') return '<span style="color:var(--vscode-testing-iconPassed,#388a34)">&#10003;</span>';
  if(s==='in-progress') return '<span class="pulse" style="color:var(--vscode-statusBarItem-warningBackground,#e8ae00)">&#9681;</span>';
  return '<span style="opacity:.4">&#9675;</span>';
}

function renderProviders(){
  const sel=document.getElementById('providerSelect');
  const prev=sel.value;
  sel.innerHTML=state.providers.map(function(p){
    const label=esc(p.label)+(p.installed?'':' \u2717');
    const dis=p.installed?'':' disabled';
    return '<option value="'+p.id+'"'+dis+'>'+label+'</option>';
  }).join('');
  sel.value=state.selectedProvider||prev;
  sel.onchange=function(){vscode.postMessage({command:'setProvider',provider:sel.value});};

  // Show resume checkbox only for CLI providers
  const isCli=state.providers.find(function(p){return p.id===state.selectedProvider;})?.isCli;
  const resumeRow=document.getElementById('resumeRow');
  resumeRow.style.display=isCli?'flex':'none';
  const resumeCheck=document.getElementById('resumeCheck');
  const resumeOn=!!(state.settings&&state.settings.resumeSession);
  resumeCheck.checked=resumeOn;
  resumeCheck.onchange=function(){
    _pendingResume=resumeCheck.checked;
    vscode.postMessage({command:'saveSettings',settings:Object.assign({},state.settings||{},{resumeSession:resumeCheck.checked})});
  };
  const newSessBtn=document.getElementById('newSessionBtn');
  if(newSessBtn){newSessBtn.onclick=function(){vscode.postMessage({command:'newSession'});};}
  // Show captured session ID when resume is active and a session exists
  const sidRow=document.getElementById('sessionIdRow');
  const sidVal=document.getElementById('sessionIdVal');
  const hasSession=isCli&&resumeOn&&state.sessionId;
  sidRow.style.display=hasSession?'flex':'none';
  if(sidVal)sidVal.textContent=state.sessionId||'';
}

function renderLoop(){
  const statusEl=document.getElementById('loopStatus');
  const btnEl=document.getElementById('loopBtn');
  if(state.loopState==='running'){
    statusEl.className='loop-status running';
    const taskLabel=state.loopTask?'&#9654; '+esc(state.loopTask):'&#9654; Running\u2026';
    const activityLabel=state.claudeActivity?'<div style="font-size:10px;font-weight:400;opacity:.75;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(state.claudeActivity)+'</div>':'';
    statusEl.innerHTML=taskLabel+activityLabel;
    btnEl.className='loop-btn stop';
    btnEl.innerHTML='&#9632; Stop';
    btnEl.disabled=false;
    btnEl.onclick=function(){vscode.postMessage({command:'stopLoop'});};
  }else if(state.loopState==='paused'){
    statusEl.className='loop-status';
    const resumeStr=state.resumeAt?new Date(state.resumeAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'soon';
    statusEl.innerHTML='&#9208; Rate limited \u2014 auto-resume '+esc(resumeStr);
    btnEl.className='loop-btn retry';
    btnEl.innerHTML='&#9654; Retry Now';
    btnEl.disabled=false;
    btnEl.onclick=function(){vscode.postMessage({command:'retryLoop'});};
  }else if(state.loopState==='stopping'){
    statusEl.className='loop-status';
    statusEl.textContent='Stopping\u2026';
    btnEl.className='loop-btn';
    btnEl.innerHTML='&#9632; Stop';
    btnEl.disabled=true;
  }else{
    statusEl.className='loop-status';
    statusEl.innerHTML='&#9711; Idle';
    btnEl.className='loop-btn';
    btnEl.innerHTML='&#9654; Start';
    btnEl.disabled=false;
    btnEl.onclick=function(){vscode.postMessage({command:'startLoop'});};
  }
}

function renderTasks(){
  const list=document.getElementById('taskList');
  const prog=document.getElementById('taskProgress');
  const total=state.tasks.length;
  const doneCount=state.tasks.filter(function(t){return t.status==='done';}).length;
  const remaining=total-doneCount;
  if(prog){prog.textContent=total?doneCount+'/'+total+' done \u2022 '+remaining+' left':''}
  if(!state.tasks.length){
    list.innerHTML='<div class="empty">No tasks in TODO.md yet.<br>Add one above or edit <strong>TODO.md</strong> directly.</div>';
    return;
  }
  const pending=state.tasks.filter(function(t){return t.status!=='done';});
  const done=state.tasks.filter(function(t){return t.status==='done';});
  list.innerHTML=pending.concat(done).map(function(t){
    return '<div class="task '+t.status+'" data-line="'+(t.line||0)+'">'
      +'<span class="task-icon">'+statusIcon(t.status)+'</span>'
      +'<div class="task-body"><div class="task-text">'+esc(t.text)+'</div>'
      +(t.completedDate?'<div class="task-date">'+esc(t.completedDate)+'</div>':'')
      +'</div></div>';
  }).join('');
  list.querySelectorAll('.task').forEach(function(el){
    el.addEventListener('click',function(){
      const line=parseInt(el.getAttribute('data-line')||'0');
      if(line>0){vscode.postMessage({command:'openTask',line:line});}
    });
  });
}

function populateSettings(s){
  ['wsUrl','discordToken','discordChannelId',
   'discordOwners','todoPath'].forEach(function(k){
    const el=document.getElementById('cfg_'+k);
    if(el) el.value=s[k]||'';
  });
  const li=document.getElementById('cfg_loopInterval');
  if(li) li.value=s.loopInterval!==undefined?s.loopInterval:30;
  const tt=document.getElementById('cfg_taskTimeoutMinutes');
  if(tt) tt.value=s.taskTimeoutMinutes!==undefined?s.taskTimeoutMinutes:30;
  const ci=document.getElementById('cfg_taskCheckInMinutes');
  if(ci) ci.value=s.taskCheckInMinutes!==undefined?s.taskCheckInMinutes:20;
  const rot=document.getElementById('cfg_retryOnTimeout');
  if(rot) rot.checked=!!s.retryOnTimeout;
  const arp=document.getElementById('cfg_autoResetPendingTasks');
  if(arp) arp.checked=s.autoResetPendingTasks!==false;
  const vnce=document.getElementById('cfg_vncEnabled');
  if(vnce) vnce.checked=!!s.vncEnabled;
  const efb=document.getElementById('cfg_enableFileBrowser');
  if(efb) efb.checked=!!s.enableFileBrowser;
  const gite=document.getElementById('cfg_gitEnabled');
  if(gite) gite.checked=!!s.gitEnabled;
  const vnch=document.getElementById('cfg_vncHost');
  if(vnch) vnch.value=s.vncHost||'';
  const vncprt=document.getElementById('cfg_vncPort');
  if(vncprt) vncprt.value=s.vncPort!==undefined?s.vncPort:5900;
  const vncpw=document.getElementById('cfg_vncPassword');
  if(vncpw) vncpw.value=s.vncPassword||'';
  const rdpe=document.getElementById('cfg_rdpEnabled');
  if(rdpe) rdpe.checked=!!s.rdpEnabled;
  const rdph=document.getElementById('cfg_rdpHost');
  if(rdph) rdph.value=s.rdpHost||'';
  const rdpprt=document.getElementById('cfg_rdpPort');
  if(rdpprt) rdpprt.value=s.rdpPort!==undefined?s.rdpPort:3389;
  const rdpu=document.getElementById('cfg_rdpUsername');
  if(rdpu) rdpu.value=s.rdpUsername||'';
  const rdppw=document.getElementById('cfg_rdpPassword');
  if(rdppw) rdppw.value=s.rdpPassword||'';
  const rdpd=document.getElementById('cfg_rdpDomain');
  if(rdpd) rdpd.value=s.rdpDomain||'';
  const rdpguac=document.getElementById('cfg_rdpGuacWsUrl');
  if(rdpguac) rdpguac.value=s.rdpGuacWsUrl||'';
  // Hooks
  const he=document.getElementById('cfg_hooksEnabled');
  if(he) he.checked=!!s.hooksEnabled;
  const hscope=s.hooksScope||'project';
  const hsp=document.getElementById('hooksScopeProject');
  const hsg=document.getElementById('hooksScopeGlobal');
  if(hsg) hsg.checked=hscope==='global';
  if(hsp) hsp.checked=hscope==='project';
  const isClaudeProv=state.selectedProvider==='claude-cli';
  document.getElementById('hooksScopeRow').style.display=(!!s.hooksEnabled&&isClaudeProv)?'':'none';
  // OpenCode hooks
  const oce=document.getElementById('cfg_openCodeHooksEnabled');
  if(oce) oce.checked=!!s.openCodeHooksEnabled;
  // Populate profile dropdown
  renderProfileSelect(state.profiles||[], s['profilePath']||'');
}

function renderProfileSelect(profiles, currentPath){
  const sel=document.getElementById('cfg_profileSelect');
  const input=document.getElementById('cfg_profilePath');
  if(!sel||!input) return;
  sel.innerHTML=profiles.map(function(p){
    const fileName=(p.filePath||'').split(/[\\/]/).pop()||p.filePath||'';
    const tip=[p.description||'', fileName].filter(function(x){ return !!x; }).join('\\n');
    const label=(p.title||'')+' \u00b7 '+fileName;
    return '<option value="'+esc(p.filePath)+'" title="'+esc(tip)+'">'+esc(label)+'</option>';
  }).join('')+'<option value="__custom__">Custom path\u2026</option>';
  // Determine which option matches the current path
  const match=profiles.find(function(p){return p.filePath===currentPath;});
  if(match){
    sel.value=match.filePath;
    input.style.display='none';
  } else if(currentPath){
    sel.value='__custom__';
    input.value=currentPath;
    input.style.display='';
  } else {
    // Default: first built-in profile (empty profilePath = auto-detect)
    sel.value=profiles[0]?profiles[0].filePath:'__custom__';
    input.style.display='none';
  }
  sel.onchange=function(){
    if(sel.value==='__custom__'){input.style.display='';input.focus();}
    else{input.style.display='none';}
  };
  const openBtn=document.getElementById('openProfileBtn');
  if(openBtn){
    openBtn.onclick=function(){
      const path=sel.value==='__custom__'?input.value:sel.value;
      if(path&&path!=='__custom__'){vscode.postMessage({command:'openFile',filePath:path});}
    };
  }
}

document.getElementById('tabTasks').addEventListener('click',function(){showTab('tasks');});
document.getElementById('tabSettings').addEventListener('click',function(){showTab('settings');});

document.getElementById('addForm').addEventListener('submit',function(e){
  e.preventDefault();
  const input=document.getElementById('taskInput');
  const text=input.value.trim();
  if(!text){return;}
  vscode.postMessage({command:'addTask',text:text});
  input.value='';
  input.focus();
});

document.getElementById('saveSettingsBtn').addEventListener('click',function(){
  const profileSel=document.getElementById('cfg_profileSelect');
  const profileInput=document.getElementById('cfg_profilePath');
  const profilePath=profileSel&&profileSel.value==='__custom__'
    ?(profileInput?profileInput.value:'')
    :(profileSel?profileSel.value:'');
  const s={
    provider:state.selectedProvider,
    wsUrl:document.getElementById('cfg_wsUrl').value,
    discordToken:document.getElementById('cfg_discordToken').value,
    discordChannelId:document.getElementById('cfg_discordChannelId').value,
discordOwners:document.getElementById('cfg_discordOwners').value,
    loopInterval:parseInt(document.getElementById('cfg_loopInterval').value)||30,
    taskTimeoutMinutes:parseInt(document.getElementById('cfg_taskTimeoutMinutes').value)||30,
    taskCheckInMinutes:parseInt(document.getElementById('cfg_taskCheckInMinutes').value)||20,
    retryOnTimeout:document.getElementById('cfg_retryOnTimeout').checked,
    autoResetPendingTasks:document.getElementById('cfg_autoResetPendingTasks').checked,
    vncEnabled:document.getElementById('cfg_vncEnabled').checked,
    vncHost:document.getElementById('cfg_vncHost').value.trim(),
    vncPort:parseInt(document.getElementById('cfg_vncPort').value)||5900,
    vncPassword:document.getElementById('cfg_vncPassword').value,
    rdpEnabled:document.getElementById('cfg_rdpEnabled').checked,
    rdpHost:document.getElementById('cfg_rdpHost').value.trim(),
    rdpPort:parseInt(document.getElementById('cfg_rdpPort').value)||3389,
    rdpUsername:document.getElementById('cfg_rdpUsername').value,
    rdpPassword:document.getElementById('cfg_rdpPassword').value,
    rdpDomain:document.getElementById('cfg_rdpDomain').value.trim(),
    rdpGuacWsUrl:document.getElementById('cfg_rdpGuacWsUrl').value.trim(),
    enableFileBrowser:document.getElementById('cfg_enableFileBrowser').checked,
    gitEnabled:document.getElementById('cfg_gitEnabled').checked,
    hooksEnabled:document.getElementById('cfg_hooksEnabled').checked,
    hooksScope:document.querySelector('input[name="hooksScope"]:checked')?.value||'global',
    openCodeHooksEnabled:document.getElementById('cfg_openCodeHooksEnabled').checked,
    resumeSession:!!(state.settings&&state.settings.resumeSession),
    profilePath:profilePath,
    todoPath:document.getElementById('cfg_todoPath').value,
  };
  vscode.postMessage({command:'saveSettings',settings:s});
  document.getElementById('tabTasks').click();
});

document.getElementById('editJsonBtn').addEventListener('click',function(){
  vscode.postMessage({command:'openSettings'});
});

document.getElementById('cfg_hooksEnabled').addEventListener('change',function(){
  const isClaudeProv=state.selectedProvider==='claude-cli';
  document.getElementById('hooksScopeRow').style.display=(this.checked&&isClaudeProv)?'':'none';
});

window.addEventListener('message',function(e){
  const msg=e.data;
  if(msg.command==='update'){
    const pr=_pendingResume;
    state=msg;
    if(pr!==null){
      if(state.settings&&state.settings.resumeSession===pr){_pendingResume=null;}
      else{if(state.settings)state.settings.resumeSession=pr;}
    }
    renderProviders();renderLoop();renderTasks();showTab(activeTab);
    document.getElementById('cozempicBanner').style.display=msg.cozempicInstalled===false?'':'none';
    document.getElementById('hooksStatusBadge').style.display=msg.hooksInstalled?'':'none';
    document.getElementById('openCodeHooksStatusBadge').style.display=msg.openCodeHooksInstalled?'':'none';
  }
});
</script>
</body>
</html>`;
}
