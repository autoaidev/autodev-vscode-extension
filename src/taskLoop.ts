import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { execSync } from 'child_process';
import { parseTodo, pickNextTask, countRemaining, Task } from './todo';
import { todoWriter } from './todoWriteManager';
import { buildPrompt } from './prompt';
import { writeMessageFile } from './messageBuilder';
import { WebhookClient, WebhookEvent, sendDiscordBotMessage } from './webhook';
import { loadSettingsForRoot, AutodevSettings } from './core/settingsLoader';
import { IFileWatcher, IDisposable } from './core/adapters';
import { getClaudeSessionCursor, parseClaudeStateSince, findLatestClaudeSession } from './dispatcher';
import { getLatestOpenCodeSessionId, runOpenCodeCompact } from './providers/opencodeCliProvider';
import { getOpenCodeSessionIdFromHooks } from './openCodeHooksManager';
import { runClaudeCompact } from './providers/claudeCliProvider';
import { runClaudeTuiCompact, getClaudeTuiLatestSessionId, isClaudeTuiBusy } from './providers/claudeTuiProvider';
import { runOpencodeSdkCompact, getOpencodeSdkLatestSessionId, isOpencodeSdkBusy, getOpencodeSdkActivity, closeOpencodeSdkClient } from './providers/opencodeSdkProvider';
import { captureAndSaveSessionId, saveSessionId, getSessionId, stdoutFilePath, exitFilePath } from './sessionState';
import { readClaudeOutputSince } from './dispatcher';
import { PROVIDERS, ProviderId } from './providers';
import { DiscordPoller } from './discordPoller';
import { DiscordGateway } from './discordGateway';
import { WebhookPoller } from './webhookPoller';
import { EmailTaskPoller } from './emailPoller';
import { loadProjectUserMcp } from './core/projectMcp';

// ---------------------------------------------------------------------------
// TaskLoopRunner — mirrors PHP Loop.php
// ---------------------------------------------------------------------------

export type LoopState = 'idle' | 'running' | 'stopping' | 'paused';

// ---------------------------------------------------------------------------
// Rate-limit + context-length errors
// ---------------------------------------------------------------------------

import { RateLimitError, RateLimitDetector } from './rateLimit';
import { CliExitHandler } from './cliExit';

class ContextLengthError extends Error {
  constructor(readonly rawMessage: string) {
    super(rawMessage);
    this.name = 'ContextLengthError';
  }
}

// ---------------------------------------------------------------------------
// RetryScheduler — single clearable timer for rate-limit resume
// ---------------------------------------------------------------------------

class RetryScheduler {
  private _timer: NodeJS.Timeout | null = null;

  schedule(ms: number, cb: () => void): void {
    this.clear();
    this._timer = setTimeout(cb, ms);
  }

  clear(): void {
    if (this._timer !== null) { clearTimeout(this._timer); this._timer = null; }
  }
}

