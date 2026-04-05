import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { parseTodo, pickNextTask, countRemaining, resetAllInProgress, resetToTodo, Task } from './todo';
import { buildPrompt } from './prompt';
import { WebhookClient, WebhookEvent, sendDiscordBotMessage, sendDiscordWebhook } from './webhook';
import { loadSettings, AutodevSettings } from './settings';
import { getClaudeSessionCursor, parseClaudeStateSince, findLatestClaudeSession } from './dispatcher';
import { getLatestOpenCodeSessionId } from './providers/opencodeCliProvider';
import { captureAndSaveSessionId, saveSessionId, stdoutFilePath } from './sessionState';
import { PROVIDERS, ProviderId } from './providers';
import { DiscordPoller } from './discordPoller';
import { WebhookPoller } from './webhookPoller';

// ---------------------------------------------------------------------------
// TaskLoopRunner — mirrors PHP Loop.php
// ---------------------------------------------------------------------------

export type LoopState = 'idle' | 'running' | 'stopping' | 'paused';

// ---------------------------------------------------------------------------
// Rate-limit helpers
// ---------------------------------------------------------------------------

class RateLimitError extends Error {
  constructor(readonly rawMessage: string, readonly resetAt: Date | undefined) {
    super(rawMessage);
    this.name = 'RateLimitError';
  }
}

/**
 * Parse "You've hit your limit · resets 9pm (Europe/Sofia)" into a UTC Date.
 * Returns undefined when the string cannot be parsed.
 */
function parseRateLimitResetTime(text: string): Date | undefined {
  const m = text.match(/resets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*\(([^)]+)\)/i);
  if (!m) { return undefined; }
  try {
    let hour = parseInt(m[1]);
    const min = parseInt(m[2] ?? '0');
    const isPm = m[3].toLowerCase() === 'pm';
    const tz = m[4];
    if (isPm && hour !== 12) { hour += 12; }
    if (!isPm && hour === 12) { hour = 0; }
    const now = new Date();
    // Get date in target timezone (sv locale gives YYYY-MM-DD)
    const dateStr = new Intl.DateTimeFormat('sv', { timeZone: tz }).format(now);
    for (let d = 0; d <= 1; d++) {
      const base = Date.parse(dateStr) + d * 86_400_000 + hour * 3_600_000 + min * 60_000;
      const naiveDate = new Date(base);
      // Correct naive UTC for the actual tz offset at that moment
      const inTz = new Date(naiveDate.toLocaleString('en-US', { timeZone: tz }));
      const offset = naiveDate.getTime() - inTz.getTime();
      const resetUtc = new Date(base + offset);
      if (resetUtc > now) { return resetUtc; }
    }
    return undefined;
  } catch { return undefined; }
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
  /** Send a raw prompt string to the active AI provider */
  sendToAi: (prompt: string, taskLabel: string, focusOnly?: boolean) => Promise<void>;
  /** Append a message to the extension's output channel */
  log: (msg: string) => void;
  /** Called whenever the loop state changes so the sidebar can refresh */
  onStatusChange: (state: LoopState, currentTask?: string) => void;
  /** Called when Claude's current tool activity changes (undefined = idle/done) */
  onActivityChange?: (activity: string | undefined) => void;
  /** Returns the currently selected provider ID (live, not from settings file) */
  getActiveProvider: () => ProviderId;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
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

class TaskLoopRunner {
  private _state: LoopState = 'idle';
  private _currentTask: string | undefined;
  private _taskWatcher: vscode.Disposable | undefined;
  private _iterations = 0;
  private _cb: LoopCallbacks | undefined;
  private _webhook: WebhookClient | null = null;
  private _settings: AutodevSettings | undefined;
  private _workspaceRoot: string | undefined;
  private _discordPoller: DiscordPoller | null = null;
  private _webhookPoller: WebhookPoller | null = null;
  private _pollerIntervals: NodeJS.Timeout[] = [];
  private _taskCompletionAbort: (() => void) | null = null;
  private _retryScheduler = new RetryScheduler();
  private _resumeResolve: (() => void) | null = null;
  private _resumeAt: Date | undefined;
  private _gitRepo: string = '';
  private _gitBranch: string = '';
  private _hostname: string = '';
  private _completedCount = 0;
  private _failedCount = 0;
  private _loopStartTime = 0;

  get state(): LoopState { return this._state; }
  get currentTask(): string | undefined { return this._currentTask; }
  get resumeAt(): Date | undefined { return this._resumeAt; }

  /** Resume the loop after a rate-limit pause. Clears the scheduled timer. */
  retry(): void {
    if (this._state !== 'paused') { return; }
    this._retryScheduler.clear();
    this._resumeAt = undefined;
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
    this._setState('running');

    const settings = loadSettings();
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
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
        )
      : null;
    this._webhook?.setMeta({ provider: settings.provider, workDir: root, hostname: this._hostname, gitRepo: this._gitRepo, gitBranch: this._gitBranch });

