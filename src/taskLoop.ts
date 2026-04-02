import * as vscode from 'vscode';
import * as path from 'path';
import { parseTodo, pickNextTask, markInProgress, countRemaining, Task } from './todo';
import { buildPrompt } from './prompt';
import { sendWebhook, sendDiscordWebhook } from './webhook';
import { loadSettings, AutodevSettings } from './settings';

// ---------------------------------------------------------------------------
// TaskLoopRunner — mirrors PHP Loop.php
// ---------------------------------------------------------------------------

export type LoopState = 'idle' | 'running' | 'stopping';

export interface LoopCallbacks {
  /** Send a raw prompt string to the active AI provider */
  sendToAi: (prompt: string, taskLabel: string) => Promise<void>;
  /** Append a message to the extension's output channel */
  log: (msg: string) => void;
  /** Called whenever the loop state changes so the sidebar can refresh */
  onStatusChange: (state: LoopState, currentTask?: string) => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class TaskLoopRunner {
  private _state: LoopState = 'idle';
  private _currentTask: string | undefined;
  private _taskWatcher: vscode.Disposable | undefined;
  private _iterations = 0;
  private _cb: LoopCallbacks | undefined;

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

    const todoPath = settings.todoPath || path.join(root, 'TODO.md');
    const autodevPath = settings.profilePath || path.join(root, 'AUTODEV.md');

    callbacks.log(`Task loop starting — TODO: ${todoPath}`);
    this._notifyWebhook(settings, 'loop_start');
    this._notifyDiscord(settings, '🚀 AutoDev task loop started');

    try {
      await this._runLoop(todoPath, autodevPath, settings);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      callbacks.log(`Task loop error: ${msg}`);
    }

    this._currentTask = undefined;
    this._setState('idle');
    callbacks.log('Task loop stopped');
  }

  stop(): void {
    if (this._state !== 'running') { return; }
    this._setState('stopping');
    this._disposeWatcher();
    this._cb?.log('Task loop stop requested…');
  }

  // -------------------------------------------------------------------------

  private async _runLoop(todoPath: string, autodevPath: string, settings: AutodevSettings): Promise<void> {
    while (this._state === 'running') {
      if (this._iterations >= settings.maxIterations) {
        this._cb?.log(`Max iterations (${settings.maxIterations}) reached`);
        break;
      }

      const tasks = parseTodo(todoPath);
      const task = pickNextTask(tasks);

      if (!task) {
        const remaining = countRemaining(tasks);
        if (remaining === 0) {
          this._cb?.log('All tasks completed ✓');
          this._notifyWebhook(settings, 'all_tasks_done');
          this._notifyDiscord(settings, '✅ All tasks done!');
        }
        this._cb?.log(`No pending tasks — waiting ${settings.loopInterval}s…`);
        await sleep(settings.loopInterval * 1000);
        continue;
      }

      this._iterations++;
      this._currentTask = task.text;
      this._setState('running', task.text);

      // Mark in-progress before sending to AI
      try { markInProgress(todoPath, task); } catch { /* file may not be writable yet */ }

      const prompt = buildPrompt(task, path.dirname(todoPath), autodevPath);
      const remaining = countRemaining(parseTodo(todoPath));

      this._cb?.log(`▶ Task [${this._iterations}]: ${task.text}`);
      this._notifyWebhook(settings, 'task_start', { task: task.text, remaining });
      this._notifyDiscord(settings, `▶️ **Task started** (${remaining} remaining):\n${task.text}`);

      try {
        // Send to AI
        await this._cb!.sendToAi(prompt, task.text);

        // Wait for the AI to mark the task [x] done in TODO.md
        await this._waitForTaskCompletion(todoPath, task);

        const afterTasks = parseTodo(todoPath);
        const afterRemaining = countRemaining(afterTasks);
        this._cb?.log(`✅ Task done: ${task.text}`);
        this._notifyWebhook(settings, 'task_done', { task: task.text, remaining: afterRemaining });
        this._notifyDiscord(settings, `✅ **Task done** (${afterRemaining} remaining):\n${task.text}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this._cb?.log(`❌ Task failed: ${task.text} — ${msg}`);
        this._notifyWebhook(settings, 'task_failed', { task: task.text, error: msg });
        this._notifyDiscord(settings, `❌ **Task failed:**\n${task.text}\n\`${msg}\``);
        // Continue to next task rather than stopping the loop
      }

      this._currentTask = undefined;
    }
  }

  /** Return when the task text appears with [x] status in the TODO.md file. */
  private _waitForTaskCompletion(todoPath: string, task: Task): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this._state !== 'running') { resolve(); return; }

      const found = () => {
        const updated = parseTodo(todoPath);
        return updated.some(t => t.text === task.text && t.status === 'done');
      };

      // Check immediately (AI might have already edited the file)
      if (found()) { resolve(); return; }

      const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes per task
      const timer = setTimeout(() => {
        this._disposeWatcher();
        reject(new Error('Task timed out after 30 minutes'));
      }, TIMEOUT_MS);

      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(path.dirname(todoPath), path.basename(todoPath))
      );
      this._taskWatcher = watcher;

      const check = () => {
        if (this._state !== 'running') {
          clearTimeout(timer);
          watcher.dispose();
          resolve();
          return;
        }
        if (found()) {
          clearTimeout(timer);
          watcher.dispose();
          resolve();
        }
      };

      watcher.onDidChange(check);
      watcher.onDidCreate(check);
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

  private _notifyWebhook(settings: AutodevSettings, event: Parameters<typeof sendWebhook>[1], extra?: Parameters<typeof sendWebhook>[2]): void {
    if (settings.webhookUrl) {
      sendWebhook(settings.webhookUrl, event, extra);
    }
  }

  private _notifyDiscord(settings: AutodevSettings, message: string): void {
    if (settings.discordWebhookUrl) {
      sendDiscordWebhook(settings.discordWebhookUrl, message);
    }
  }
}

/** Singleton runner — one loop per workspace session. */
export const taskLoopRunner = new TaskLoopRunner();
