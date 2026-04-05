import { exec } from 'child_process';

// ---------------------------------------------------------------------------
// OpenCode CLI command builder
// ---------------------------------------------------------------------------

/**
 * Build the shell command string for the opencode-cli provider.
 * `opencode run` takes the message as positional [message..] args — there is
 * no --prompt flag or @file syntax on `run`.
 * We concatenate both files via shell expansion so opencode receives the
 * full combined content as its message argument.
 */
export function buildOpenCodeCliCommand(
  agentProfileFile: string,
  messageFile: string,
  sessionId?: string,
): string {
  const profileArg = JSON.stringify(agentProfileFile);
  const msgArg = JSON.stringify(messageFile);
  const session = sessionId ? ` -s ${sessionId}` : ' -c';
  const isWin = process.platform === 'win32';
  if (isWin) {
    // Assign to a local variable first — passing an inline expression directly to opencode
    // causes PowerShell to split the multi-line result into separate args.
    const concat = `(Get-Content ${profileArg} -Raw) + "\`n\`n" + (Get-Content ${msgArg} -Raw)`;
    return `$autodev_msg=${concat}; opencode run${session} $autodev_msg`;
  }
  return `opencode run${session} "$(cat ${profileArg})\n\n$(cat ${msgArg})"`;
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
