import { exec } from 'child_process';

// ---------------------------------------------------------------------------
// OpenCode CLI command builder
// ---------------------------------------------------------------------------

/**
 * Build the shell command string for the opencode-cli provider.
 * Accepts a pre-combined file written by the dispatcher and passes it as a
 * single `@file` reference so opencode reads it directly.
 */
export function buildOpenCodeCliCommand(
  combinedFile: string,
  sessionId?: string,
): string {
  const session = sessionId ? ` -s ${sessionId}` : ' -c';
  const fileRef = JSON.stringify(`@${combinedFile}`);
  return `opencode run${session} ${fileRef}`;
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