export interface LoopCallbacks {
  /** Send a prompt to the active AI provider. messageFile is the absolute path of the written .md file for CLI providers. */
  sendToAi: (prompt: string, taskLabel: string, includeProfile?: boolean, messageFile?: string) => Promise<void>;
  /** Append a message to the extension's output channel */
  log: (msg: string) => void;
  /** Called whenever the loop state changes so the sidebar can refresh */
  onStatusChange: (state: LoopState, currentTask?: string) => void;
  /** Called when Claude's current tool activity changes (undefined = idle/done) */
  onActivityChange?: (activity: string | undefined) => void;
  /** Returns the currently selected provider ID (live, not from settings file) */
  getActiveProvider: () => ProviderId;
  /** Transiently override the active provider (e.g. fallback on rate limit). */
  setActiveProvider?: (id: ProviderId) => void;
  /** Absolute path to the workspace root directory */
  workspaceRoot: string;
  /** File watcher used to monitor TODO.md and output files */
  fileWatcher: IFileWatcher;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Read a CLI stdout file and return its content as a UTF-8 string.
 * Handles all BOM variants that PowerShell may write:
 *   \xFF\xFE → UTF-16 LE (Tee-Object default on PS5)
 *   \xEF\xBB\xBF → UTF-8 with BOM (Out-File -Encoding UTF8 on PS5)
 *   no BOM → plain UTF-8 (PS7)
 */
function readOutputFile(filePath: string): string {
  const raw = fs.readFileSync(filePath);
  if (raw.length === 0) { return ''; }
  if (raw[0] === 0xFF && raw[1] === 0xFE) {
    // UTF-16 LE
    return raw.subarray(2).toString('utf16le').trim();
  }
  if (raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF) {
    // UTF-8 BOM
    return raw.subarray(3).toString('utf8').trim();
  }
  return raw.toString('utf8').trim();
}

/** First line of task text, capped at 200 chars — safe to post to Discord. */
function discordLabel(taskText: string): string {
  const first = taskText.split('\n')[0].trim();
  return first.length > 200 ? first.slice(0, 197) + '\u2026' : first;
}

function resolveGitInfo(workDir: string): { gitRepo: string; gitBranch: string } {
  const run = (cmd: string) => {
    try { return execSync(cmd, { cwd: workDir, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
    catch { return ''; }
  };
  return {
    gitRepo:   run('git remote get-url origin'),
    gitBranch: run('git rev-parse --abbrev-ref HEAD'),
  };
}

export class TaskLoopRunner {
  private _state: LoopState = 'idle';
  private _currentTask: string | undefined;
  private _taskWatcher: IDisposable | undefined;
  private _iterations = 0;
  private _cb: LoopCallbacks | undefined;
  private _webhook: WebhookClient | null = null;
  private _settings: AutodevSettings | undefined;
  private _workspaceRoot: string | undefined;
  private _discordPoller: DiscordPoller | null = null;
  private _discordGateway: DiscordGateway | null = null;
  private _webhookPoller: WebhookPoller | null = null;
  private _emailPoller: EmailTaskPoller | null = null;
  /** True after we last told the server "all_tasks_done" — cleared on task_start.
   *  Used to re-assert idle state on WS reconnect, otherwise agent_online flips
   *  the server-side status back to 'active' even though we have no work. */
  private _idleNotified = false;
  private _pollerIntervals: NodeJS.Timeout[] = [];
  private _hooksFileOffset = 0;
  /** Recently-forwarded hook-line hashes → first-seen timestamp (ms).
   *  Used to suppress byte-identical hook events that get appended multiple
   *  times to the shared JSONL (Copilot CLI fires the same hook from every
   *  parallel session in the same workspace, all writing to one homedir
   *  file). Entries older than HOOKS_DEDUPE_WINDOW_MS are pruned each tick. */
  private _hookLineSeen = new Map<string, number>();
  private _taskCompletionAbort: (() => void) | null = null;
  private _retryScheduler = new RetryScheduler();
  private _resumeResolve: (() => void) | null = null;
  /** Resolves the idle no-task sleep early when a poller appends a new task. */
  private _idleSleepWake: (() => void) | null = null;
  private _resumeAt: Date | undefined;
  /** When fallback is active: the saved main provider and when to switch back. */
  private _mainProviderBeforeFallback: ProviderId | null = null;
  private _mainProviderResumeAt: Date | undefined;
  private _gitRepo: string = '';
  private _gitBranch: string = '';
  private _hostname: string = '';
  private _completedCount = 0;
  private _failedCount = 0;
  private _loopStartTime = 0;
  /** Task lines that have already had /compact run — prevents infinite compact loops. */
  private _compactedTaskLines = new Set<number>();
  /** Counts completed tasks since the last auto-compact run. */
  private _autoCompactCounter = 0;

  get state(): LoopState { return this._state; }
  get currentTask(): string | undefined { return this._currentTask; }
  get resumeAt(): Date | undefined { return this._resumeAt; }

  /** Resume the loop after a rate-limit pause. Clears the scheduled timer. */
  retry(): void {
    if (this._state !== 'paused') { return; }
    this._retryScheduler.clear();
    this._resumeAt = undefined;
    this._mainProviderBeforeFallback = null;
    this._mainProviderResumeAt = undefined;
    this._setState('running');
    const r = this._resumeResolve;
    this._resumeResolve = null;
    r?.();
  }

  async start(callbacks: LoopCallbacks): Promise<void> {
    if (this._state === 'running') {
      callbacks.log('Task loop already running');
      return;
    }

    this._cb = callbacks;
    this._iterations = 0;
    this._compactedTaskLines.clear();
    this._autoCompactCounter = 0;
    this._hookLineSeen.clear();
    this._setState('running');

    const settings = loadSettingsForRoot(callbacks.workspaceRoot);
    const root = callbacks.workspaceRoot;
    if (!root) {
      callbacks.log('No workspace folder open');
      this._setState('idle');
      return;
    }

    this._settings = settings;
    this._workspaceRoot = root;
    this._completedCount = 0;
    this._failedCount = 0;
    this._loopStartTime = Date.now();
    this._hostname = os.hostname();
    const git = resolveGitInfo(root);
    this._gitRepo   = git.gitRepo;
    this._gitBranch = git.gitBranch;

    this._webhook = (settings.serverBaseUrl && settings.webhookSlug)
      ? new WebhookClient(
          settings.serverBaseUrl.replace(/\/$/, '') + '/webhook/' + settings.webhookSlug,
          settings.serverApiKey,
          settings.webhookSlug,  // use slug as contextId so server can find the agent
        )
      : null;
    this._webhook?.setMeta({ provider: settings.provider, workDir: root, hostname: this._hostname, gitRepo: this._gitRepo, gitBranch: this._gitBranch });

    this._discordPoller = (settings.discordToken && settings.discordChannelId && settings.discordOwners)
      ? new DiscordPoller(settings.discordToken, settings.discordChannelId, settings.discordOwners)
      : null;

    this._discordGateway = settings.discordToken
      ? new DiscordGateway(settings.discordToken)
      : null;

    this._webhookPoller = (settings.serverBaseUrl && settings.serverApiKey && settings.webhookSlug)
      ? new WebhookPoller(settings.serverBaseUrl, settings.serverApiKey, settings.webhookSlug)
      : null;

    // Email task ingestion — pulls IMAP creds from the Email MCP entry's env
    // block. Disabled unless AUTODEV_EMAIL_RECEIVE_TASKS is "true".
    this._emailPoller = this._buildEmailPoller(settings);

    // When the poller is WebSocket-backed, route outbound events through the
    // same WS connection instead of HTTP POST (which fails for ws:// URLs).
    if (this._webhook && this._webhookPoller?.isWebSocket) {
      this._webhook.setWsSender((frame) => this._webhookPoller!.sendFrame(frame));
      // Re-send agent_online once the WS connection is actually established so
      // the server can record the VNC host/port from the live connection context.
      this._webhookPoller.setOnConnect(() => {
        this._notifyWebhook('agent_online', {
          hostname:           this._hostname,
          workDir:            this._workspaceRoot ?? '',
          gitRepo:            this._gitRepo,
          gitBranch:          this._gitBranch,
          vncEnabled:         this._settings?.vncEnabled ?? false,
          vncHost:            this._settings?.vncEnabled ? (this._settings?.vncHost || undefined) : undefined,
          vncPort:            this._settings?.vncEnabled ? (this._settings?.vncPort ?? 5900) : undefined,
          rdpEnabled:         this._settings?.rdpEnabled ?? false,
          rdpHost:            this._settings?.rdpEnabled ? (this._settings?.rdpHost || undefined) : undefined,
          rdpPort:            this._settings?.rdpEnabled ? (this._settings?.rdpPort ?? 3389) : undefined,
          fileBrowserEnabled: this._settings?.enableFileBrowser ?? false,
          gitEnabled:         this._settings?.gitEnabled ?? false,
        });
        // Re-sync working state if the WS dropped mid-task
        if (this._currentTask) {
          this._notifyWebhook('task_start', {
            iteration: this._iterations,
            task:      { text: this._currentTask },
            workDir:   this._workspaceRoot,
            gitRepo:   this._gitRepo,
            gitBranch: this._gitBranch,
          });
        }
        // Re-sync idle state if we previously drained the queue — otherwise the
        // server-side `agent_online` handler flips status back to 'active' and
        // the agent looks busy when it isn't.
        if (!this._currentTask && this._idleNotified) {
          this._notifyWebhook('all_tasks_done', {
            workDir:   this._workspaceRoot,
            gitRepo:   this._gitRepo,
            gitBranch: this._gitBranch,
          });
        }
      });
    }

    // Pass VNC password so the poller can authenticate incoming vnc_session requests.
    if (this._webhookPoller && settings.vncEnabled && settings.vncPassword) {
      this._webhookPoller.setVncPassword(settings.vncPassword);
    }
    if (this._webhookPoller) {
      this._webhookPoller.setGitEnabled(settings.gitEnabled ?? false);
      // Wake the idle no-task sleep instantly when a WS-pushed task arrives.
      this._webhookPoller.setOnTaskAppend(() => this._wakeIdleSleep());
    }
    if (this._webhookPoller && settings.rdpEnabled) {
      this._webhookPoller.setRdpSettings({
        host:       settings.rdpHost       || undefined,
        port:       settings.rdpPort       ?? 3389,
        username:   settings.rdpUsername   || undefined,
        password:   settings.rdpPassword   || undefined,
        domain:     settings.rdpDomain     || undefined,
        guacWsUrl:  settings.rdpGuacWsUrl  || undefined,
      });
    }

    const todoPath = settings.todoPath || path.join(root, 'TODO.md');

    // Seed Discord cursor to ignore history before the loop started
    if (this._discordPoller) {
      await this._discordPoller.initialize();
    }

    if (this._emailPoller) {
      try {
        await this._emailPoller.initialize();
        callbacks.log('📧 Email task poller started — checking inbox every 10s');
      }
      catch (e) { callbacks.log(`Email poller init failed: ${e instanceof Error ? e.message : String(e)}`); }
    } else {
      const root = this._workspaceRoot;
      const userMcp = root ? loadProjectUserMcp(root) : {};
      const entry = userMcp['zerolib-email'];
      const env = entry?.env ?? {};
      const reasons: string[] = [];
      if (!entry) reasons.push('no zerolib-email entry in .mcp.json');
      else {
        if (String(env.AUTODEV_EMAIL_RECEIVE_TASKS).toLowerCase() !== 'true') reasons.push('AUTODEV_EMAIL_RECEIVE_TASKS != "true"');
        if (!env.MCP_EMAIL_SERVER_IMAP_HOST) reasons.push('IMAP host missing');
        if (!(env.MCP_EMAIL_SERVER_USER_NAME || env.MCP_EMAIL_SERVER_EMAIL_ADDRESS)) reasons.push('IMAP user/email missing');
        if (!env.MCP_EMAIL_SERVER_PASSWORD) reasons.push('IMAP password missing');
      }
      if (reasons.length) callbacks.log(`📧 Email task poller NOT started: ${reasons.join('; ')}`);
    }

    // Connect to Discord Gateway so the bot appears online
    this._discordGateway?.connect();

    // Start WebSocket connection (no-op for HTTP pollers)
    if (this._webhookPoller) {
      this._webhookPoller.start(todoPath, (msg) => callbacks.log(msg), root);
    }

    // Start independent background polling loops — run even while AI is processing a task
    this._startPollers(todoPath);

    callbacks.log(`Task loop starting — TODO: ${todoPath}`);
    this._notifyWebhook('loop_start', {
      provider:  settings.provider,
      workDir:   root,
      gitRepo:   this._gitRepo,
      gitBranch: this._gitBranch,
    });
    this._notifyWebhook('agent_online', {
      hostname:           this._hostname,
      workDir:            root,
      gitRepo:            this._gitRepo,
      gitBranch:          this._gitBranch,
      vncEnabled:         settings.vncEnabled ?? false,
      vncHost:            settings.vncEnabled ? (settings.vncHost || undefined) : undefined,
      vncPort:            settings.vncEnabled ? (settings.vncPort ?? 5900) : undefined,
      rdpEnabled:         settings.rdpEnabled ?? false,
      rdpHost:            settings.rdpEnabled ? (settings.rdpHost || undefined) : undefined,
      rdpPort:            settings.rdpEnabled ? (settings.rdpPort ?? 3389) : undefined,
      fileBrowserEnabled: settings.enableFileBrowser ?? false,
      gitEnabled:         settings.gitEnabled ?? false,
    });
    this._notifyDiscord('🚀 AutoDev task loop started');

    // Auto-run `cozempic init` for Claude CLI projects so the guard daemon and
    // pruning hooks are wired automatically — the user only needs cozempic on
    // their PATH; no per-project manual step required.
    if (settings.provider === 'claude-cli') {
      this._runCozempicInit(root, callbacks.log.bind(callbacks));
    }

    try {
      await this._runLoop(todoPath, settings);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      callbacks.log(`Task loop error: ${msg}`);
    }

    const elapsed = Math.round((Date.now() - this._loopStartTime) / 1000);
    this._notifyWebhook('loop_complete', {
      total:     this._completedCount + this._failedCount,
      success:   this._completedCount,
      failed:    this._failedCount,
      elapsed,
      workDir:   root,
      gitRepo:   this._gitRepo,
      gitBranch: this._gitBranch,
    });
    this._notifyWebhook('agent_offline', {
      total:     this._completedCount + this._failedCount,
      success:   this._completedCount,
      failed:    this._failedCount,
      elapsed,
      workDir:   root,
      gitRepo:   this._gitRepo,
      gitBranch: this._gitBranch,
    });
    this._notifyDiscord('👋 AutoDev loop ended');
    this._stopPollers();
    this._currentTask = undefined;
    this._webhook = null;
    this._discordPoller = null;
    this._discordGateway?.destroy();
    this._discordGateway = null;
    this._webhookPoller = null;
    if (this._emailPoller) { void this._emailPoller.dispose(); this._emailPoller = null; }
    this._setState('idle');
    callbacks.log('Task loop stopped');
  }

  stop(): void {
    if (this._state !== 'running' && this._state !== 'paused') { return; }
    this._setState('stopping');
    this._retryScheduler.clear();
    this._resumeAt = undefined;
    this._mainProviderBeforeFallback = null;
    this._mainProviderResumeAt = undefined;
    // Unblock _pause() if we're currently suspended
    const r = this._resumeResolve;
    this._resumeResolve = null;
    r?.();
    // Unblock the idle no-task sleep immediately
    const w = this._idleSleepWake;
    this._idleSleepWake = null;
    w?.();
    this._disposeWatcher();
    this._stopPollers();
    // Abort any in-progress task wait immediately
    this._taskCompletionAbort?.();
    this._taskCompletionAbort = null;
    // Send discord goodbye right now (don't wait for cleanup path)
    this._notifyDiscord('⛔ AutoDev loop stopped');
    this._cb?.log('Task loop stop requested…');
  }

  // -------------------------------------------------------------------------

  /**
   * Build an EmailTaskPoller from the Email MCP entry's env block, or return
   * null if the feature is disabled or required IMAP creds are missing.
   */
  private _buildEmailPoller(settings: AutodevSettings): EmailTaskPoller | null {
    const root = this._workspaceRoot;
    const userMcp = root ? loadProjectUserMcp(root) : {};
    const entry = userMcp['zerolib-email'];
    const env = entry?.env ?? {};
    if (!entry) return null;
    if (String(env.AUTODEV_EMAIL_RECEIVE_TASKS).toLowerCase() !== 'true') return null;
    const host = env.MCP_EMAIL_SERVER_IMAP_HOST;
    const user = env.MCP_EMAIL_SERVER_USER_NAME || env.MCP_EMAIL_SERVER_EMAIL_ADDRESS;
    const pass = env.MCP_EMAIL_SERVER_PASSWORD;
    if (!host || !user || !pass) return null;
    const port = parseInt(env.MCP_EMAIL_SERVER_IMAP_PORT || '993', 10) || 993;
    const secure = String(env.MCP_EMAIL_SERVER_IMAP_SSL ?? 'true').toLowerCase() !== 'false';
    const verify = String(env.MCP_EMAIL_SERVER_IMAP_VERIFY_SSL ?? 'true').toLowerCase() !== 'false';
    const allowed = (env.AUTODEV_EMAIL_ALLOWED_SENDERS || '')
      .split(',').map(s => s.trim()).filter(Boolean);
    return new EmailTaskPoller({ host, port, secure, user, pass, allowedSenders: allowed, rejectUnauthorized: verify });
  }

  /**
   * Start Discord and webhook server pollers as independent setInterval loops.
   * They run continuously in the background — even while the AI is processing a task.
   */
  private _startPollers(todoPath: string): void {
    const POLL_MS = 3_000;

    if (this._discordPoller) {
      const discordInterval = setInterval(async () => {
        if (this._state !== 'running') { return; }
        try {
          const appended = await this._discordPoller!.pollAndAppend(todoPath, this._workspaceRoot ?? undefined);
          if (appended) { this._wakeIdleSleep(); }
        } catch { }
      }, POLL_MS);
      this._pollerIntervals.push(discordInterval);
    }

    if (this._webhookPoller) {
      const webhookInterval = setInterval(async () => {
        if (this._state !== 'running') { return; }
        try {
          const appended = await this._webhookPoller!.pollAndAppend(todoPath, this._workspaceRoot ?? undefined);
          if (appended) { this._wakeIdleSleep(); }
        } catch { }
      }, POLL_MS);
      this._pollerIntervals.push(webhookInterval);
    }

    if (this._emailPoller) {
      // IMAP servers throttle aggressive polling — every 10s is plenty.
      const emailInterval = setInterval(async () => {
        if (this._state !== 'running') { return; }
        try {
          const appended = await this._emailPoller!.pollAndAppend(todoPath, this._workspaceRoot ?? undefined);
          if (appended) { this._wakeIdleSleep(); }
        } catch { }
      }, 10_000);
      this._pollerIntervals.push(emailInterval);
    }

    // Poll <workspace>/.autodev/hooks-events.jsonl every 10s and forward new
    // lines via WS. Per-workspace, NOT homedir: two VS Code instances on the
    // same machine would otherwise both poll one shared file and each ship
    // every line under their own slug — making hooks from `tester-1` show
    // up as `A1` (and vice-versa) in pixel-office.
    if (this._webhookPoller?.isWebSocket && this._workspaceRoot) {
      const hooksJsonl = path.join(this._workspaceRoot, '.autodev', 'hooks-events.jsonl');

      // Start at current file size so we don't replay old events on loop restart
      try {
        this._hooksFileOffset = fs.existsSync(hooksJsonl)
          ? fs.statSync(hooksJsonl).size
          : 0;
      } catch { this._hooksFileOffset = 0; }

      // Dedupe window: any hook line byte-identical to one forwarded within
      // this many ms is dropped. Even with per-workspace sinks, parallel
      // copilot/claude processes inside the same workspace can write the
      // same payload several times in one second.
      const HOOKS_DEDUPE_WINDOW_MS = 30_000;

      const hooksInterval = setInterval(() => {
        if (this._state !== 'running') { return; }
        try {
          if (!fs.existsSync(hooksJsonl)) { return; }
          const size = fs.statSync(hooksJsonl).size;
          if (size <= this._hooksFileOffset) { return; }
          const fd = fs.openSync(hooksJsonl, 'r');
          const buf = Buffer.alloc(size - this._hooksFileOffset);
          fs.readSync(fd, buf, 0, buf.length, this._hooksFileOffset);
          fs.closeSync(fd);
          this._hooksFileOffset = size;
          const sessionName = this._workspaceRoot ? path.basename(this._workspaceRoot) : undefined;
          const lines = buf.toString('utf8').split('\n').filter(l => l.trim());
          // Prune dedupe map of stale entries before this tick's run
          const now = Date.now();
          for (const [hash, ts] of this._hookLineSeen) {
            if (now - ts > HOOKS_DEDUPE_WINDOW_MS) { this._hookLineSeen.delete(hash); }
          }
          for (const line of lines) {
            const hash = crypto.createHash('sha1').update(line).digest('hex');
            const seenAt = this._hookLineSeen.get(hash);
            if (seenAt !== undefined && now - seenAt <= HOOKS_DEDUPE_WINDOW_MS) {
              // Byte-identical hook within the window — drop silently. Distinct
              // tool invocations have at least one differing byte (timestamp,
              // tool input args, runId) and survive this check.
              continue;
            }
            this._hookLineSeen.set(hash, now);
            try {
              const ev = JSON.parse(line);
              // Inject session name (workspace folder) so pixel office can display it
              if (sessionName) { ev._session_name = sessionName; }
              this._webhookPoller!.sendFrame({ type: 'hook_event', data: ev });
            } catch { /* skip malformed lines */ }
          }
        } catch { /* ignore read errors */ }
      }, 10_000);
      this._pollerIntervals.push(hooksInterval);
    }
  }

  /**
   * Run `cozempic init` in the given project directory if:
   *  1. `cozempic` is on the PATH (or login-shell PATH on Unix)
   *  2. The project hasn't been initialised yet
   *     (`.claude/settings.local.json` does not contain a cozempic hook entry)
   *
   * Runs synchronously in a background thread-pool task (spawnSync) so it
   * doesn't block the VS Code event loop but still logs completion.
   */
  private _runCozempicInit(workspaceRoot: string, log: (msg: string) => void): void {
    try {
      // Detect whether cozempic hooks are already wired for this project.
      // `cozempic init` writes its hooks into .claude/settings.local.json.
      const localSettingsPath = path.join(workspaceRoot, '.claude', 'settings.local.json');
      if (fs.existsSync(localSettingsPath)) {
        const content = fs.readFileSync(localSettingsPath, 'utf8');
        if (content.includes('cozempic')) {
          // Already initialised — skip silently.
          return;
        }
      }

      // Resolve cozempic binary (VS Code's process.env.PATH may not include
      // ~/.local/bin where pipx/pip installs it, so try a login shell on Unix).
      const isWin = process.platform === 'win32';
      // Disable telemetry and auto-update pings for all cozempic invocations.
      const cozempicEnv = { ...process.env, COZEMPIC_NO_TELEMETRY: '1', COZEMPIC_NO_AUTO_UPDATE: '1' };
      let cozempicAvailable = false;
      try {
        if (isWin) {
          execSync('cozempic --version', { stdio: 'pipe', cwd: workspaceRoot, env: cozempicEnv });
        } else {
          const shell = process.env.SHELL || 'bash';
          execSync(`${shell} -lc "cozempic --version"`, { stdio: 'pipe', cwd: workspaceRoot, env: cozempicEnv });
        }
        cozempicAvailable = true;
      } catch { /* not installed — skip */ }

      if (!cozempicAvailable) { return; }

      log('🧹 Running cozempic init for this project…');
      if (isWin) {
        execSync('cozempic init', { stdio: 'pipe', cwd: workspaceRoot, env: cozempicEnv });
      } else {
        const shell = process.env.SHELL || 'bash';
        execSync(`${shell} -lc "cozempic init"`, { stdio: 'pipe', cwd: workspaceRoot, env: cozempicEnv });
      }
      log('🧹 cozempic init complete — guard daemon and pruning hooks wired');
    } catch (err) {
      // Non-fatal — cozempic is optional.
      const msg = err instanceof Error ? err.message : String(err);
      log(`⚠️ cozempic init failed (non-fatal): ${msg}`);
    }
  }

  private _stopPollers(): void {
    for (const id of this._pollerIntervals) { clearInterval(id); }
    this._pollerIntervals = [];
    // Tear down any persistent WebSocket connection
    if (this._webhookPoller) { this._webhookPoller.destroy(); }
  }

  private async _runLoop(todoPath: string, settings: AutodevSettings): Promise<void> {
    let allTasksDoneNotified = false;

    // Reset any [~] in-progress tasks left over from a previous run
    if (settings.autoResetPendingTasks) {
      await todoWriter.resetAllInProgress(todoPath);
      this._cb?.log('Auto-reset in-progress tasks to [ ]');
    }

    while (this._state === 'running') {
      // --- Restore main provider after fallback period ends ---
      if (this._mainProviderBeforeFallback && this._mainProviderResumeAt &&
          Date.now() >= this._mainProviderResumeAt.getTime()) {
        const main = this._mainProviderBeforeFallback;
        this._mainProviderBeforeFallback = null;
        this._mainProviderResumeAt = undefined;
        this._resumeAt = undefined;
        this._cb?.log(`↩ Rate limit period ended — switching back to ${main}`);
        this._notifyDiscord(`↩ Rate limit period ended — switching back to **${main}**`);
        this._cb?.setActiveProvider?.(main);
      }

      const tasks = parseTodo(todoPath);
      let task = pickNextTask(tasks); // first [ ] task

      // Helper: is the CLI process still running? (exit file absent or empty)
      // On the very first dispatch (_iterations === 0) no process has been launched yet,
      // so always return false regardless of file state.
      const provider = this._cb?.getActiveProvider();
      const cliIsRunning = (() => {
        if (this._iterations === 0) { return false; } // nothing launched yet
        if (!this._workspaceRoot || !provider || !PROVIDERS[provider]?.isCli) { return false; }
        // claude-tui: the exit file is per-message and gets a sentinel when the
        // turn takes >30 s to finish.  Instead, use the in-flight turn flag which
        // stays true for the entire duration of the async, including after
        // _waitForTaskCompletion resolves but before the turn emits 'result'.
        if (provider === 'claude-tui') {
          return isClaudeTuiBusy(this._workspaceRoot);
        }
        if (provider === 'opencode-sdk') {
          return isOpencodeSdkBusy(this._workspaceRoot);
        }
        try {
          const content = fs.readFileSync(exitFilePath(this._workspaceRoot, provider), 'utf8').trim();
          return content === ''; // empty = process still running (exit code not yet written)
        } catch { return true; } // file absent = still running
      })();

      // If no [ ] task but CLI is still running and there's a [~] task in flight,
      // treat that [~] task as the current one and wait — don't interrupt the process.
      let watchingInProgress = false;
      if (!task && cliIsRunning) {
        const inProgress = tasks.find(t => t.status === 'in-progress');
        if (inProgress) {
          task = inProgress;
          watchingInProgress = true;
          this._cb?.log(`⏳ CLI running, watching in-progress: ${discordLabel(task.text)}`);
        }
      }

      if (!task) {
        const remaining = countRemaining(tasks);
        if (remaining === 0) {
          if (!allTasksDoneNotified) {
            allTasksDoneNotified = true;
            this._idleNotified = true;
            this._cb?.log('All tasks completed ✓ — polling for new tasks…');
            this._notifyWebhook('all_tasks_done', {
              workDir:   this._workspaceRoot,
              gitRepo:   this._gitRepo,
              gitBranch: this._gitBranch,
            });
            this._notifyDiscord('✅ All tasks done — waiting for more…');
          }
        } else {
          // There are uncompleted tasks but none are pending (e.g. all [~] in-progress).
          // If the CLI isn't running, those [~] tasks are stranded — the AI
          // marked them in-progress but never came back to finish them. Reset
          // them to [ ] so the next iteration picks them up instead of idling
          // forever.
          if (!cliIsRunning) {
            const stranded = tasks.filter(t => t.status === 'in-progress');
            for (const t of stranded) {
              await todoWriter.resetToTodo(todoPath, t).catch(() => {});
            }
            if (stranded.length > 0) {
              this._cb?.log(`↩︎ Reset ${stranded.length} stranded [~] task(s) back to [ ] — CLI not running`);
              continue; // re-pick immediately
            }
          }
          this._cb?.log(`No pending tasks — waiting ${settings.loopInterval}s…`);
        }
        // Clear any stale current-task label and refresh the sidebar so the
        // counter reflects the just-finalised TODO.md (otherwise it can sit on
        // the pre-final-cycle "N left" until something else triggers a push).
        this._currentTask = undefined;
        this._setState('running');
        // Keep polling forever — never stop automatically.
        // _sleepOrWake() resolves early if a poller appends a task mid-sleep.
        await this._sleepOrWake(settings.loopInterval * 1000);
        continue;
      }

      // A task is available — reset the all-done flag
      allTasksDoneNotified = false;

      if (!watchingInProgress) {
        this._iterations++;
      }
      this._currentTask = task.text;
      this._setState('running', task.text);

      // Build prompt (needed even when not sending, for messageFile path)
      const { prompt, messageFile } = buildPrompt(task, this._workspaceRoot!, path.dirname(todoPath), this._iterations === 1);
      const remaining = countRemaining(parseTodo(todoPath));

      if (!watchingInProgress) {
        this._cb?.log(`▶ Task [${this._iterations}]: ${task.text}`);
        this._idleNotified = false;
        this._notifyWebhook('task_start', {
          iteration: this._iterations,
          task:      { text: task.text },
          remaining,
          workDir:   this._workspaceRoot,
          gitRepo:   this._gitRepo,
          gitBranch: this._gitBranch,
        });
        this._notifyDiscord(`▶️ **Task started** (${remaining} remaining):\n${discordLabel(task.text)}`);
      }

      const taskStartTime = Date.now();
      // Snapshot the JSONL cursor before sending — we only read bytes written after this
      const claudeCursor = getClaudeSessionCursor(this._workspaceRoot!);

      try {
        if (cliIsRunning || watchingInProgress) {
          this._cb?.log(`⏳ CLI still running — skipping send, waiting for task completion…`);
        } else {
          // Send to AI — resolves as soon as the prompt is pasted, not when Claude finishes
          await this._cb!.sendToAi(prompt, task.text, this._iterations === 1, messageFile);
        }

        // Wait for the AI to mark the task [x] done in TODO.md
        await this._waitForTaskCompletion(todoPath, task, claudeCursor);

        // Wait for the CLI process to fully exit before reading its stdout.
        // The exit-code file is written only after the shell command completes,
        // so a non-empty file guarantees the stdout file is fully flushed.
        const activeProvider = this._cb?.getActiveProvider();
        if (this._workspaceRoot && activeProvider === 'claude-tui') {
          // claude-tui: _waitForTaskCompletion resolves as soon as the task is
          // marked [x] in TODO.md, but the persistent async turn may still be
          // running (Claude executing further tool calls, marking other tasks [~],
          // etc.).  Wait for the busy flag to clear — written at the very end of
          // the fire-and-forget async after 'result' fires — so we don't
          // prematurely proceed while the client is still mid-turn.
          const tuiDeadline = Date.now() + 10 * 60_000; // 10-minute safety cap
          while (isClaudeTuiBusy(this._workspaceRoot) && Date.now() < tuiDeadline) {
            if (this._state !== 'running') { break; }
            await this._sleepAbortable(500);
          }
          if (isClaudeTuiBusy(this._workspaceRoot)) {
            this._cb?.log('⚠ Claude TUI turn did not complete within 10 minutes — moving on');
          }
        } else if (this._workspaceRoot && activeProvider === 'opencode-sdk') {
          // opencode-sdk: same pattern as claude-tui — wait for the in-flight
          // fire-and-forget async to fully complete (session.idle received).
          const sdkDeadline = Date.now() + 30 * 60_000; // 30-minute safety cap
          let lastActivity: string | undefined;
          while (isOpencodeSdkBusy(this._workspaceRoot) && Date.now() < sdkDeadline) {
            if (this._state !== 'running') { break; }
            // Forward tool activity changes to the sidebar.
            const act = getOpencodeSdkActivity(this._workspaceRoot);
            if (act !== lastActivity) {
              lastActivity = act;
              this._cb?.onActivityChange?.(act);
            }
            await this._sleepAbortable(500);
          }
          if (lastActivity !== undefined) { this._cb?.onActivityChange?.(undefined); }
          if (isOpencodeSdkBusy(this._workspaceRoot)) {
            this._cb?.log('⚠ OpenCode SDK turn did not complete within 30 minutes — moving on');
          }
        } else if (this._workspaceRoot && activeProvider && PROVIDERS[activeProvider]?.isCli) {
          const exitFile = exitFilePath(this._workspaceRoot, activeProvider);
          // Do NOT clear the file here. Each dispatch allocates a fresh
          // per-message exit file via newMessageOutput(), so the value we see
          // is the one the CLI just wrote. Clearing it would leave it empty
          // forever (no CLI is running to re-write it) and the NEXT iteration's
          // cliIsRunning probe would then incorrectly conclude "CLI still
          // running" — pinning the loop on a task that was never dispatched.
          const isReady = (): boolean => {
            try { return fs.readFileSync(exitFile, 'utf8').trim().length > 0; }
            catch { return false; }
          };
          if (!isReady()) {
            // Poll up to 30 s for the exit file to become non-empty
            const deadline = Date.now() + 30_000;
            while (Date.now() < deadline) {
              await this._sleepAbortable(500);
              if (this._state !== 'running') { break; }
              if (isReady()) { break; }
            }
            // If still empty after the wait, write a sentinel so the next
            // iteration's cliIsRunning probe doesn't read an empty file and
            // wrongly conclude "CLI still running". The shell may have failed
            // to run the trailing `echo $? > exitFile` (terminal killed,
            // bundle aborted, etc.) — but the task is done and we're moving on.
            if (!isReady()) {
              try { fs.writeFileSync(exitFile, 'unknown\n', 'utf8'); } catch { /* ignore */ }
              this._cb?.log('⚠ CLI exit file never written — wrote sentinel to unblock next cycle');
            }
          }
        } else {
          // Non-CLI providers: just wait for OS flush
          await this._sleepAbortable(2_000);
        }

        // Capture and persist CLI session ID so the next task can resume it
        if (this._workspaceRoot && activeProvider && PROVIDERS[activeProvider]?.isCli) {
          if (activeProvider === 'opencode-cli') {
            // Prefer the session ID from hooks events (fast, no subprocess);
            // fall back to `opencode session list` if hooks haven't fired yet.
            const hooksSid = getOpenCodeSessionIdFromHooks(this._workspaceRoot);
            if (hooksSid) {
              saveSessionId(this._workspaceRoot, 'opencode-cli', hooksSid);
              this._cb?.log(`OpenCode session ID from hooks: ${hooksSid}`);
            } else {
              getLatestOpenCodeSessionId(this._workspaceRoot, msg => this._cb?.log(msg))
                .then(id => { if (id && this._workspaceRoot) { saveSessionId(this._workspaceRoot, 'opencode-cli', id); } })
                .catch(() => {});
            }
          } else if (activeProvider === 'claude-tui') {
            const sid = getClaudeTuiLatestSessionId(this._workspaceRoot);
            if (sid) { saveSessionId(this._workspaceRoot, 'claude-tui', sid); }
          } else if (activeProvider === 'opencode-sdk') {
            const sid = getOpencodeSdkLatestSessionId(this._workspaceRoot);
            if (sid) { saveSessionId(this._workspaceRoot, 'opencode-sdk', sid); }
          } else {
            const jsonlFallback = activeProvider === 'claude-cli'
              ? findLatestClaudeSession(this._workspaceRoot)
              : undefined;
            captureAndSaveSessionId(this._workspaceRoot, activeProvider, jsonlFallback);
          }
          this._cb?.log(`Session ID captured for ${activeProvider}`);
        }

        const duration = Math.round((Date.now() - taskStartTime) / 1000);
        this._completedCount++;
        this._autoCompactCounter++;
        this._compactedTaskLines.delete(task.line); // allow compact again if task re-appears
        const afterTasks = parseTodo(todoPath);
        const afterRemaining = countRemaining(afterTasks);
        const totalKnown = this._iterations + afterRemaining;

        // Read the AI's output — prefer clean JSONL assistant text (no tool noise),
        // fall back to the tail of the raw stdout file.
        let taskOutput = '';
        if (this._workspaceRoot && activeProvider === 'claude-cli') {
          // Primary: clean assistant-only text extracted from the JSONL session file.
          // This gives just the final summary paragraphs without tool call noise or ANSI codes.
          taskOutput = readClaudeOutputSince(this._workspaceRoot, claudeCursor);
        }
        if (!taskOutput && this._workspaceRoot && activeProvider && PROVIDERS[activeProvider]?.isCli) {
          // Fallback: raw stdout file — take only the last 4 KB to avoid huge payloads.
          const outFile = stdoutFilePath(this._workspaceRoot, activeProvider);
          try {
            if (fs.existsSync(outFile)) {
              const raw = readOutputFile(outFile);
              // Strip ANSI escape codes and take the tail (the meaningful summary is at the end)
              const clean = raw.replace(/\x1B\[[0-9;]*[mGKHF]/g, '').replace(/\r/g, '');
              taskOutput = clean.length > 4000 ? '…' + clean.slice(-4000) : clean;
            }
          } catch { /* ignore */ }
        }

        this._cb?.log(`\u2705 Task done: ${task.text}`);
        this._notifyWebhook('task_done', {
          iteration: this._iterations,
          task:      { text: task.text },
          output:    taskOutput || undefined,
          duration,
          workDir:   this._workspaceRoot,
          gitRepo:   this._gitRepo,
          gitBranch: this._gitBranch,
        });
        const discordOutput = taskOutput
          ? `\n\`\`\`\n${taskOutput.slice(0, 1800)}\n\`\`\``
          : '';
        this._notifyDiscord(`\u2705 **Task done** (${afterRemaining} remaining):\n${discordLabel(task.text)}${discordOutput}`);
        if (afterRemaining > 0) {
          this._notifyDiscord(`\ud83d\udcca Progress: ${this._iterations}/${totalKnown}`);
          this._notifyWebhook('task_progress', {
            iteration: this._iterations,
            total:     totalKnown,
            remaining: afterRemaining,
            workDir:   this._workspaceRoot,
            gitRepo:   this._gitRepo,
            gitBranch: this._gitBranch,
          });
        }

        // --- Auto-compact: run /compact every N completed tasks -----------
        const compactInterval = settings.autoCompactInterval ?? 5;
        if (settings.autoCompact && this._autoCompactCounter >= compactInterval) {
          this._autoCompactCounter = 0;
          const acProvider = this._cb?.getActiveProvider() ?? '';
          this._cb?.log(`🗜 Auto-compact triggered after ${compactInterval} tasks (provider: ${acProvider})`);
          this._notifyDiscord(`🗜 Auto-compact triggered after ${compactInterval} tasks`);
          try {
            if (acProvider === 'claude-cli') {
              let sid = getSessionId(this._workspaceRoot!, 'claude-cli');
              if (!sid) { sid = findLatestClaudeSession(this._workspaceRoot!); }
              if (sid) {
                await runClaudeCompact(sid, this._workspaceRoot!, msg => this._cb?.log(msg));
                this._cb?.log('🗜 Auto-compact complete');
              } else {
                this._cb?.log('⚠️ Auto-compact: no Claude session ID found — skipping');
              }
            } else if (acProvider === 'claude-tui') {
              let sid = getSessionId(this._workspaceRoot!, 'claude-tui');
              if (!sid) { sid = getClaudeTuiLatestSessionId(this._workspaceRoot!); }
              if (sid) {
                await runClaudeTuiCompact(this._workspaceRoot!, sid, msg => this._cb?.log(msg));
                this._cb?.log('🗜 Auto-compact complete');
              } else {
                this._cb?.log('⚠️ Auto-compact: no Claude TUI session ID found — skipping');
              }
            } else if (acProvider === 'opencode-cli') {
              let sid = getSessionId(this._workspaceRoot!, 'opencode-cli');
              if (!sid) { sid = await getLatestOpenCodeSessionId(this._workspaceRoot!, msg => this._cb?.log(msg)); }
              if (sid) {
                await runOpenCodeCompact(sid, this._workspaceRoot!, msg => this._cb?.log(msg));
                this._cb?.log('🗜 Auto-compact complete');
              } else {
                this._cb?.log('⚠️ Auto-compact: no OpenCode session ID found — skipping');
              }
            } else if (acProvider === 'opencode-sdk') {
              await runOpencodeSdkCompact(this._workspaceRoot!, msg => this._cb?.log(msg));
              this._cb?.log('🗜 Auto-compact complete (opencode-sdk)');
            }
          } catch (compactErr) {
            const cm = compactErr instanceof Error ? compactErr.message : String(compactErr);
            this._cb?.log(`⚠️ Auto-compact failed (non-fatal): ${cm}`);
          }
        }
      } catch (err) {
        // --- Rate limit: pause loop, schedule auto-resume -----------------
        if (err instanceof RateLimitError) {
          // Two flavours:
          //   1. Daily usage limit — message includes "resets 9pm (Europe/Sofia)"
          //      → resume 15 min after the parsed reset time.
          //   2. Transient server throttle — "API Error: Server is temporarily
          //      limiting requests (not your usage limit) · Rate limited"
          //      → no reset time given, retry in 5 minutes by default.
          const DEFAULT_RETRY_MS = 5 * 60_000;
          const resetAt   = err.resetAt;
          const resumeMs  = resetAt ? (resetAt.getTime() - Date.now() + 15 * 60_000) : DEFAULT_RETRY_MS;
          const resumeAt  = resetAt ?? new Date(Date.now() + DEFAULT_RETRY_MS);
          const resumeStr = resumeAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const suffix    = resetAt ? '+15 min' : 'retry in 5m (no reset time given)';
          const rawMsg    = err.rawMessage;
          const currentProvider = this._cb?.getActiveProvider() ?? 'unknown';

          // Fresh settings — check fallback config (user may have changed it after loop start)
          const freshSettings = this._workspaceRoot ? loadSettingsForRoot(this._workspaceRoot) : this._settings;
          const fallbackEnabled  = freshSettings?.fallbackProviderEnabled ?? false;
          const fallbackId       = (freshSettings?.fallbackProvider ?? '') as ProviderId;

          // Use fallback if: enabled, different from current provider, and not already on fallback
          if (fallbackEnabled && fallbackId && fallbackId !== currentProvider && !this._mainProviderBeforeFallback) {
            this._mainProviderBeforeFallback = currentProvider as ProviderId;
            this._mainProviderResumeAt = resumeAt;
            this._resumeAt = resumeAt;
            this._cb?.log(`⏩ Rate limit on ${currentProvider} — switching to ${fallbackId} until ${resumeStr} (${suffix})`);
            this._notifyDiscord(`⏩ **Rate limit on ${currentProvider}** — switching to **${fallbackId}** until ${resumeStr} (${suffix})\n\`\`\`\n${rawMsg}\n\`\`\``);
            this._notifyWebhook('rate_limit', {
              iteration:       this._iterations,
              task:            { text: task.text },
              message:         rawMsg,
              resumeAt:        resumeAt.toISOString(),
              provider:        currentProvider,
              fallbackProvider: fallbackId,
              workDir:         this._workspaceRoot,
              gitRepo:         this._gitRepo,
              gitBranch:       this._gitBranch,
            });
            // Reset task so the fallback picks it up from scratch
            await todoWriter.resetToTodo(todoPath, task).catch(() => {});
            this._cb?.setActiveProvider?.(fallbackId);
            continue; // continue loop immediately with fallback provider
          }

          // No usable fallback — standard pause
          this._cb?.log(`⏸ Rate limit hit — ${rawMsg}. Auto-resume at ${resumeStr} (${suffix})`);
          this._notifyDiscord(`⏸ **Rate limit hit** — resuming at ${resumeStr} (${suffix})\n\`\`\`\n${rawMsg}\n\`\`\``);
          this._notifyWebhook('rate_limit', {
            iteration:   this._iterations,
            task:        { text: task.text },
            message:     rawMsg,
            resumeAt:    resumeAt.toISOString(),
            provider:    currentProvider,
            workDir:     this._workspaceRoot,
            gitRepo:     this._gitRepo,
            gitBranch:   this._gitBranch,
          });
          // Reset task so it gets picked up again after resume
          await todoWriter.resetToTodo(todoPath, task).catch(() => {});
          // Block here until resumed (timer or user clicks Retry Now)
          this._resumeAt = resumeAt;
          await this._pauseLoop(resumeMs);
          // After resume, if user stopped while paused, exit the while loop
          if (this._state !== 'running') { break; }
          continue; // pick up the same task at the top of the loop
        }
        // --- Context length (OpenCode + Claude): run /compact once then retry
        if (err instanceof ContextLengthError && !this._compactedTaskLines.has(task.line)) {
          this._compactedTaskLines.add(task.line);
          const rawMsg = err.rawMessage.slice(0, 300);
          const provider = this._cb?.getActiveProvider() ?? '';
          this._cb?.log(`🗜 Context length exceeded (${provider}) — running /compact: ${rawMsg}`);
          this._notifyDiscord(`🗜 **Context length exceeded** (${provider}) — running \`/compact\`…\n\`\`\`\n${rawMsg}\n\`\`\``);

          if (provider === 'claude-cli') {
            // Resolve a Claude session ID — prefer the saved one, else scan
            // the .claude/projects jsonl folder for the most recent.
            let sessionId = getSessionId(this._workspaceRoot!, 'claude-cli');
            if (!sessionId) { sessionId = findLatestClaudeSession(this._workspaceRoot!); }
            if (sessionId) {
              try {
                await runClaudeCompact(sessionId, this._workspaceRoot!, msg => this._cb?.log(msg));
                this._cb?.log('🗜 Claude compact complete — retrying task');
                this._notifyDiscord('🗜 Claude compact complete — retrying task');
              } catch (compactErr) {
                const compactMsg = compactErr instanceof Error ? compactErr.message : String(compactErr);
                this._cb?.log(`⚠️ Claude compact failed: ${compactMsg} — retrying anyway`);
              }
            } else {
              this._cb?.log('⚠️ No Claude session ID found for compact — retrying task without compact');
            }
          } else {
            // OpenCode (existing behaviour)
            let sessionId = getSessionId(this._workspaceRoot!, 'opencode-cli');
            if (!sessionId) {
              sessionId = await getLatestOpenCodeSessionId(this._workspaceRoot!, msg => this._cb?.log(msg));
            }
            if (sessionId) {
              try {
                await runOpenCodeCompact(sessionId, this._workspaceRoot!, msg => this._cb?.log(msg));
                this._cb?.log('🗜 Compact complete — retrying task');
                this._notifyDiscord('🗜 Compact complete — retrying task');
              } catch (compactErr) {
                const compactMsg = compactErr instanceof Error ? compactErr.message : String(compactErr);
                this._cb?.log(`⚠️ Compact failed: ${compactMsg} — retrying anyway`);
              }
            } else {
              this._cb?.log('⚠️ No OpenCode session ID found for compact — retrying task without compact');
            }
          }
          await todoWriter.resetToTodo(todoPath, task).catch(() => {});
          continue;
        }
        // --- Context length already compacted or plan limit: pause + retry button
        if (err instanceof ContextLengthError) {
          const rawMsg = err.rawMessage.slice(0, 300);
          const provider = this._cb?.getActiveProvider() ?? '';
          this._cb?.log(`⏸ Context length exceeded (${provider}) and already compacted — pausing. Click Retry to resume.\n${rawMsg}`);
          this._notifyDiscord(`⏸ **Context length exceeded** (${provider}) — already compacted or plan limit hit. Pausing…\n\`\`\`\n${rawMsg}\n\`\`\``);
          this._notifyWebhook('rate_limit', {
            iteration:   this._iterations,
            task:        { text: task.text },
            message:     rawMsg,
            resumeAt:    new Date(Date.now() + 60 * 60_000).toISOString(),
            provider,
            workDir:     this._workspaceRoot,
            gitRepo:     this._gitRepo,
            gitBranch:   this._gitBranch,
          });
          await todoWriter.resetToTodo(todoPath, task).catch(() => {});
          // No auto-resume time — user must click Retry manually
          this._resumeAt = undefined;
          await this._pauseLoop(); // pause indefinitely
          if (this._state !== 'running') { break; }
          continue;
        }
        // --- Normal task failure ------------------------------------------
        const duration = Math.round((Date.now() - taskStartTime) / 1000);
        this._failedCount++;
        const msg = err instanceof Error ? err.message : String(err);
        this._cb?.log(`❌ Task failed: ${task.text} — ${msg}`);
        this._notifyWebhook('task_fail', {
          iteration: this._iterations,
          task:      { text: task.text },
          duration,
          error:     msg,
          workDir:   this._workspaceRoot,
          gitRepo:   this._gitRepo,
          gitBranch: this._gitBranch,
        });
        this._notifyDiscord(`❌ **Task failed:**\n${discordLabel(task.text)}\n\`${msg}\``);        const afterRemainingFail = countRemaining(parseTodo(todoPath));
        if (afterRemainingFail > 0) {
          const totalKnownFail = this._iterations + afterRemainingFail;
          this._notifyDiscord(`\ud83d\udcca Progress: ${this._iterations}/${totalKnownFail}`);
          this._notifyWebhook('task_progress', {
            iteration: this._iterations,
            total:     totalKnownFail,
            remaining: afterRemainingFail,
            workDir:   this._workspaceRoot,
            gitRepo:   this._gitRepo,
            gitBranch: this._gitBranch,
          });
        }        // Continue to next task rather than stopping the loop
      }

      this._currentTask = undefined;
    }
  }

  /**
   * Suspend the loop in 'paused' state.
   * Resolves when retry() is called or (optionally) the timer fires.
   * MUST be called only from _runLoop.
   */
  private _pauseLoop(resumeAfterMs?: number): Promise<void> {
    this._setState('paused');
    return new Promise<void>(resolve => {
      this._resumeResolve = resolve;
      if (resumeAfterMs !== undefined && resumeAfterMs > 0) {
        this._retryScheduler.schedule(resumeAfterMs, () => {
          this._cb?.log('Rate limit timer expired — resuming loop automatically');
          this.retry();
        });
      }
    });
  }

  /** Interrupt the idle no-task sleep — called by pollers when they append a task. */
  private _wakeIdleSleep(): void {
    const w = this._idleSleepWake;
    this._idleSleepWake = null;
    w?.();
  }

  /** sleep() that resolves early when _wakeIdleSleep() is called. */
  private _sleepOrWake(ms: number): Promise<void> {
    return new Promise<void>(resolve => {
      const id = setTimeout(resolve, ms);
      this._idleSleepWake = () => { clearTimeout(id); resolve(); };
    });
  }

  /** sleep() that resolves immediately when the task-completion abort fires. */
  private _sleepAbortable(ms: number): Promise<void> {
    return new Promise<void>(resolve => {
      const id = setTimeout(resolve, ms);
      const prev = this._taskCompletionAbort;
      this._taskCompletionAbort = () => { clearTimeout(id); resolve(); prev?.(); };
    });
  }

  /** Return when the task text appears with [x] status in the TODO.md file. */
  private _waitForTaskCompletion(todoPath: string, task: Task, claudeCursor = 0): Promise<void> {
    const isClaudeCli = this._cb?.getActiveProvider() === 'claude-cli';
    const isClaudeTui = this._cb?.getActiveProvider() === 'claude-tui';
    const isOpenCodeCli = this._cb?.getActiveProvider() === 'opencode-cli';
    const isOpencodeSdk = this._cb?.getActiveProvider() === 'opencode-sdk';
    return new Promise<void>((resolve, reject) => {
      if (this._state !== 'running') { resolve(); return; }

      const settings = this._settings!;
      const timeoutMs  = (settings.taskTimeoutMinutes  ?? 30) * 60 * 1_000;
      const taskStartTime = Date.now();

      // Timeout is based on TODO.md inactivity, not total process runtime.
      // Every time TODO.md changes (any [~]/[x] write by the AI) this resets.
      // Only fires if TODO.md has been untouched for the full timeout duration.
      let lastTodoChangeTime = Date.now();
      // Shared with the JSONL inactivity poller — reset here so TODO.md changes
      // prevent the "Still working" reminder from firing unnecessarily.
      let lastActivityTime   = Date.now();

      const found = () => {
        const updated = parseTodo(todoPath);
        // 1. Prefer task ID (globally unique — set by appendTask on every new task).
        // 2. Line number with text verification (fast; guards against line-shift from
        //    new tasks inserted above this one pointing to the wrong entry).
        // 3. Text-only fallback when there is no ID and the line has shifted.
        const byId           = task.id ? updated.find(t => t.id === task.id) : undefined;
        const byLine         = updated.find(t => t.line === task.line);
        const byLineVerified = (byLine && byLine.text === task.text) ? byLine : undefined;
        const byText         = updated.find(t => t.text === task.text);
        const match          = byId ?? byLineVerified ?? byText;
        if (!match) { return true; }   // task genuinely gone — treat as done
        return match.status === 'done';
      };

      // Check immediately (AI might have already edited the file)
      if (found()) { resolve(); return; }

      let poller: NodeJS.Timeout | undefined;
      let stdoutWatcherRef: IDisposable | undefined;
      let exitWatcherRef: IDisposable | undefined;
      let todoWatcher: IDisposable | undefined;
      const endTurnTimers: NodeJS.Timeout[] = [];
      // Set to true by cleanup() so stale onCliExit() calls that are still
      // sleeping don't send a spurious reminder after the task resolved.
      let cancelled = false;

      const cleanup = () => {
        cancelled = true;
        this._taskCompletionAbort = null;
        clearInterval(poller);
        for (const t of endTurnTimers) { clearTimeout(t); }
        endTurnTimers.length = 0;
        todoWatcher?.dispose();
        stdoutWatcherRef?.dispose();
        stdoutWatcherRef = undefined;
        exitWatcherRef?.dispose();
        exitWatcherRef = undefined;
        this._cb?.onActivityChange?.(undefined);
      };

      const check = () => {
        if (this._state !== 'running') { cleanup(); resolve(); return; }
        lastTodoChangeTime = Date.now(); // reset inactivity clock on every TODO.md change
        lastActivityTime = Date.now();  // also reset JSONL inactivity — TODO change = AI is active
        if (found()) { cleanup(); resolve(); }
      };

      todoWatcher = this._cb!.fileWatcher.watch(todoPath, check);
      this._taskWatcher = todoWatcher;

      // Per-provider stdout capture file (only used for CLI providers)
      const activeProvider = this._cb?.getActiveProvider() ?? 'unknown';
      // Re-computed dynamically — sendToAi() (reminder path) rotates to a fresh
      // per-message file and updates the .latest pointer.  Using a let + refresh
      // in the interval ensures checkStdout() always reads the current file.
      let resolvedStdoutFile = this._workspaceRoot
        ? stdoutFilePath(this._workspaceRoot, activeProvider)
        : null;

      // Helper: read stdout capture file handling both UTF-8 and UTF-16 LE (PowerShell default)
      const readStdoutFile = (): string => {
        if (!resolvedStdoutFile) { return ''; }
        try {
          const buf = fs.readFileSync(resolvedStdoutFile);
          // Detect UTF-16 LE BOM (0xFF 0xFE)
          if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
            return buf.toString('utf16le');
          }
          return buf.toString('utf8');
        } catch { return ''; }
      };

      // Track how many characters of the stdout file we've already forwarded
      let lastStdoutLen = 0;

      // Check stdout file: forward any new content to Discord/webhook, detect rate limit / context errors
      const checkStdout = () => {
        if (!isClaudeCli && !isClaudeTui && !isOpenCodeCli) { return; } // only CLI providers tee stdout
        const content = readStdoutFile();

        // Forward new output lines to Discord / webhook (Claude only — OpenCode output is very verbose)
        if ((isClaudeCli || isClaudeTui) && content.length > lastStdoutLen) {
          const newText = content.slice(lastStdoutLen).trim();
          lastStdoutLen = content.length;
          if (newText) {
            this._notifyDiscord(`🖥 **Claude output:**\n\`\`\`\n${newText}\n\`\`\``);
            this._notifyWebhook('claude_output', {
              iteration: this._iterations,
              task:      { text: task.text },
              output:    newText,
              workDir:   this._workspaceRoot,
              gitRepo:   this._gitRepo,
              gitBranch: this._gitBranch,
            });
          }
        } else {
          lastStdoutLen = content.length; // keep cursor up to date for non-Claude providers
        }

        // Rate limit detection (Claude CLI + TUI)
        if (isClaudeCli || isClaudeTui) {
          const rlErr = RateLimitDetector.detect(content);
          if (rlErr) {
            cleanup();
            reject(rlErr);
            return;
          }
        }

        // Context length error detection (OpenCode)
        if (isOpenCodeCli && content.toLowerCase().includes('maximum context length')) {
          cleanup();
          reject(new ContextLengthError(content.trim()));
          return;
        }

        // Context length error detection (Claude). Patterns observed:
        //   "prompt is too long: 1018289 tokens > 1000000 maximum"
        //   "Prompt is too long" (last_assistant_message in StopFailure hook)
        //   "context_length_exceeded"
        if (isClaudeCli) {
          const lc = content.toLowerCase();
          if (lc.includes('prompt is too long')
              || lc.includes('context_length_exceeded')
              || /tokens?\s*>\s*\d+\s*maximum/.test(lc)) {
            cleanup();
            reject(new ContextLengthError(content.trim()));
            return;
          }
        }

        // Context length detection for claude-tui (same patterns)
        if (isClaudeTui) {
          const lc = content.toLowerCase();
          if (lc.includes('prompt is too long')
              || lc.includes('context_length_exceeded')
              || /tokens?\s*>\s*\d+\s*maximum/.test(lc)) {
            cleanup();
            reject(new ContextLengthError(content.trim()));
            return;
          }
        }
      };

      // Register abort hook so stop() can resolve this immediately
      this._taskCompletionAbort = () => { cleanup(); resolve(); };

      // Watch the per-provider stdout capture file for instant rate-limit detection.
      // Use the actual per-message file, not the legacy provider-level path, so the
      // watcher fires on the file the current process is writing to.
      const attachStdoutWatcher = (filePath: string | null) => {
        stdoutWatcherRef?.dispose();
        stdoutWatcherRef = filePath
          ? this._cb!.fileWatcher.watch(filePath, checkStdout)
          : undefined;
      };
      attachStdoutWatcher(resolvedStdoutFile);

      // Watch the exit file — written by withExitFile() in dispatcher.ts when the CLI
      // process finishes. CliExitHandler owns the decision tree of what to do.
      const exitHandler = this._workspaceRoot
        ? new CliExitHandler(this._workspaceRoot, todoPath, task, taskStartTime, found)
        : null;
      const onCliExit = async () => {
        if (this._state !== 'running') { return; }
        // Give TODO.md enough time to be fully flushed and for any final Claude
        // writes (session ID capture etc.) to settle before we declare it undone.
        await sleep(3_000);
        // A parallel path (todoWatcher / poller check()) may have already
        // resolved the promise while we were sleeping.  Don't send a spurious
        // reminder to the next task's session.
        if (cancelled) { return; }

        // Fast-path: if the stdout capture file already contains a rate-limit
        // phrase at exit time, raise immediately without waiting for a hooks event.
        if (isClaudeCli) {
          const stdoutContent = readStdoutFile();
          const rlFromStdout = RateLimitDetector.detect(stdoutContent);
          if (rlFromStdout) {
            cleanup();
            reject(rlFromStdout);
            return;
          }
        }

        const decision = exitHandler?.decide() ?? { kind: 'remind' as const };

        if (decision.kind === 'done') { return; }

        if (decision.kind === 'deferred') {
          this._cb?.log(`↪︎ CLI exited with task [~] deferred — moving to next pending task: ${discordLabel(task.text)}`);
          cleanup();
          resolve();
          return;
        }

        if (decision.kind === 'rate_limit') {
          cleanup();
          reject(decision.error);
          return;
        }

        if (decision.kind === 'give_up') {
          this._cb?.log(`↪︎ CLI exited again without marking task done — moving on: ${discordLabel(task.text)}`);
          cleanup();
          resolve();
          return;
        }

        // decision.kind === 'remind'
        const elapsedMin = Math.round((Date.now() - taskStartTime) / 60_000);
        const msg = `⏳ CLI finished but task not yet marked done (${elapsedMin}m): ${discordLabel(task.text)}`;
        this._cb?.log(msg);
        this._notifyDiscord(msg);
        this._notifyWebhook('task_checkin', {
          iteration:      this._iterations,
          task:           { text: task.text },
          elapsedMinutes: elapsedMin,
          workDir:        this._workspaceRoot,
          gitRepo:        this._gitRepo,
          gitBranch:      this._gitBranch,
        });
        const date = new Date().toISOString().slice(0, 10);
        // Read the actual current marker from TODO.md so the reminder is accurate.
        // If Claude never started the task it will be [ ]; if it marked it in-progress
        // but then exited it will be [~]. Using the wrong marker causes the AI to fail
        // to locate the line and exit again without making any change.
        const currentTasks = parseTodo(todoPath);
        const currentLine  = currentTasks.find(t => t.line === task.line || t.text === task.text);
        const currentMarker = currentLine?.status === 'in-progress' ? '~' : ' ';
        const reminder = [
          `Your process has finished.  If you have completed the task, mark it done in TODO.md now.`,
          ``,
          `Change the line:`,
          `  - [${currentMarker}] ${task.text}`,
          `to exactly:`,
          `  - [x] ${date}  ${task.text}`,
          ``,
          `(two spaces between the date and task text, lowercase x, save the file)`,
          `If you haven't finished yet, continue and mark it done when you are.`,
        ].join('\n');
        this._cb?.log(`⚠️ CLI exited: reminding AI to mark TODO.md (${elapsedMin}m elapsed)`);
        try {
          const reminderFile = writeMessageFile(this._workspaceRoot!, reminder);
          await this._cb!.sendToAi(reminder, task.text, undefined, reminderFile);
        } catch { /* ignore */ }
      };

      // Track which exit file we are currently watching so the poller can
      // re-attach when sendToAi() rotates to a new per-message exit file.
      let watchedExitFile: string | null = null;
      // Path of the exit file for which onCliExit() has already been invoked.
      // Prevents the watcher AND the poller fallback from both firing onCliExit()
      // for the same exit event (the guard is set by whichever fires first).
      let handledExitFile: string | null = null;

      const attachExitWatcher = (filePath: string) => {
        if (filePath === watchedExitFile) { return; } // already watching this file
        exitWatcherRef?.dispose();
        watchedExitFile = filePath;
        exitWatcherRef = this._cb!.fileWatcher.watch(filePath, () => {
          if (handledExitFile === filePath) { return; } // poller already handled
          try {
            const content = fs.readFileSync(filePath, 'utf8').trim();
            if (content === '') { return; } // file cleared at task start — ignore
          } catch { return; }
          handledExitFile = filePath;
          void onCliExit();
        });
      };

      // opencode-sdk: the persistent in-process SDK doesn't use the CLI exit-file
      // reminder flow — doing so causes a re-prompt loop (the SDK writes '0' to the
      // exit file when session.idle fires, the poller sees it, calls onCliExit(),
      // which re-sends the prompt, which loops).  Instead, the poller resolves this
      // promise directly when isOpencodeSdkBusy() becomes false (see below).
      if (!isOpencodeSdk && this._workspaceRoot) {
        attachExitWatcher(exitFilePath(this._workspaceRoot, activeProvider));
      }

      // Inactivity-based check-in: track Claude JSONL byte size every 3 s.
      // After 15 minutes of silence (no new bytes), send the TODO.md reminder.
      // Resets when Claude writes again so we don't spam.
      const INACTIVITY_MS = 15 * 60 * 1_000;
      let endTurnSeen = false;
      let lastJSONLSize = claudeCursor > 0 && this._workspaceRoot
        ? getClaudeSessionCursor(this._workspaceRoot) : 0;
      // lastActivityTime is declared above (shared with check())
      let reminderPending = true; // allow one reminder per quiet period
      let lastActivity: string | undefined;

      poller = setInterval(async () => {
        check();

        if (!this._workspaceRoot) { return; }

        // If sendToAi() was called (e.g. reminder path) it rotates to a new
        // per-message stdout/exit file.  Re-attach both watchers so the next
        // process's output and exit are both detected even though the paths changed.
        const latestStdout = this._workspaceRoot ? stdoutFilePath(this._workspaceRoot, activeProvider) : null;
        if (latestStdout && latestStdout !== resolvedStdoutFile) {
          resolvedStdoutFile = latestStdout;
          lastStdoutLen = 0; // reset cursor — new file starts from byte 0
          attachStdoutWatcher(resolvedStdoutFile);
        }

        const latestExit = exitFilePath(this._workspaceRoot, activeProvider);
        if (!isOpencodeSdk && latestExit !== watchedExitFile) { attachExitWatcher(latestExit); }

        // opencode-sdk: resolve _waitForTaskCompletion as soon as the SDK
        // session goes idle (isOpencodeSdkBusy false).  This avoids the
        // CLI-style onCliExit() reminder re-prompt loop that the exit-file
        // mechanism would otherwise trigger.
        if (isOpencodeSdk && this._workspaceRoot && !isOpencodeSdkBusy(this._workspaceRoot)) {
          check(); // one last todo-file check before resolving
          if (!cancelled) { cleanup(); resolve(); }
          return;
        }

        // Poller-based exit fallback: the VS Code file-system watcher can miss
        // events (gitignored dirs, inotify limits, fast exits before re-attach).
        // Read the exit file directly every tick and trigger onCliExit() if it
        // became non-empty without the watcher firing.
        if (!isOpencodeSdk && latestExit && latestExit !== handledExitFile) {
          try {
            if (fs.readFileSync(latestExit, 'utf8').trim() !== '') {
              handledExitFile = latestExit;
              void onCliExit();
            }
          } catch { /* file not yet written — ignore */ }
        }

        // Parse rich JSONL state: end_turn, active tool, bash progress
        if (claudeCursor > 0) {
          const sessionState = parseClaudeStateSince(this._workspaceRoot, claudeCursor);

          // end_turn detection — fast-path on Linux where inotify can lag
          if (!endTurnSeen && sessionState.hasEndTurn) {
            endTurnSeen = true;
            this._cb?.log('end_turn detected in Claude JSONL — checking TODO.md');
            endTurnTimers.push(setTimeout(check, 800));
            endTurnTimers.push(setTimeout(check, 2_500));
          }

          // Surface current tool activity to sidebar
          const activity = sessionState.hasEndTurn
            ? undefined
            : (sessionState.activeToolStatus ?? (sessionState.hasProgress ? 'Running command\u2026' : undefined));
          if (activity !== lastActivity) {
            lastActivity = activity;
            this._cb?.onActivityChange?.(activity);
          }

          // Rate limit detection — reject immediately so _runLoop can pause
          if (sessionState.rateLimitMessage) {
            cleanup();
            reject(RateLimitDetector.toError(sessionState.rateLimitMessage));
            return;
          }
        }

        // Also check stdout capture file as poller fallback (watcher handles most cases)
        checkStdout();

        // Track JSONL activity
        const currentSize = getClaudeSessionCursor(this._workspaceRoot);
        if (currentSize !== lastJSONLSize) {
          lastJSONLSize = currentSize;
          lastActivityTime = Date.now();
          reminderPending = true; // new activity — allow a fresh reminder after next silence
          return;
        }

        // No new bytes — check if we've been quiet long enough
        if (!reminderPending) { return; }
        if (Date.now() - lastActivityTime < INACTIVITY_MS) { return; }

        // 15+ minutes of JSONL silence — send one reminder
        reminderPending = false;
        if (this._state !== 'running') { return; }

        const elapsedMin = Math.round((Date.now() - taskStartTime) / 60_000);
        const msg = `⏳ Still working... (${elapsedMin}m elapsed): ${discordLabel(task.text)}`;
        this._cb?.log(msg);
        this._notifyDiscord(msg);
        this._notifyWebhook('task_checkin', {
          iteration:      this._iterations,
          task:           { text: task.text },
          elapsedMinutes: elapsedMin,
          workDir:        this._workspaceRoot,
          gitRepo:        this._gitRepo,
          gitBranch:      this._gitBranch,
        });
        const date = new Date().toISOString().slice(0, 10);
        const currentTasks2 = parseTodo(todoPath);
        const currentLine2  = currentTasks2.find(t => t.line === task.line || t.text === task.text);
        const currentMarker2 = currentLine2?.status === 'in-progress' ? '~' : ' ';
        const reminder = [
          `Reminder: when you are done with the task, mark it done in TODO.md.`,
          ``,
          `Change the line:`,
          `  - [${currentMarker2}] ${task.text}`,
          `to exactly:`,
          `  - [x] ${date}  ${task.text}`,
          ``,
          `(two spaces between the date and task text, lowercase x, save the file)`,
          `If you have already finished, do this now.`,
        ].join('\n');
        this._cb?.log(`⚠️ Check-in: reminding AI to mark TODO.md (${elapsedMin}m, JSONL quiet for 3m)`);
        try {
          const reminderFile = writeMessageFile(this._workspaceRoot!, reminder);
          await this._cb!.sendToAi(reminder, task.text, undefined, reminderFile);
        } catch { /* ignore */ }

        // TODO.md inactivity timeout — fires when TODO.md has not been touched
        // for the full timeout duration (resets on every TODO.md write).
        const idleMs = Date.now() - lastTodoChangeTime;
        if (idleMs >= timeoutMs) {
          cleanup();
          const minutes = settings.taskTimeoutMinutes ?? 30;
          if (settings.retryOnTimeout) {
            await todoWriter.resetToTodo(todoPath, task).catch(() => {});
            const msg = `⏱ TODO.md idle for ${minutes}m — retrying: ${discordLabel(task.text)}`;
            this._cb?.log(msg);
            this._notifyDiscord(msg);
            this._notifyWebhook('task_checkin', {
              iteration:      this._iterations,
              task:           { text: task.text },
              elapsedMinutes: minutes,
              timedOut:       true,
              retrying:       true,
              workDir:        this._workspaceRoot,
              gitRepo:        this._gitRepo,
              gitBranch:      this._gitBranch,
            });
            resolve(); // loop will pick it up again as a fresh [ ] task
          } else {
            reject(new Error(`Task timed out after ${minutes} minutes of TODO.md inactivity`));
          }
          return;
        }
      }, 3_000);
    });
  }

  private _disposeWatcher(): void {
    this._taskWatcher?.dispose();
    this._taskWatcher = undefined;
  }

  private _setState(state: LoopState, taskText?: string): void {
    this._state = state;
    this._cb?.onStatusChange(state, taskText);
  }

  private _notifyWebhook(event: WebhookEvent, payload?: Record<string, unknown>): void {
    this._webhook?.send(event, payload);
  }

  private _notifyDiscord(message: string): void {
    const s = this._settings;
    if (!s) { return; }
    if (s.discordToken && s.discordChannelId) {
      sendDiscordBotMessage(s.discordToken, s.discordChannelId, message);
    }
  }
}

/** Singleton runner — one loop per workspace session. */
export const taskLoopRunner = new TaskLoopRunner();
