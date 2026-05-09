import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { areHooksInstalled, installHooks, uninstallHooks } from './hooksManager';
import { isOpenCodeHooksInstalled, installOpenCodeHooks, uninstallOpenCodeHooks } from './openCodeHooksManager';
import { ConfigManager } from './configManager';
import { loadProjectUserMcp, saveProjectUserMcp, removeProjectUserMcp } from './core/projectMcp';
import { DEFAULT_MCP_SERVERS } from './mcpManager';
import { getMcpInstallSnapshot, checkMcpInstallAsync, refreshMcpInstall, installCommandFor, invalidateMcpInstallCache } from './mcpInstallCheck';
import { testEmailViaMcp } from './mcpEmailTest';
import { ProviderId, ProviderConfig, PROVIDERS } from './providers';
import { LoopState } from './taskLoop';
import { taskLoopRunner } from './taskLoop';
import { loadSettings, saveSettings, AutodevSettings, getBuiltinProfiles } from './settings';
import { applyMcpSkills } from './protocolSections';
import { Task, parseTodo } from './todo';
import { todoWriter } from './todoWriteManager';
import { getSessionId, clearSessionId } from './sessionState';
import { mcpConfigCss, mcpConfigHtml, mcpConfigScript } from './sidebarMcpConfig';
import { sidebarBaseCss } from './sidebarCss';
import { tasksPanelHtml, tasksPanelScript } from './sidebarTasksPanel';
import { profilePanelHtml, profilePanelScript } from './sidebarProfilePanel';
import { settingsPanelHtml, settingsPanelScript } from './sidebarSettingsPanel';
import { PROFILE_SECTIONS } from './profileBuilder';
import { rebuildProfile } from './messageBuilder';

// ---------------------------------------------------------------------------
// TodoViewProvider â€” sidebar webview that shows TODO.md tasks + loop controls
// ---------------------------------------------------------------------------

const PROVIDER_KEY = 'autodev.selectedProvider';
const FALLBACK_PROVIDER_KEY = 'autodev.fallbackProvider';
const FALLBACK_ENABLED_KEY  = 'autodev.fallbackProviderEnabled';

