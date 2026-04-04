import { exec } from 'child_process';

// ---------------------------------------------------------------------------
// OpenCode CLI command builder
// ---------------------------------------------------------------------------

/**
 * Build the shell command string for the opencode-cli provider.
 * `opencode run` takes the message as positional [message..] args — there is
 * no --prompt flag on `run` (only on `tui`).
 * The file content is read inline: PowerShell (Get-Content "file" -Raw) or
 * bash "$(cat 'file')" — both are evaluated by the shell before opencode sees them.
 * --format json emits newline-delimited JSON events containing sessionID.
 * Caller is responsible for piping to a Tee file for session ID capture.
 */
export function buildOpenCodeCliCommand(
  promptFile: string,
  sessionId?: string,
): string {
  const fileArg = JSON.stringify(promptFile);
  const session = sessionId ? ` -s ${sessionId}` : ' -c';
  const isWin = process.platform === 'win32';
  // Positional [message..] — no --prompt flag on `opencode run`.
  // PowerShell: (Get-Content "file" -Raw) is a subexpression, no surrounding quotes.
  // Bash: "$(cat 'file')" — same effect.
  const msgArg = isWin
    ? `(Get-Content ${fileArg} -Raw)`
    : `"$(cat ${fileArg})"`;
  return `opencode run${session} ${msgArg}`;
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
