import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { parseTodo, pickNextTask, markInProgress, countRemaining, resetAllInProgress, resetToTodo, Task } from './todo';
import { buildPrompt } from './prompt';
import { WebhookClient, WebhookEvent, sendDiscordBotMessage, sendDiscordWebhook } from './webhook';
import { loadSettings, AutodevSettings } from './settings';
import { getClaudeSessionCursor, parseClaudeStateSince, findLatestClaudeSession } from './dispatcher';
import { captureAndSaveSessionId } from './sessionState';
import { PROVIDERS, ProviderId } from './providers';
import { DiscordPoller } from './discordPoller';
import { WebhookPoller } from './webhookPoller';

// ---------------------------------------------------------------------------
// TaskLoopRunner — mirrors PHP Loop.php
// ---------------------------------------------------------------------------

export type LoopState = 'idle' | 'running' | 'stopping';

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
  private _gitRepo: string = '';
  private _gitBranch: string = '';
  private _hostname: string = '';
  private _completedCount = 0;
  private _failedCount = 0;
  private _loopStartTime = 0;

  get state(): LoopState { return this._state; }
  get currentTask(): string | undefined { return this._currentTask; }

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
    if (this._state !== 'running') { return; }
    this._setState('stopping');
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
        if (remaining === 0 && !allTasksDoneNotified) {
          allTasksDoneNotified = true;
          this._cb?.log('All tasks completed ✓');
          this._notifyWebhook('all_tasks_done', {
            workDir:   this._workspaceRoot,
            gitRepo:   this._gitRepo,
            gitBranch: this._gitBranch,
          });
          this._notifyDiscord('✅ All tasks done!');
        }
        this._cb?.log(`No pending tasks — waiting ${settings.loopInterval}s…`);
        await sleep(settings.loopInterval * 1000);
        continue;
      }

      // A task is available — reset the all-done flag
      allTasksDoneNotified = false;

      this._iterations++;
      this._currentTask = task.text;
      this._setState('running', task.text);

      // Mark in-progress before sending to AI
      try { markInProgress(todoPath, task); } catch { /* file may not be writable yet */ }

      const prompt = buildPrompt(task, path.dirname(todoPath), autodevPath);
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
        // Without this delay a partial write can make the task look pending again
        // and the loop picks it up a second time (race condition).
        await sleep(2_000);

        // Capture and persist CLI session ID so the next task can resume it
        const activeProvider = this._cb?.getActiveProvider();
        if (this._workspaceRoot && activeProvider && PROVIDERS[activeProvider]?.isCli) {
          const jsonlFallback = activeProvider === 'claude-cli'
            ? findLatestClaudeSession(this._workspaceRoot)
            : undefined;
          captureAndSaveSessionId(this._workspaceRoot, activeProvider, jsonlFallback);
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

  /** Return when the task text appears with [x] status in the TODO.md file. */
  private _waitForTaskCompletion(todoPath: string, task: Task, claudeCursor = 0): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this._state !== 'running') { resolve(); return; }

      const settings = this._settings!;
      const timeoutMs  = (settings.taskTimeoutMinutes  ?? 30) * 60 * 1_000;
      const checkInMs  = (settings.taskCheckInMinutes  ?? 20) * 60 * 1_000;
      const taskStartTime = Date.now();

      const found = () => {
        const updated = parseTodo(todoPath);
        const match = updated.find(t => t.text === task.text);
        // Require the task to be explicitly marked [x] done (or removed from the file).
        // A task that reverted to [ ] pending means Claude is still mid-write — keep waiting.
        if (!match) { return true; }               // completely removed — treat as done
        if (match.status === 'done') { return true; } // [x] confirmed
        return false;                               // still in-progress or partial write
      };

      // Check immediately (AI might have already edited the file)
      if (found()) { resolve(); return; }

      let poller: NodeJS.Timeout | undefined;
      let timer: NodeJS.Timeout | undefined;

      const cleanup = (watcher: vscode.Disposable) => {
        this._taskCompletionAbort = null;
        clearTimeout(timer);
        clearInterval(poller);
        watcher.dispose();
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

      // Register abort hook so stop() can resolve this immediately
      this._taskCompletionAbort = () => { cleanup(watcher); resolve(); };

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
        }

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