export class TodoViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'autodev.chatStatus';

  private _view?: vscode.WebviewView;
  private _tasks: Task[] = [];
  private _loopState: LoopState = 'idle';
  private _loopTask?: string;
  private _claudeActivity?: string;
  private _selectedProvider: ProviderId;
  private _fallbackProvider: ProviderId;
  private _fallbackProviderEnabled: boolean;
  private _watcher?: vscode.FileSystemWatcher;
  private _sessionWatcher?: vscode.FileSystemWatcher;
  private _settingsWatcher?: vscode.FileSystemWatcher;
  private _pollTimer?: ReturnType<typeof setInterval>;
  private _lastNotifyTime = 0;
  private _lastKnownMtime = 0;
  private _cozempicInstalled: boolean | null = null;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext
  ) {
    this._selectedProvider =
      this._context.workspaceState.get<ProviderId>(PROVIDER_KEY) ?? 'claude-cli';
    this._fallbackProvider =
      this._context.workspaceState.get<ProviderId>(FALLBACK_PROVIDER_KEY) ?? 'opencode-cli';
    this._fallbackProviderEnabled =
      this._context.workspaceState.get<boolean>(FALLBACK_ENABLED_KEY) ?? false;
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
        case 'setProvider':              this.setProvider(msg.provider as ProviderId); break;
        case 'setFallbackProvider':       this.setFallbackProvider(msg.provider as ProviderId); break;
        case 'setFallbackProviderEnabled':this.setFallbackProviderEnabled(msg.enabled as boolean); break;
        case 'addTask':     this._addTask(msg.text as string); break;
        case 'startLoop':   void vscode.commands.executeCommand('autodev.startTaskLoop'); break;
        case 'stopLoop':    void vscode.commands.executeCommand('autodev.stopTaskLoop'); break;
        case 'retryLoop':   void vscode.commands.executeCommand('autodev.retryLoop'); break;
        case 'openTask':    void this._openTaskLine(msg.line as number); break;
        case 'saveSettings': {
          const prev = loadSettings();
          // Merge with existing so MCP servers, profile sections, custom refs,
          // and other fields not present in the form are preserved.
          const next: AutodevSettings = { ...prev, ...(msg.settings as AutodevSettings) };
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
        case 'getOpenCodeModels': {
          const view = this._view;
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { exec } = require('child_process') as typeof import('child_process');
          exec('opencode models', { encoding: 'utf8', timeout: 10_000 }, (_err, stdout) => {
            const models = (stdout ?? '').split('\n').map((l: string) => l.trim()).filter(Boolean).sort();
            view?.webview.postMessage({ command: 'opencodeModels', models });
          });
          break;
        }
        case 'saveMcpBulk': {
          // Global Save All & Sync â€” full replace of user MCP entries directly
          // in <root>/.mcp.json. We no longer touch .autodev/settings.json's
          // mcpServers field (it's been retired â€” .mcp.json is the source).
          const entries = (msg.entries ?? {}) as Record<string, { command: string; args?: string[]; env?: Record<string, string>; enabled?: boolean }>;
          // Drop any entry the form marked enabled:false â€” disabling = remove.
          const enabled: Record<string, { command: string; args?: string[]; env?: Record<string, string> }> = {};
          for (const [name, e] of Object.entries(entries)) {
            if (!e || e.enabled === false) continue;
            enabled[name] = { command: e.command, args: e.args, ...(e.env ? { env: e.env } : {}) };
          }
          const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (root) {
            saveProjectUserMcp(root, enabled);
            try { applyMcpSkills(root, loadSettings()); } catch { /* ignore */ }
          }
          this._syncAndPushMcp();
          vscode.window.showInformationMessage(
            `AutoDev: ${Object.keys(enabled).length} MCP server(s) saved to .mcp.json.`
          );
          break;
        }
        case 'removeMcpEntry': {
          const name = String(msg.name ?? '').trim();
          if (!name) break;
          const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (root) removeProjectUserMcp(root, name);
          this._syncAndPushMcp();
          vscode.window.showInformationMessage(`AutoDev: '${name}' removed.`);
          break;
        }
        case 'toggleBuiltinMcp': {
          const name = String(msg.name ?? '').trim();
          const enabled = !!msg.enabled;
          if (!name) break;
          const current = loadSettings();
          const set = new Set(current.disabledBuiltinMcp ?? []);
          if (enabled) set.delete(name); else set.add(name);
          saveSettings({ ...current, disabledBuiltinMcp: [...set] });
          this._syncAndPushMcp();
          break;
        }
        case 'saveProfileSections': {
          const sections = (msg.sections ?? []) as string[];
          const customRefs = (msg.customRefs ?? []) as string[];
          const current = loadSettings();
          saveSettings({ ...current, enabledProfileSections: sections, customProfileRefs: customRefs });
          // Immediately rebuild AGENT_PROFILE.md and inject reference into CLAUDE.md / AGENTS.md
          const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (root) {
            try { rebuildProfile(root); } catch (err) {
              vscode.window.showErrorMessage(`AutoDev: Profile rebuild failed â€” ${(err as Error).message}`);
            }
          }
          this._push();
          vscode.window.showInformationMessage('AutoDev: Profile saved and AGENT_PROFILE.md rebuilt.');
          break;
        }
        case 'installMcpServer': {
          // Find the target server (built-in or user-configured) by name and
          // open a terminal running the right install command (npm i -g pkg /
          // uv tool install pkg / uv self-install). After it returns, we
          // invalidate the install-check cache and push so badges update.
          const name = String(msg.name ?? '').trim();
          if (!name) break;
          const allServers = [
            ...DEFAULT_MCP_SERVERS,
            ...(() => {
              const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
              const um = root ? loadProjectUserMcp(root) : {};
              return Object.entries(um).map(([n, e]) => ({ name: n, command: e.command, args: e.args ?? [] }));
            })(),
          ];
          const target = allServers.find(s => s.name === name);
          if (!target) break;
          // Async probe â€” must not block the extension host.
          checkMcpInstallAsync({ command: target.command, args: target.args }).then(info => {
            const cmd = installCommandFor(info);
            if (!cmd) {
              if (info.status === 'missing-runner' && (info.runner === 'npx' || info.runner === 'node' || info.runner === 'npm')) {
                vscode.env.openExternal(vscode.Uri.parse('https://nodejs.org/'));
              } else {
                vscode.window.showWarningMessage(
                  `AutoDev: no automatic install for '${name}' (${info.status}, runner=${info.runner}). Install manually.`,
                );
              }
              return;
            }
            const term = vscode.window.createTerminal(`Install: ${name}`);
            term.show(true);
            term.sendText(cmd);
            setTimeout(() => { invalidateMcpInstallCache(); this._refreshMcpInstall(); }, 6000);
          });
          break;
        }
        case 'testMcpEmail': {
          // Live test: spawn the actual mcp-email-server with the form env,
          // run init + tools/list + an IMAP-reading tool, post result back.
          const env = (msg.env ?? {}) as Record<string, string>;
          const view = this._view;
          (async () => {
            const r = await testEmailViaMcp(env as Parameters<typeof testEmailViaMcp>[0]);
            view?.webview.postMessage({ command: 'mcpEmailTestResult', result: r });
          })().catch(err => {
            view?.webview.postMessage({
              command: 'mcpEmailTestResult',
              result: { ok: false, message: 'Test crashed: ' + String(err), steps: [] },
            });
          });
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
    // Defer install probes so the webview's service worker has time to
    // register before we spawn child processes that hog the event loop.
    setTimeout(() => this._refreshMcpInstall(), 8000);
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
    this._context.workspaceState.update(PROVIDER_KEY, id);
    const current = loadSettings();
    saveSettings({ ...current, provider: id });
    this._push();
  }

  /** Transiently switch the active provider without persisting (used by fallback logic). */
  setActiveProviderTransient(id: ProviderId): void {
    this._selectedProvider = id;
    this._push();
  }

  setFallbackProvider(id: ProviderId): void {
    this._fallbackProvider = id;
    this._context.workspaceState.update(FALLBACK_PROVIDER_KEY, id);
    const current = loadSettings();
    saveSettings({ ...current, fallbackProvider: id });
    this._push();
  }

  setFallbackProviderEnabled(enabled: boolean): void {
    this._fallbackProviderEnabled = enabled;
    this._context.workspaceState.update(FALLBACK_ENABLED_KEY, enabled);
    const current = loadSettings();
    saveSettings({ ...current, fallbackProviderEnabled: enabled });
    this._push();
  }

  get fallbackProvider(): ProviderId { return this._fallbackProvider; }
  get fallbackProviderEnabled(): boolean { return this._fallbackProviderEnabled; }

  refresh(): void { this._refreshTasks(); }

  private _addTask(text: string): void {
    if (!text.trim()) { return; }
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) { vscode.window.showWarningMessage('AutoDev: No workspace folder open.'); return; }
    const settings = loadSettings();
    const todoPath = settings.todoPath || path.join(root, 'TODO.md');
    todoWriter.append(todoPath, text.trim())
      .then(() => this._refreshTasks())
      .catch(() => {});
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

    // Watch the settings file so the settings tab refreshes when edited externally.
    // Watches both the canonical (.autodev/settings.json) and legacy (.vscode/autodev.json)
    // locations so existing workspaces keep working until they migrate.
    this._settingsWatcher?.dispose();
    this._settingsWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(root, '{.autodev/settings.json,.vscode/autodev.json}')
    );
    const settingsNotify = () => this._push();
    this._settingsWatcher.onDidChange(settingsNotify);
    this._settingsWatcher.onDidCreate(settingsNotify);

    // Fallback: check TODO.md mtime every 30 s and refresh if it changed
    // externally (e.g. edited in another editor or by a script). This catches
    // missed fs events on Linux/WSL where inotify can silently drop events.
    if (this._pollTimer) { clearInterval(this._pollTimer); }
    this._lastKnownMtime = this._readTodoMtime(todoPath);
    this._pollTimer = setInterval(() => {
      const mtime = this._readTodoMtime(todoPath);
      if (mtime !== this._lastKnownMtime) {
        this._lastKnownMtime = mtime;
        this._refreshTasks();
      }
    }, 30_000);
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

  /** Returns the last-modified timestamp (ms) of todoPath, or 0 on error. */
  private _readTodoMtime(todoPath: string): number {
    try { return fs.statSync(todoPath).mtimeMs; } catch { return 0; }
  }

  private _refreshTasks(): void {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) { this._tasks = []; this._push(); return; }
    const settings = loadSettings();
    const todoPath = settings.todoPath || path.join(root, 'TODO.md');
    this._lastKnownMtime = this._readTodoMtime(todoPath); // keep mtime in sync after any refresh
    this._tasks = parseTodo(todoPath);
    this._push();
  }

  private _syncHooks(prev: AutodevSettings, next: AutodevSettings, root: string): void {
    const wasEnabled = prev.hooksEnabled;
    const isEnabled  = next.hooksEnabled;

    if (!isEnabled) {
      // Uninstall from both scopes to clean up (global may have been set by old versions)
      if (wasEnabled || areHooksInstalled('project', root)) { uninstallHooks('project', root); }
      if (areHooksInstalled('global', root))                { uninstallHooks('global', root); }
    } else {
      // Always project scope â€” also migrate away from global if it was set before
      if (areHooksInstalled('global', root)) { uninstallHooks('global', root); }
      installHooks('project', root);
    }

    // OpenCode hooks — install/uninstall plugin file
    const wasOcEnabled = prev.openCodeHooksEnabled;
    const isOcEnabled  = next.openCodeHooksEnabled;
    if (!isOcEnabled) {
      if (wasOcEnabled || isOpenCodeHooksInstalled(root)) { uninstallOpenCodeHooks(root); }
    } else {
      installOpenCodeHooks(root);
    }

    // OpenCode cache — apply/remove setCacheKey from opencode.json when toggled
    if (prev.opencodeCacheEnabled !== next.opencodeCacheEnabled) {
      try { ConfigManager.applyOpenCodeCacheSettings(root, next.opencodeCacheEnabled); }
      catch { /* non-fatal */ }
    }
  }

  /**
   * Sync MCP servers from `.autodev/settings.json` into every per-project
   * provider config (.mcp.json, .claude/settings.local.json, opencode.json,
   * .vscode/mcp.json) and re-push the webview state. Used by every MCP
   * write path (custom JSON, Jira form, Email form, remove).
   */
  private _syncAndPushMcp(): void {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (root) {
      try { ConfigManager.syncProjectMcpServers(root); }
      catch (err) { vscode.window.showErrorMessage(`AutoDev: MCP sync failed: ${err}`); }
    }
    invalidateMcpInstallCache();
    this._push();
    this._refreshMcpInstall(); // re-probe in background, push when done
  }

  /**
   * Probe MCP runner/package install state in the background. Spawning
   * `where`/`which` + `npm ls -g` + `uv tool list` for every default server is
   * slow on cold start, so we never block _push() on it. Once probes settle,
   * we re-push so the badges update.
   */
  private _refreshMcpInstall(): void {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const userMcp = root ? loadProjectUserMcp(root) : {};
    const targets = [
      ...DEFAULT_MCP_SERVERS.map(s => ({ command: s.command, args: s.args })),
      ...Object.entries(userMcp).map(([, e]) => ({ command: e.command, args: e.args ?? [] })),
    ];
    refreshMcpInstall(targets).then(() => this._push()).catch(() => { /* ignore */ });
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
    const settings = loadSettings();
    // mcpServers are sourced from <root>/.mcp.json (the official MCP file),
    // NOT .autodev/settings.json. The settings file no longer carries them.
    const userMcp = root ? loadProjectUserMcp(root) : {};
    settings.mcpServers = userMcp;
    const allMcp = [
      ...DEFAULT_MCP_SERVERS.map(s => ({ name: s.name, command: s.command, args: s.args })),
      ...Object.entries(userMcp).map(([n, e]) => ({ name: n, command: e.command, args: e.args ?? [] })),
    ];
    const mcpInstall: Record<string, { status: string; runner: string; pkg?: string; canInstall: boolean }> = {};
    for (const s of allMcp) {
      const info = getMcpInstallSnapshot({ command: s.command, args: s.args });
      mcpInstall[s.name] = {
        status: info.status,
        runner: info.runner,
        ...(info.pkg ? { pkg: info.pkg } : {}),
        canInstall: !!installCommandFor(info) || (info.status === 'missing-runner' && (info.runner === 'npx' || info.runner === 'node' || info.runner === 'npm')),
      };
    }
    this._view?.webview.postMessage({
      command: 'update',
      selectedProvider: this._selectedProvider,
      fallbackProvider: this._fallbackProvider,
      fallbackProviderEnabled: this._fallbackProviderEnabled,
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
      settings,
      sessionId,
      resumeAt: taskLoopRunner.resumeAt?.getTime() ?? null,
      profiles: getBuiltinProfiles(),
      cozempicInstalled: this._checkCozempic(),
      hooksInstalled: root ? areHooksInstalled('project', root) : false,
      openCodeHooksInstalled: root ? isOpenCodeHooksInstalled(root) : false,
      mcpDefaults: DEFAULT_MCP_SERVERS.map(s => ({ name: s.name, command: s.command, args: s.args })),
      disabledBuiltinMcp: settings.disabledBuiltinMcp ?? [],
      mcpInstall,
      profileSections: PROFILE_SECTIONS.map(s => ({ id: s.id, label: s.label })),
      enabledProfileSections: settings.enabledProfileSections ?? [],
      customProfileRefs: settings.customProfileRefs ?? [],
    });
  }
}

