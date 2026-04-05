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
  // Concatenate both files via shell expansion
  const sep = isWin ? ' + [System.Environment]::NewLine + [System.Environment]::NewLine + ' : '';
  const content = isWin
    ? `((Get-Content ${profileArg} -Raw)${sep}(Get-Content ${msgArg} -Raw))`
    : `"$(cat ${profileArg})\n\n$(cat ${msgArg})"`;
  return `opencode run${session} ${content}`;
}

/**
 * Run a tiny probe prompt via Node exec to obtain an opencode-cli session ID.
 * Uses --format json so sessionID appears in every event line.
 */
export function probeOpenCodeSession(
  cwd: string,
  log: (msg: string) => void,
): Promise<string | undefined> {
  return new Promise(resolve => {
    const cmd = `opencode run --format json "."` ;
    log(`OpenCode CLI probe: ${cmd}`);
    exec(cmd, { cwd, encoding: 'utf8', timeout: 30000 }, (_err, stdout) => {
      const id = (stdout ?? '').match(/"sessionID"\s*:\s*"(ses_[^"]+)"/)?.[1];
      log(`OpenCode CLI probe result: ${id ?? 'no session ID found'}`);
      resolve(id);
    });
  });
}
