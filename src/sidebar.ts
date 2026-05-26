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
import { applyMcpSkills, applyAllSkills } from './protocolSections';
import { Task, parseTodo, pruneTodoToArchive } from './todo';
import { todoWriter } from './todoWriteManager';
import { getSessionId, clearSessionId, saveSessionName, getSessionName } from './sessionState';
import { mcpConfigCss, mcpConfigHtml, mcpConfigScript } from './sidebarMcpConfig';
import { sidebarCss } from './sidebarCss';
import { tasksPanelHtml, tasksPanelScript } from './sidebarTasksPanel';
import { profilePanelHtml, profilePanelScript } from './sidebarProfilePanel';
import { settingsPanelHtml, settingsPanelScript } from './sidebarSettingsPanel';
import { PROFILE_SECTIONS } from './profileBuilder';
import { PERIODIC_ACTIONS } from './periodicActions';
import { rebuildProfile } from './messageBuilder';
import { copilotNpmRoot, clearCopilotSdkCache } from './providers/copilotSdkProvider';

// ---------------------------------------------------------------------------
// TodoViewProvider — sidebar webview that shows TODO.md tasks + loop controls
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
        case 'compactSession': {
          const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (!root) break;
          const provider = this._selectedProvider;
          const sid = getSessionId(root, provider);
          if (!sid) { vscode.window.showWarningMessage('AutoDev: No active session to compact.'); break; }
          vscode.window.showInformationMessage('AutoDev: Running /compact…');
          taskLoopRunner.compact(root, provider).catch((e: unknown) => {
            vscode.window.showErrorMessage(`AutoDev: Compact failed: ${e instanceof Error ? e.message : String(e)}`);
          });
          break;
        }
        case 'archiveTodo': {
          const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (!root) break;
          const settings = loadSettings();
          const todoPath = settings.todoPath || path.join(root, 'TODO.md');
          try {
            const pruned = pruneTodoToArchive(todoPath, root);
            if (pruned > 0) {
              vscode.window.showInformationMessage(`AutoDev: Archived ${pruned} completed task(s) -> DONE.md`);
            } else {
              vscode.window.showInformationMessage('AutoDev: No completed tasks to archive.');
            }
            this._refreshTasks();
          } catch (e) {
            vscode.window.showErrorMessage(`AutoDev: Archive failed: ${e instanceof Error ? e.message : String(e)}`);
          }
          break;
        }
        case 'renameSession': {
          const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (!root) break;
          const sid = getSessionId(root, this._selectedProvider);
          if (!sid) { vscode.window.showWarningMessage('AutoDev: No active session to rename.'); break; }
          const name = String(msg.name ?? '').trim();
          saveSessionName(root, sid, name || '');
          vscode.window.showInformationMessage(name ? `AutoDev: Session renamed to "${name}".` : 'AutoDev: Session name cleared.');
          this._push();
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
          // Global Save All & Sync — full replace of user MCP entries directly
          // in <root>/.mcp.json. We no longer touch .autodev/settings.json's
          // mcpServers field (it's been retired — .mcp.json is the source).
          const entries = (msg.entries ?? {}) as Record<string, { command: string; args?: string[]; env?: Record<string, string>; enabled?: boolean }>;
          // ALL entries (including enabled:false) are written to .mcp.json so that
          // credentials are preserved when a server is disabled. syncProjectMcpServers
          // filters out enabled:false entries before propagating to other provider configs.
          const allForMcp: Record<string, { command: string; args?: string[]; env?: Record<string, string>; enabled?: boolean }> = {};
          let activeCount = 0;
          for (const [name, e] of Object.entries(entries)) {
            if (!e) continue;
            allForMcp[name] = { command: e.command, args: e.args, ...(e.env ? { env: e.env } : {}), ...(e.enabled === false ? { enabled: false } : {}) };
            if (e.enabled !== false) activeCount++;
          }
          const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (root) {
            saveProjectUserMcp(root, allForMcp);
            try {
              applyAllSkills(root);
              applyMcpSkills(root, loadSettings());
            } catch { /* ignore */ }
          }
          this._syncAndPushMcp();
          vscode.window.showInformationMessage(
            `AutoDev: \ MCP server(s) active, settings saved to .mcp.json.`
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
        case 'openAgentProfile': {
          const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (root) {
            const profilePath = path.join(root, '.autodev', 'AGENT_PROFILE.md');
            if (!fs.existsSync(profilePath)) {
              try { rebuildProfile(root); } catch { /* ignore, file may not exist yet */ }
            }
            if (fs.existsSync(profilePath)) {
              void vscode.window.showTextDocument(vscode.Uri.file(profilePath));
            } else {
              vscode.window.showWarningMessage('AutoDev: AGENT_PROFILE.md not found. Save the profile first to generate it.');
            }
          }
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
              vscode.window.showErrorMessage(`AutoDev: Profile rebuild failed — ${(err as Error).message}`);
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
          // Async probe — must not block the extension host.
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
        case 'rebuildCopilotNative': {
          const npmRoot = copilotNpmRoot();
          const term = vscode.window.createTerminal('Rebuild: Copilot native');
          term.show(true);
          term.sendText(`cd ${JSON.stringify(npmRoot)} && npm rebuild`);
          // Clear the cached SDK import so the next prompt re-loads the freshly built binary
          setTimeout(() => { clearCopilotSdkCache(); }, 30000);
          vscode.window.showInformationMessage(`AutoDev: Running npm rebuild in ${npmRoot} — check the terminal for output.`);
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
    // Re-read TODO.md from disk so the sidebar always reflects the latest file
    // state (e.g. a task the loop just marked done). _refreshTasks() calls _push().
    this._refreshTasks();
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
    if (text.trim().toLowerCase() === '/restart') {
      void vscode.commands.executeCommand('autodev.restartTaskLoop');
      return;
    }
    if (text.trim().toLowerCase() === '/clear') {
      void vscode.commands.executeCommand('autodev.clearSession');
      return;
    }
    if (text.trim().toLowerCase() === '/archive') {
      void vscode.commands.executeCommand('autodev.archiveTodo');
      return;
    }
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
      // Always project scope — also migrate away from global if it was set before
      if (areHooksInstalled('global', root)) { uninstallHooks('global', root); }
      installHooks('project', root);
    }

    // OpenCode hooks — install/uninstall plugin file.
    // Also auto-install when switching to an opencode provider while hooksEnabled is true,
    // without requiring the user to manually tick the separate checkbox.
    const wasOcEnabled = prev.openCodeHooksEnabled;
    const isOcEnabled  = next.openCodeHooksEnabled;
    const isOpenCodeProvider = next.provider === 'opencode-cli' || next.provider === 'opencode-sdk';
    if (!isOcEnabled && !isOpenCodeProvider) {
      if (wasOcEnabled || isOpenCodeHooksInstalled(root)) { uninstallOpenCodeHooks(root); }
    } else if (isOcEnabled || (isOpenCodeProvider && next.hooksEnabled)) {
      installOpenCodeHooks(root);
    }

    // OpenCode cache — apply/remove setCacheKey from opencode.json when toggled
    if (prev.opencodeCacheEnabled !== next.opencodeCacheEnabled) {
      try { ConfigManager.applyOpenCodeCacheSettings(root, next.opencodeCacheEnabled); }
      catch { /* non-fatal */ }
    }

    // OpenCode timeouts — apply to opencode.json when changed
    if (prev.opencodeTimeout !== next.opencodeTimeout || prev.opencodeChunkTimeout !== next.opencodeChunkTimeout) {
      try { ConfigManager.applyOpenCodeTimeoutSettings(root, next.opencodeTimeout ?? 0, next.opencodeChunkTimeout ?? 0); }
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
      sessionName: (root && sessionId) ? (getSessionName(root, sessionId) ?? null) : null,
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
// HTML for the sidebar webview — assembled from composable panel modules
// ---------------------------------------------------------------------------

function buildHtml(webview: vscode.Webview): string {
  const nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AutoDev</title>
<style nonce="${nonce}">${sidebarCss}${mcpConfigCss}</style>
</head>
<body>
<div id="sidebarLoader" class="sidebar-loader"></div>
<div class="provider-row">
  <span class="provider-label">Provider:</span>
  <select class="provider-select" id="providerSelect"></select>
</div>
<div class="fallback-row" id="fallbackRow">
  <input type="checkbox" id="fallbackCheck">
  <label for="fallbackCheck" style="white-space:nowrap">On limit, use:</label>
  <select class="provider-select" id="fallbackSelect"></select>
</div>
<div class="model-row" id="claudeModelRow" style="display:none">
  <span class="provider-label">Model:</span>
  <select class="model-select" id="claudeModelSelect"></select>
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
<div class="model-row" id="opencodeTimeoutRow" style="display:none">
  <span class="provider-label">Timeout (ms):</span>
  <input type="number" id="opencodeTimeoutInput" min="0" step="60000" style="flex:1;min-width:55px;max-width:90px" placeholder="300000">
  <span class="provider-label" style="margin-left:2px">Chunk (ms):</span>
  <input type="number" id="opencodeChunkTimeoutInput" min="0" step="10000" style="flex:1;min-width:55px;max-width:90px" placeholder="60000">
</div>
<div class="resume-row" id="resumeRow" style="display:none">
  <input type="checkbox" id="resumeCheck">
  <label for="resumeCheck">Resume session</label>
  <button class="new-session-btn" id="newSessionBtn" title="Clear saved session — next run starts a new session">&#8635; New</button>
</div>
<button class="periodic-toggle" id="periodicToggleBtn" style="display:none" onclick="togglePeriodic()">
  <em class="periodic-toggle-arrow" id="periodicArrow">&#9660;</em> Periodic &amp; schedule
</button>
<div id="periodicSection" style="display:none">
<div class="model-row" id="resetSessionRow" style="display:none">
  <span class="provider-label">Reset session:</span>
  <select id="resetSessionSelect" style="flex:1;min-width:0">
    <option value="0">No reset</option>
    <option value="5">Every 5 tasks</option>
    <option value="10">Every 10 tasks</option>
    <option value="20">Every 20 tasks</option>
    <option value="custom">Custom&hellip;</option>
  </select>
  <input type="number" id="resetSessionCustom" min="1" max="999" style="width:55px;display:none" placeholder="N">
</div>
<div class="model-row" id="profileEveryRow" style="display:none">
  <span class="provider-label">Re-send profile:</span>
  <select id="profileEverySelect" style="flex:1;min-width:0">
    <option value="0">First task only</option>
    <option value="5">Every 5 tasks</option>
    <option value="10">Every 10 tasks</option>
    <option value="20">Every 20 tasks</option>
    <option value="custom">Custom&hellip;</option>
  </select>
  <input type="number" id="profileEveryCustom" min="1" max="999" style="width:55px;display:none" placeholder="N">
</div>
${PERIODIC_ACTIONS.map(a => `
<div class="model-row" id="periodicRow-${a.id}" style="display:none">
  <span class="provider-label">${a.icon} ${a.label}:</span>
  <select id="periodicSel-${a.id}" style="flex:1;min-width:0">
    <option value="0">Disabled</option>
    <option value="5">Every 5 tasks</option>
    <option value="10">Every 10 tasks</option>
    <option value="20">Every 20 tasks</option>
    <option value="custom">Custom&hellip;</option>
  </select>
  <input type="number" id="periodicCustom-${a.id}" min="1" max="999" style="width:55px;display:none" placeholder="N">
</div>`).join('')}
</div>
<div class="session-id-row" id="sessionIdRow" style="display:none">
  <span class="session-id-dot"></span>
  <span style="flex-shrink:0">Session:</span>
  <span class="session-id-val" id="sessionIdVal" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>
  <button class="new-session-btn" id="compactBtn" title="Run /compact on current session to summarise history">&#x1F5DC; Compact</button>
  <button class="new-session-btn" id="archiveTodoBtn" title="Move completed [x] tasks from TODO.md to DONE.md">&#x1F4E6; Archive</button>
  <button class="new-session-btn" id="renameSessionBtn" title="Set a display name for this session">&#x270F;</button>
</div>
<div class="model-row" id="renameRow" style="display:none;gap:4px">
  <input type="text" id="renameInput" placeholder="Session name…" style="flex:1;min-width:0">
  <button class="new-session-btn" id="renameSaveBtn">Save</button>
  <button class="new-session-btn" id="renameCancelBtn">&#x2715;</button>
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

// Persistent open/closed state for the periodic section.
// Starts OPEN so settings are immediately visible; user can collapse with the header button.
var _periodicOpen = true;

function togglePeriodic(){
  _periodicOpen = !_periodicOpen;
  var section=document.getElementById('periodicSection');
  var arrow=document.getElementById('periodicArrow');
  if(section){section.style.display=_periodicOpen?'':'none';}
  if(arrow){arrow.innerHTML=_periodicOpen?'&#9660;':'&#9654;';}
}

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
    if(resetSessRow){resetSessRow.style.display=(isCli&&resumeCheck.checked)?'flex':'none';}
    vscode.postMessage({command:'saveSettings',settings:Object.assign({},state.settings||{},{resumeSession:resumeCheck.checked})});
  };
  var newSessBtn=document.getElementById('newSessionBtn');
  if(newSessBtn){newSessBtn.onclick=function(){vscode.postMessage({command:'newSession'});};}
  var resetSessRow=document.getElementById('resetSessionRow');
  var resetSel=document.getElementById('resetSessionSelect');
  var resetCustom=document.getElementById('resetSessionCustom');
  if(resetSessRow){resetSessRow.style.display=(isCli&&resumeOn)?'flex':'none';}
  if(resetSel&&resetCustom){
    var curReset=(state.settings&&state.settings.resetSessionEveryNTurns)||0;
    var knownVals=['0','5','10','20'];
    if(knownVals.indexOf(String(curReset))!==-1){resetSel.value=String(curReset);resetCustom.style.display='none';}
    else{resetSel.value='custom';resetCustom.style.display='';resetCustom.value=String(curReset);}
    resetSel.onchange=function(){
      if(resetSel.value==='custom'){resetCustom.style.display='';}
      else{resetCustom.style.display='none';var v=parseInt(resetSel.value,10)||0;vscode.postMessage({command:'saveSettings',settings:Object.assign({},state.settings||{},{resetSessionEveryNTurns:v})});}
    };
    resetCustom.onchange=function(){
      var v=parseInt(resetCustom.value,10)||0;
      vscode.postMessage({command:'saveSettings',settings:Object.assign({},state.settings||{},{resetSessionEveryNTurns:v})});
    };
  }
  var profileEveryRow=document.getElementById('profileEveryRow');
  var profileEverySel=document.getElementById('profileEverySelect');
  var profileEveryCustom=document.getElementById('profileEveryCustom');
  if(profileEveryRow){profileEveryRow.style.display=isCli?'flex':'none';}
  if(profileEverySel&&profileEveryCustom){
    var curPe=(state.settings&&state.settings.profileEveryNTasks)||0;
    var peVals=['0','5','10','20'];
    if(peVals.indexOf(String(curPe))!==-1){profileEverySel.value=String(curPe);profileEveryCustom.style.display='none';}
    else{profileEverySel.value='custom';profileEveryCustom.style.display='';profileEveryCustom.value=String(curPe);}
    profileEverySel.onchange=function(){
      if(profileEverySel.value==='custom'){profileEveryCustom.style.display='';}
      else{profileEveryCustom.style.display='none';var v=parseInt(profileEverySel.value,10)||0;vscode.postMessage({command:'saveSettings',settings:Object.assign({},state.settings||{},{profileEveryNTasks:v})});}
    };
    profileEveryCustom.onchange=function(){
      var v=parseInt(profileEveryCustom.value,10)||0;
      vscode.postMessage({command:'saveSettings',settings:Object.assign({},state.settings||{},{profileEveryNTasks:v})});
    };
  }
  var skillEveryRow=document.getElementById('skillEveryRow');
  var skillEverySel=document.getElementById('skillEverySelect');
  var skillEveryCustom=document.getElementById('skillEveryCustom');
  if(skillEveryRow){skillEveryRow.style.display=isCli?'flex':'none';}
  if(skillEverySel&&skillEveryCustom){
    var curSk=(state.settings&&state.settings.skillEveryNTasks)||0;
    var skVals=['0','5','10','20'];
    if(skVals.indexOf(String(curSk))!==-1){skillEverySel.value=String(curSk);skillEveryCustom.style.display='none';}
    else{skillEverySel.value='custom';skillEveryCustom.style.display='';skillEveryCustom.value=String(curSk);}
    skillEverySel.onchange=function(){
      if(skillEverySel.value==='custom'){skillEveryCustom.style.display='';}
      else{skillEveryCustom.style.display='none';var v=parseInt(skillEverySel.value,10)||0;vscode.postMessage({command:'saveSettings',settings:Object.assign({},state.settings||{},{skillEveryNTasks:v})});}
    };
    skillEveryCustom.onchange=function(){
      var v=parseInt(skillEveryCustom.value,10)||0;
      vscode.postMessage({command:'saveSettings',settings:Object.assign({},state.settings||{},{skillEveryNTasks:v})});
    };
  }
  // --- Periodic action rows (skill / memory / summary / ...) ---------------
  ${PERIODIC_ACTIONS.map(a => `(function(){
    var row=document.getElementById('periodicRow-${a.id}');
    var sel=document.getElementById('periodicSel-${a.id}');
    var cust=document.getElementById('periodicCustom-${a.id}');
    if(row){row.style.display=isCli?'flex':'none';}
    if(sel&&cust){
      var cur=(state.settings&&state.settings.${a.settingKey})||0;
      var preset=['0','5','10','20'];
      if(preset.indexOf(String(cur))!==-1){sel.value=String(cur);cust.style.display='none';}
      else{sel.value='custom';cust.style.display='';cust.value=String(cur);}
      sel.onchange=function(){
        if(sel.value==='custom'){cust.style.display='';}
        else{cust.style.display='none';var v=parseInt(sel.value,10)||0;vscode.postMessage({command:'saveSettings',settings:Object.assign({},state.settings||{},{${a.settingKey}:v})});}
      };
      cust.onchange=function(){
        var v=parseInt(cust.value,10)||0;
        vscode.postMessage({command:'saveSettings',settings:Object.assign({},state.settings||{},{${a.settingKey}:v})});
      };
    }
  })();`).join('\n  ')}
  // Show periodic toggle button when this provider supports CLI actions
  var periodicToggleBtn=document.getElementById('periodicToggleBtn');
  if(periodicToggleBtn){periodicToggleBtn.style.display=isCli?'':'none';}
  var periodicSection=document.getElementById('periodicSection');
  var periodicArrow=document.getElementById('periodicArrow');
  if(isCli){
    if(periodicSection){periodicSection.style.display=_periodicOpen?'':'none';}
    if(periodicArrow){periodicArrow.innerHTML=_periodicOpen?'&#9660;':'&#9654;';}
  } else {
    if(periodicSection){periodicSection.style.display='none';}
    if(periodicArrow){periodicArrow.innerHTML='&#9654;';}
  }
  var sidRow=document.getElementById('sessionIdRow');
  var sidVal=document.getElementById('sessionIdVal');
  var hasSession=isCli&&resumeOn&&state.sessionId;
  sidRow.style.display=hasSession?'flex':'none';
  if(sidVal){
    var displayName=state.sessionName||state.sessionId||'';
    sidVal.textContent=displayName;
    sidVal.title=state.sessionId||'';
  }
  var compactBtn=document.getElementById('compactBtn');
  if(compactBtn){compactBtn.onclick=function(){vscode.postMessage({command:'compactSession'});};}
  var archiveTodoBtn=document.getElementById('archiveTodoBtn');
  if(archiveTodoBtn){archiveTodoBtn.onclick=function(){vscode.postMessage({command:'archiveTodo'});};}
  var renameSessionBtn=document.getElementById('renameSessionBtn');
  var renameRow=document.getElementById('renameRow');
  var renameInput=document.getElementById('renameInput');
  var renameSaveBtn=document.getElementById('renameSaveBtn');
  var renameCancelBtn=document.getElementById('renameCancelBtn');
  if(renameSessionBtn&&renameRow){
    renameSessionBtn.onclick=function(){
      renameRow.style.display='flex';
      if(renameInput){renameInput.value=state.sessionName||'';renameInput.focus();}
    };
  }
  if(renameCancelBtn&&renameRow){renameCancelBtn.onclick=function(){renameRow.style.display='none';};}
  if(renameSaveBtn&&renameInput&&renameRow){
    renameSaveBtn.onclick=function(){
      var n=renameInput.value.trim();
      vscode.postMessage({command:'renameSession',name:n});
      renameRow.style.display='none';
    };
    renameInput.onkeydown=function(e){if(e.key==='Enter'){renameSaveBtn.click();}if(e.key==='Escape'){renameCancelBtn.click();}};
  }

  var claudeModelRow=document.getElementById('claudeModelRow');
  var claudeModelSel=document.getElementById('claudeModelSelect');
  var isClaude=state.selectedProvider==='claude-cli'||state.selectedProvider==='claude-tui';
  if(claudeModelRow) claudeModelRow.style.display=isClaude?'flex':'none';
  if(isClaude&&claudeModelSel){
    var CLAUDE_MODELS=[
      {v:'',l:'Default'},
      {v:'best',l:'Best'},
      {v:'sonnet',l:'Sonnet'},
      {v:'sonnet-1m',l:'Sonnet [1M]'},
      {v:'opus',l:'Opus'},
      {v:'opus-1m',l:'Opus [1M]'},
      {v:'haiku',l:'Haiku'},
    ];
    var curClaude=(state.settings&&state.settings.claudeModel)||'';
    claudeModelSel.innerHTML=CLAUDE_MODELS.map(function(m){return '<option value="'+m.v+'"'+(m.v===curClaude?' selected':'')+'>'+m.l+'</option>';}).join('');
    claudeModelSel.onchange=function(){
      vscode.postMessage({command:'saveSettings',settings:Object.assign({},state.settings||{},{claudeModel:claudeModelSel.value})});
    };
  }

  var modelRow=document.getElementById('modelRow');
  var modelSel=document.getElementById('modelSelect');
  var isCopilot=state.selectedProvider==='copilot-cli';
  modelRow.style.display=isCopilot?'flex':'none';

  var ocModelRow=document.getElementById('opencodeModelRow');
  var ocModelInp=document.getElementById('opencodeModelInput');
  var isOpenCode=state.selectedProvider==='opencode-cli'||state.selectedProvider==='opencode-sdk';
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

  var ocTimeoutRow=document.getElementById('opencodeTimeoutRow');
  var ocTimeoutInp=document.getElementById('opencodeTimeoutInput');
  var ocChunkInp=document.getElementById('opencodeChunkTimeoutInput');
  if(ocTimeoutRow){ocTimeoutRow.style.display=isOpenCode?'flex':'none';}
  if(isOpenCode&&ocTimeoutInp&&ocChunkInp){
    var curTimeout=(state.settings&&state.settings.opencodeTimeout)||0;
    var curChunk=(state.settings&&state.settings.opencodeChunkTimeout)||0;
    if(document.activeElement!==ocTimeoutInp){ocTimeoutInp.value=curTimeout>0?String(curTimeout):'';}
    if(document.activeElement!==ocChunkInp){ocChunkInp.value=curChunk>0?String(curChunk):'';}
    ocTimeoutInp.onchange=function(){
      var v=parseInt(ocTimeoutInp.value)||0;
      vscode.postMessage({command:'saveSettings',settings:Object.assign({},state.settings||{},{opencodeTimeout:v})});
    };
    ocChunkInp.onchange=function(){
      var v=parseInt(ocChunkInp.value)||0;
      vscode.postMessage({command:'saveSettings',settings:Object.assign({},state.settings||{},{opencodeChunkTimeout:v})});
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
    var loader=document.getElementById('sidebarLoader');if(loader){loader.style.display='none';}
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