// ---------------------------------------------------------------------------
// HTML for the sidebar webview â€” assembled from composable panel modules
// ---------------------------------------------------------------------------

function buildHtml(_webview: vscode.Webview): string {
  const nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AutoDev</title>
<style nonce="${nonce}">${sidebarBaseCss}${mcpConfigCss}</style>
</head>
<body>
<div class="provider-row">
  <span class="provider-label">Provider:</span>
  <select class="provider-select" id="providerSelect"></select>
</div>
<div class="fallback-row" id="fallbackRow">
  <input type="checkbox" id="fallbackCheck">
  <label for="fallbackCheck" style="white-space:nowrap">On limit, use:</label>
  <select class="provider-select" id="fallbackSelect"></select>
</div>
<div class="model-row" id="modelRow" style="display:none">
  <span class="provider-label">Model:</span>
  <select class="model-select" id="modelSelect"></select>
</div>
<div class="model-row" id="opencodeModelRow" style="display:none">
  <span class="provider-label">Model:</span>
  <input class="model-search" id="opencodeModelInput" list="ocModelDatalist" placeholder="Search model…" autocomplete="off">
  <datalist id="ocModelDatalist"></datalist>
</div>
<div class="resume-row" id="opencodeCacheRow" style="display:none">
  <input type="checkbox" id="opencodeCacheCheck">
  <label for="opencodeCacheCheck">Enable model caching</label>
</div>
<div class="resume-row" id="resumeRow" style="display:none">
  <input type="checkbox" id="resumeCheck">
  <label for="resumeCheck">Resume session</label>
  <button class="new-session-btn" id="newSessionBtn" title="Clear saved session â€” next run starts a new session">&#8635; New</button>
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
  <button class="tab-btn" id="tabMcp">MCP</button>
  <button class="tab-btn" id="tabProfile">&#9776; Profile</button>
  <button class="tab-btn" id="tabSettings">&#9881; Settings</button>
</div>
${tasksPanelHtml}
${mcpConfigHtml}
${profilePanelHtml}
${settingsPanelHtml}
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
let state = {selectedProvider:'claude-cli',fallbackProvider:'opencode-cli',fallbackProviderEnabled:false,providers:[],tasks:[],loopState:'idle',loopTask:null,settings:{}};
let activeTab = 'tasks';
let _pendingResume = null;

function showTab(tab) {
  activeTab = tab;
  document.getElementById('tabTasks').className    = 'tab-btn' + (tab==='tasks'?' active':'');
  document.getElementById('tabMcp').className      = 'tab-btn' + (tab==='mcp'?' active':'');
  document.getElementById('tabProfile').className  = 'tab-btn' + (tab==='profile'?' active':'');
  document.getElementById('tabSettings').className = 'tab-btn' + (tab==='settings'?' active':'');
  document.getElementById('panelTasks').style.display    = tab==='tasks'?'':'none';
  document.getElementById('panelMcp').style.display      = tab==='mcp'?'':'none';
  document.getElementById('panelProfile').style.display  = tab==='profile'?'':'none';
  document.getElementById('panelSettings').style.display = tab==='settings'?'':'none';
  if(tab==='settings'){populateSettings(state.settings||{});}
  if(tab==='mcp'){populateMcp(state.settings||{}, state.mcpDefaults||[]);}
  if(tab==='profile'){renderProfileSections(state.profileSections||[], state.enabledProfileSections||[], state.customProfileRefs||[]);}
}

function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

function statusIcon(s){
  if(s==='done') return '<span style="color:var(--vscode-testing-iconPassed,#388a34)">&#10003;</span>';
  if(s==='in-progress') return '<span class="pulse" style="color:var(--vscode-statusBarItem-warningBackground,#e8ae00)">&#9681;</span>';
  return '<span style="opacity:.4">&#9675;</span>';
}

function buildProviderOptions(providers, selectedId) {
  return providers.map(function(p) {
    var label = esc(p.label) + (p.installed ? '' : ' \u2717');
    var dis = p.installed ? '' : ' disabled';
    var sel = p.id === selectedId ? ' selected' : '';
    return '<option value="' + p.id + '"' + dis + sel + '>' + label + '</option>';
  }).join('');
}

function renderProviders(){
  var sel=document.getElementById('providerSelect');
  sel.innerHTML=buildProviderOptions(state.providers, state.selectedProvider);
  sel.onchange=function(){vscode.postMessage({command:'setProvider',provider:sel.value});};

  var fallbackCheck=document.getElementById('fallbackCheck');
  var fallbackSel=document.getElementById('fallbackSelect');
  var enabled=!!(state.fallbackProviderEnabled);
  fallbackCheck.checked=enabled;
  fallbackSel.disabled=!enabled;
  fallbackSel.innerHTML=buildProviderOptions(state.providers, state.fallbackProvider||'');
  fallbackCheck.onchange=function(){
    vscode.postMessage({command:'setFallbackProviderEnabled',enabled:fallbackCheck.checked});
    fallbackSel.disabled=!fallbackCheck.checked;
  };
  fallbackSel.onchange=function(){
    vscode.postMessage({command:'setFallbackProvider',provider:fallbackSel.value});
  };

  var isCli=state.providers.find(function(p){return p.id===state.selectedProvider;})?.isCli;
  var resumeRow=document.getElementById('resumeRow');
  resumeRow.style.display=isCli?'flex':'none';
  var resumeCheck=document.getElementById('resumeCheck');
  var resumeOn=!!(state.settings&&state.settings.resumeSession);
  resumeCheck.checked=resumeOn;
  resumeCheck.onchange=function(){
    _pendingResume=resumeCheck.checked;
    vscode.postMessage({command:'saveSettings',settings:Object.assign({},state.settings||{},{resumeSession:resumeCheck.checked})});
  };
  var newSessBtn=document.getElementById('newSessionBtn');
  if(newSessBtn){newSessBtn.onclick=function(){vscode.postMessage({command:'newSession'});};}
  var sidRow=document.getElementById('sessionIdRow');
  var sidVal=document.getElementById('sessionIdVal');
  var hasSession=isCli&&resumeOn&&state.sessionId;
  sidRow.style.display=hasSession?'flex':'none';
  if(sidVal){sidVal.textContent=state.sessionId||'';}

  var modelRow=document.getElementById('modelRow');
  var modelSel=document.getElementById('modelSelect');
  var isCopilot=state.selectedProvider==='copilot-cli';
  modelRow.style.display=isCopilot?'flex':'none';

  var ocModelRow=document.getElementById('opencodeModelRow');
  var ocModelInp=document.getElementById('opencodeModelInput');
  var isOpenCode=state.selectedProvider==='opencode-cli';
  ocModelRow.style.display=isOpenCode?'flex':'none';
  if(isOpenCode&&ocModelInp&&!ocModelInp.dataset.loaded){
    ocModelInp.dataset.loaded='1';
    vscode.postMessage({command:'getOpenCodeModels'});
  }
  if(isOpenCode&&ocModelInp&&ocModelInp.dataset.loaded==='ready'){
    var curOc=(state.settings&&state.settings.opencodeModel)||'';
    if(document.activeElement!==ocModelInp&&ocModelInp.value!==curOc){ocModelInp.value=curOc;}
    ocModelInp.onchange=function(){
      vscode.postMessage({command:'saveSettings',settings:Object.assign({},state.settings||{},{opencodeModel:ocModelInp.value})});
    };
  }

  var ocCacheRow=document.getElementById('opencodeCacheRow');
  var ocCacheCheck=document.getElementById('opencodeCacheCheck');
  if(ocCacheRow){ocCacheRow.style.display=isOpenCode?'flex':'none';}
  if(isOpenCode&&ocCacheCheck){
    var cacheEnabled=!!(state.settings&&state.settings.opencodeCacheEnabled);
    if(ocCacheCheck.checked!==cacheEnabled){ocCacheCheck.checked=cacheEnabled;}
    ocCacheCheck.onchange=function(){
      vscode.postMessage({command:'saveSettings',settings:Object.assign({},state.settings||{},{opencodeCacheEnabled:ocCacheCheck.checked})});
    };
  }
  if(isCopilot&&modelSel){
    var MODELS=[
      {v:'',l:'Default model'},
      {v:'claude-haiku-4.5',l:'Claude Haiku 4.5'},
      {v:'claude-sonnet-4.5',l:'Claude Sonnet 4.5'},
      {v:'claude-sonnet-4.6',l:'Claude Sonnet 4.6'},
      {v:'claude-opus-4.5',l:'Claude Opus 4.5'},
      {v:'claude-opus-4.6',l:'Claude Opus 4.6'},
      {v:'claude-opus-4.7',l:'Claude Opus 4.7'},
      {v:'gpt-4.1',l:'GPT-4.1'},
      {v:'gpt-5-mini',l:'GPT-5 mini'},
      {v:'gpt-5.2',l:'GPT-5.2'},
      {v:'gpt-5.2-codex',l:'GPT-5.2-Codex'},
      {v:'gpt-5.3-codex',l:'GPT-5.3-Codex'},
      {v:'gpt-5.4',l:'GPT-5.4'},
      {v:'gpt-5.4-mini',l:'GPT-5.4 mini'},
      {v:'gpt-5.5',l:'GPT-5.5'},
      {v:'gemini-2.5-pro',l:'Gemini 2.5 Pro'},
      {v:'gemini-3-flash',l:'Gemini 3 Flash'},
      {v:'gemini-3.1-pro',l:'Gemini 3.1 Pro'},
      {v:'grok-code-fast-1',l:'Grok Code Fast 1'},
    ];
    var cur=(state.settings&&state.settings.copilotModel)||'';
    modelSel.innerHTML=MODELS.map(function(m){return '<option value="'+m.v+'"'+(m.v===cur?' selected':'')+'>'+m.l+'</option>';}).join('');
    modelSel.onchange=function(){
      vscode.postMessage({command:'saveSettings',settings:Object.assign({},state.settings||{},{copilotModel:modelSel.value})});
    };
  }
}

${tasksPanelScript}
${profilePanelScript}
${settingsPanelScript}
${mcpConfigScript}

document.getElementById('tabTasks').addEventListener('click',function(){showTab('tasks');});
document.getElementById('tabMcp').addEventListener('click',function(){showTab('mcp');});
document.getElementById('tabProfile').addEventListener('click',function(){showTab('profile');});
document.getElementById('tabSettings').addEventListener('click',function(){showTab('settings');});

window.addEventListener('message',function(e){
  var msg=e.data;
  if(msg.command==='update'){
    var pr=_pendingResume;
    state=msg;
    if(pr!==null){
      if(state.settings&&state.settings.resumeSession===pr){_pendingResume=null;}
      else{if(state.settings){state.settings.resumeSession=pr;}}
    }
    renderProviders();renderLoop();renderTasks();showTab(activeTab);
    document.getElementById('cozempicBanner').style.display=msg.cozempicInstalled===false?'':'none';
    document.getElementById('hooksStatusBadge').style.display=msg.hooksInstalled?'':'none';
    document.getElementById('openCodeHooksStatusBadge').style.display=msg.openCodeHooksInstalled?'':'none';
  } else if(msg.command==='mcpEmailTestResult' && typeof window.renderMcpEmailTestResult==='function'){
    window.renderMcpEmailTestResult(msg);
  } else if(msg.command==='opencodeModels'){
    var dl=document.getElementById('ocModelDatalist');
    if(dl){
      dl.innerHTML='<option value=""></option>'+msg.models.map(function(m){return '<option value="'+m+'"></option>';}).join('');
      var ocInp=document.getElementById('opencodeModelInput');
      if(ocInp){
        ocInp.dataset.loaded='ready';
        ocInp.value=(state.settings&&state.settings.opencodeModel)||'';
        ocInp.onchange=function(){
          vscode.postMessage({command:'saveSettings',settings:Object.assign({},state.settings||{},{opencodeModel:ocInp.value})});
        };
      }
    }
  }
});
</script>
</body>
</html>`;
}