    this._discordPoller = (settings.discordToken && settings.discordChannelId && settings.discordOwners)
      ? new DiscordPoller(settings.discordToken, settings.discordChannelId, settings.discordOwners)
      : null;

    this._webhookPoller = (settings.serverBaseUrl && settings.serverApiKey && settings.webhookSlug)
      ? new WebhookPoller(settings.serverBaseUrl, settings.serverApiKey, settings.webhookSlug)
      : null;

    const todoPath = settings.todoPath || path.join(root, 'TODO.md');
    const autodevPath = settings.profilePath || path.join(root, 'AUTODEV.md');

    // Seed Discord cursor to ignore history before the loop started
    if (this._discordPoller) {
      await this._discordPoller.initialize();
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
      hostname:  this._hostname,
      workDir:   root,
      gitRepo:   this._gitRepo,
      gitBranch: this._gitBranch,
    });
    this._notifyDiscord('🚀 AutoDev task loop started');

    try {
      await this._runLoop(todoPath, autodevPath, settings);
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
    this._webhookPoller = null;
    this._setState('idle');
    callbacks.log('Task loop stopped');
  }

  stop(): void {
    if (this._state !== 'running' && this._state !== 'paused') { return; }
    this._setState('stopping');
    this._retryScheduler.clear();
    this._resumeAt = undefined;
    // Unblock _pause() if we're currently suspended
    const r = this._resumeResolve;
    this._resumeResolve = null;
    r?.();
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
   * Start Discord and webhook server pollers as independent setInterval loops.
   * They run continuously in the background — even while the AI is processing a task.
   */
  private _startPollers(todoPath: string): void {
    const POLL_MS = 3_000;

    if (this._discordPoller) {
      const discordInterval = setInterval(async () => {
        if (this._state !== 'running') { return; }
        try { await this._discordPoller!.pollAndAppend(todoPath); } catch { }
      }, POLL_MS);
      this._pollerIntervals.push(discordInterval);
    }

    if (this._webhookPoller) {
      const webhookInterval = setInterval(async () => {
        if (this._state !== 'running') { return; }
        try { await this._webhookPoller!.pollAndAppend(todoPath); } catch { }
      }, POLL_MS);
      this._pollerIntervals.push(webhookInterval);
    }
  }

  private _stopPollers(): void {
    for (const id of this._pollerIntervals) { clearInterval(id); }
    this._pollerIntervals = [];
  }

  private async _runLoop(todoPath: string, autodevPath: string, settings: AutodevSettings): Promise<void> {
    let allTasksDoneNotified = false;

    // Reset any [~] in-progress tasks left over from a previous run
    if (settings.autoResetPendingTasks) {
      resetAllInProgress(todoPath);
      this._cb?.log('Auto-reset in-progress tasks to [ ]');
    }

    while (this._state === 'running') {      const tasks = parseTodo(todoPath);
      const task = pickNextTask(tasks);

      if (!task) {
        const remaining = countRemaining(tasks);
        if (remaining === 0) {
          if (!allTasksDoneNotified) {
            allTasksDoneNotified = true;
            this._cb?.log('All tasks completed ✓ — stopping loop.');
            this._notifyWebhook('all_tasks_done', {
              workDir:   this._workspaceRoot,
              gitRepo:   this._gitRepo,
              gitBranch: this._gitBranch,
            });
            this._notifyDiscord('✅ All tasks done!');
          }
          // Stop the loop — do not poll again until the user manually restarts
          this._setState('stopping');
          return;
        }
        // There are uncompleted tasks but none are pending (e.g. all [~] in-progress)
        this._cb?.log(`No pending tasks — waiting ${settings.loopInterval}s…`);
        await sleep(settings.loopInterval * 1000);
        continue;
      }

      // A task is available — reset the all-done flag
      allTasksDoneNotified = false;

      this._iterations++;
      this._currentTask = task.text;
      this._setState('running', task.text);

      // Do NOT mark in-progress from JS — the prompt instructs the LLM to do it
      const prompt = buildPrompt(task, this._workspaceRoot!, path.dirname(todoPath), autodevPath);
      const remaining = countRemaining(parseTodo(todoPath));

      this._cb?.log(`▶ Task [${this._iterations}]: ${task.text}`);
      this._notifyWebhook('task_start', {
        iteration: this._iterations,
        task:      { text: task.text },
        remaining,
        workDir:   this._workspaceRoot,
        gitRepo:   this._gitRepo,
        gitBranch: this._gitBranch,
      });
      this._notifyDiscord(`▶️ **Task started** (${remaining} remaining):\n${discordLabel(task.text)}`);

      const taskStartTime = Date.now();
      // Snapshot the JSONL cursor before sending — we only read bytes written after this
      const claudeCursor = getClaudeSessionCursor(this._workspaceRoot!);
      try {
        // Send to AI — resolves as soon as the prompt is pasted, not when Claude finishes
        await this._cb!.sendToAi(prompt, task.text);

        // Wait for the AI to mark the task [x] done in TODO.md
        await this._waitForTaskCompletion(todoPath, task, claudeCursor);

        // Let the OS fully flush Claude's final write before we re-read TODO.md.
        // Uses the task-completion abort hook so Stop clears this immediately.
        await this._sleepAbortable(2_000);

        // Capture and persist CLI session ID so the next task can resume it
        const activeProvider = this._cb?.getActiveProvider();
        if (this._workspaceRoot && activeProvider && PROVIDERS[activeProvider]?.isCli) {
          if (activeProvider === 'opencode-cli') {
            // opencode run doesn't output JSON, so read the session list directly
            getLatestOpenCodeSessionId(this._workspaceRoot, msg => this._cb?.log(msg))
              .then(id => { if (id && this._workspaceRoot) { saveSessionId(this._workspaceRoot, 'opencode-cli', id); } })
              .catch(() => {});
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
        const afterTasks = parseTodo(todoPath);
        const afterRemaining = countRemaining(afterTasks);
        const totalKnown = this._iterations + afterRemaining;
        this._cb?.log(`\u2705 Task done: ${task.text}`);
        this._notifyWebhook('task_done', {
          iteration: this._iterations,
          task:      { text: task.text },
          duration,
          workDir:   this._workspaceRoot,
          gitRepo:   this._gitRepo,
          gitBranch: this._gitBranch,
        });
        this._notifyDiscord(`\u2705 **Task done** (${afterRemaining} remaining):\n${discordLabel(task.text)}`);
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
      } catch (err) {
        // --- Rate limit: pause loop, schedule auto-resume -----------------
        if (err instanceof RateLimitError) {
          const resetAt = err.resetAt;
          const resumeMs = resetAt ? (resetAt.getTime() - Date.now() + 15 * 60_000) : undefined;
          const resumeStr = resetAt ? resetAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'unknown';
          const rawMsg = err.rawMessage;
          this._cb?.log(`⏸ Rate limit hit — ${rawMsg}. Auto-resume at ${resumeStr} (+15 min)`);
          this._notifyDiscord(`⏸ **Rate limit hit** — resuming at ${resumeStr} (+15 min)\n\`\`\`\n${rawMsg}\n\`\`\``);
          this._notifyWebhook('rate_limit', {
            iteration:   this._iterations,
            task:        { text: task.text },
            message:     rawMsg,
            resumeAt:    resetAt?.toISOString(),
            provider:    this._cb?.getActiveProvider() ?? 'unknown',
            workDir:     this._workspaceRoot,
            gitRepo:     this._gitRepo,
            gitBranch:   this._gitBranch,
          });
          // Reset task so it gets picked up again after resume
          try { resetToTodo(todoPath, task); } catch { /* ignore */ }
          // Block here until resumed (timer or user clicks Retry Now)
          this._resumeAt = resetAt;
          await this._pauseLoop(resumeMs);
          // After resume, if user stopped while paused, exit the while loop
          if (this._state !== 'running') { break; }
          continue; // pick up the same task at the top of the loop
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
    return new Promise<void>((resolve, reject) => {
      if (this._state !== 'running') { resolve(); return; }

      const settings = this._settings!;
      const timeoutMs  = (settings.taskTimeoutMinutes  ?? 30) * 60 * 1_000;
      const checkInMs  = (settings.taskCheckInMinutes  ?? 20) * 60 * 1_000;
      const taskStartTime = Date.now();

      const found = () => {
        const updated = parseTodo(todoPath);
        // Match by LINE NUMBER — not text — to avoid false positives when multiple
        // tasks share the same wording (e.g. two "cool game" entries).
        const byLine = updated.find(t => t.line === task.line);
        if (!byLine) { return true; }                  // line gone from file — treat as done
        if (byLine.status === 'done') { return true; } // [x] confirmed at that exact line
        return false;                                  // still [ ] or [~] — keep waiting
      };

      // Check immediately (AI might have already edited the file)
      if (found()) { resolve(); return; }

      let poller: NodeJS.Timeout | undefined;
      let timer: NodeJS.Timeout | undefined;
      let stdoutWatcherRef: vscode.Disposable | undefined;

      const cleanup = (watcher: vscode.Disposable) => {
        this._taskCompletionAbort = null;
        clearTimeout(timer);
        clearInterval(poller);
        watcher.dispose();
        stdoutWatcherRef?.dispose();
        stdoutWatcherRef = undefined;
        this._cb?.onActivityChange?.(undefined);
      };

      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(path.dirname(todoPath), path.basename(todoPath))
      );
      this._taskWatcher = watcher;

      const check = () => {
        if (this._state !== 'running') { cleanup(watcher); resolve(); return; }
        if (found()) { cleanup(watcher); resolve(); }
      };

      // Per-provider stdout capture file (only used for CLI providers)
      const activeProvider = this._cb?.getActiveProvider() ?? 'unknown';
      const resolvedStdoutFile = this._workspaceRoot
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

      // Check stdout file: forward any new content to Discord/webhook, detect rate limit
      const checkStdout = () => {
        if (!isClaudeCli) { return; } // only Claude CLI pipes to this file
        const content = readStdoutFile();

        // Forward new output lines to Discord / webhook
        if (content.length > lastStdoutLen) {
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
        }

        // Rate limit detection
        if (content.includes('hit your limit') || content.toLowerCase().includes('rate limit')) {
          cleanup(watcher);
          reject(new RateLimitError(content.trim(), parseRateLimitResetTime(content)));
        }
      };

      // Register abort hook so stop() can resolve this immediately
      this._taskCompletionAbort = () => { cleanup(watcher); resolve(); };

      // Watch the per-provider stdout capture file for instant rate-limit detection
      const stdoutDir = this._workspaceRoot
        ? path.join(this._workspaceRoot, '.autodev', 'output')
        : path.dirname(todoPath);
      const stdoutWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(stdoutDir, `${activeProvider}.txt`)
      );
      stdoutWatcherRef = stdoutWatcher;
      stdoutWatcher.onDidChange(checkStdout);
      stdoutWatcher.onDidCreate(checkStdout);

      // File watcher — fires on change/create events
      watcher.onDidChange(check);
      watcher.onDidCreate(check);

      // Inactivity-based check-in: track Claude JSONL byte size every 3 s.
      // After 15 minutes of silence (no new bytes), send the TODO.md reminder.
      // Resets when Claude writes again so we don't spam.
      const INACTIVITY_MS = 15 * 60 * 1_000;
      let endTurnSeen = false;
      let lastJSONLSize = claudeCursor > 0 && this._workspaceRoot
        ? getClaudeSessionCursor(this._workspaceRoot) : 0;
      let lastActivityTime = Date.now();
      let reminderPending = true; // allow one reminder per quiet period
      let lastActivity: string | undefined;

      poller = setInterval(async () => {
        check();

        if (!this._workspaceRoot) { return; }

        // Parse rich JSONL state: end_turn, active tool, bash progress
        if (claudeCursor > 0) {
          const sessionState = parseClaudeStateSince(this._workspaceRoot, claudeCursor);

          // end_turn detection — fast-path on Linux where inotify can lag
          if (!endTurnSeen && sessionState.hasEndTurn) {
            endTurnSeen = true;
            this._cb?.log('end_turn detected in Claude JSONL — checking TODO.md');
            setTimeout(check, 800);
            setTimeout(check, 2_500);
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
            cleanup(watcher);
            reject(new RateLimitError(
              sessionState.rateLimitMessage,
              parseRateLimitResetTime(sessionState.rateLimitMessage),
            ));
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
        const reminder = [
          `Reminder: when you are done with the task, mark it done in TODO.md.`,
          ``,
          `Change the line:`,
          `  - [~] ${task.text}`,
          `to exactly:`,
          `  - [x] ${date}  ${task.text}`,
          ``,
          `(two spaces between the date and task text, lowercase x, save the file)`,
          `If you have already finished, do this now.`,
        ].join('\n');
        this._cb?.log(`⚠️ Check-in: reminding AI to mark TODO.md (${elapsedMin}m, JSONL quiet for 3m)`);
        try { await this._cb!.sendToAi(reminder, task.text, true); } catch { /* ignore */ }
      }, 3_000);

      // Hard timeout
      timer = setTimeout(() => {
        cleanup(watcher);
        const minutes = settings.taskTimeoutMinutes ?? 30;
        if (settings.retryOnTimeout) {
          try { resetToTodo(todoPath, task); } catch { /* ignore */ }
          const msg = `⏱ Task timed out after ${minutes}m — retrying: ${discordLabel(task.text)}`;
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
          reject(new Error(`Task timed out after ${minutes} minutes`));
        }
      }, timeoutMs);
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
    } else if (s.discordWebhookUrl) {
      sendDiscordWebhook(s.discordWebhookUrl, message);
    }
  }
}

/** Singleton runner — one loop per workspace session. */
export const taskLoopRunner = new TaskLoopRunner();
