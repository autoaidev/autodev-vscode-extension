import { exec } from 'child_process';

// ---------------------------------------------------------------------------
// OpenCode CLI command builder
// ---------------------------------------------------------------------------

/**
 * Build the shell command string for the opencode-cli provider.
 * Uses `@file` references (like Claude CLI) so the full file content is NOT
 * inlined into the shell argument — opencode reads the files itself.
 * When includeProfile is false (subsequent tasks in a resumed session) only
 * the message file is passed, keeping the prompt small.
 */
export function buildOpenCodeCliCommand(
  agentProfileFile: string,
  messageFile: string,
  sessionId?: string,
  includeProfile = true,
): string {
  const session = sessionId ? ` -s ${sessionId}` : ' -c';
  const msgRef = JSON.stringify(`@${messageFile}`);
  if (includeProfile) {
    const profileRef = JSON.stringify(`@${agentProfileFile}`);
    return `opencode run${session} ${profileRef} ${msgRef}`;
  }
  return `opencode run${session} ${msgRef}`;
}

/**
 * Get the latest OpenCode session ID for this workspace directory by querying
 * `opencode session list`. No tokens consumed — purely a metadata read.
 */
export function getLatestOpenCodeSessionId(
  cwd: string,
  log: (msg: string) => void,
): Promise<string | undefined> {
  return new Promise(resolve => {
    exec('opencode session list -n 5 --format json', { cwd, encoding: 'utf8', timeout: 10000 }, (_err, stdout) => {
      try {
        const sessions = JSON.parse(stdout ?? '[]') as Array<{ id: string; directory: string; updated: number }>;
        const cwdNorm = cwd.toLowerCase().replace(/\\/g, '/').replace(/\/$/, '');
        const match = sessions
          .filter(s => s.directory.toLowerCase().replace(/\\/g, '/').replace(/\/$/, '') === cwdNorm)
          .sort((a, b) => b.updated - a.updated)[0];
        const id = match?.id;
        log(`OpenCode session list: ${id ?? 'none found for this directory'}`);
        resolve(id);
      } catch {
        resolve(undefined);
      }
    });
  });
}

/**
 * Run `/compact` on an existing OpenCode session to summarise conversation
 * history and free up context window space.  Returns a promise that resolves
 * when the compact command exits (success or failure — caller decides whether
 * to treat an error as fatal).
 */
export function runOpenCodeCompact(
  sessionId: string,
  cwd: string,
  log: (msg: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cmd = `opencode run -s ${sessionId} /compact`;
    log(`OpenCode compact: ${cmd}`);
    exec(cmd, { cwd, encoding: 'utf8', timeout: 120_000 }, (err) => {
      if (err) { reject(err); } else { resolve(); }
    });
  });
}
