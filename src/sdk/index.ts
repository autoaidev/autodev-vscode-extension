import { TaskLoopRunner } from '../taskLoop';
import { sendPromptToAi } from '../dispatcher';
import { NodeFileWatcher, NodeProcessLauncher } from '../core/adapters';
import { ProviderId } from '../providers';

// ---------------------------------------------------------------------------
// AutoDev standalone SDK — use without VS Code.
// ---------------------------------------------------------------------------

export interface LoopStartOptions {
  /** AI provider to use (default: 'claude-cli') */
  provider?: ProviderId;
  /** Absolute path to the workspace / project root (default: process.cwd()) */
  cwd?: string;
  /** Logger (default: console.log) */
  log?: (msg: string) => void;
}

class LoopApi {
  private _runner = new TaskLoopRunner();

  async start(options: LoopStartOptions = {}): Promise<void> {
    const root = options.cwd ?? process.cwd();
    const launcher = new NodeProcessLauncher();
    const log = options.log ?? console.log;
    await this._runner.start({
      workspaceRoot: root,
      fileWatcher: new NodeFileWatcher(),
      sendToAi: (prompt, _label, includeProfile, messageFile) =>
        sendPromptToAi(options.provider ?? 'claude-cli', prompt, log, launcher, root, includeProfile, messageFile),
      log,
      getActiveProvider: () => options.provider ?? 'claude-cli',
      onStatusChange: () => {},
    });
  }

  stop(): void {
    this._runner.stop();
  }
}

export const AutoDev = {
  loop: new LoopApi(),
};
