import { exec } from 'child_process';

// ---------------------------------------------------------------------------
// OpenCode CLI command builder
// ---------------------------------------------------------------------------

/**
 * Build the shell command string for the opencode-cli provider.
 * Prompt is passed as a positional argument (stdin redirect for large prompts).
 * Output is tee-d to sessionOutFile for session ID capture.
 */
export function buildOpenCodeCliCommand(
  promptFile: string,
  sessionOutFile: string,
  sessionId?: string,
): string {
  const isWin = process.platform === 'win32';
  const fileArg = JSON.stringify(promptFile);
  const posArg = isWin ? `(Get-Content ${fileArg} -Raw)` : `"$(cat ${fileArg})"`;
  const tee = isWin
    ? ` | Tee-Object ${JSON.stringify(sessionOutFile)}`
    : ` | tee ${JSON.stringify(sessionOutFile)}`;
  const session = sessionId ? ` --session ${sessionId}` : '';
  return `opencode run${session} ${posArg}${tee}`;
}

/**
 * Run a tiny probe prompt via Node exec to obtain an opencode-cli session ID
 * before the main prompt runs. Extracts "sessionID" from JSON event stream.
 */
export function probeOpenCodeSession(
  cwd: string,
  log: (msg: string) => void,
): Promise<string | undefined> {
  return new Promise(resolve => {
    const cmd = `opencode run "."` ;
    log(`OpenCode CLI probe: ${cmd}`);
    exec(cmd, { cwd, encoding: 'utf8', timeout: 30000 }, (_err, stdout) => {
      const id = (stdout ?? '').match(/"sessionID"\s*:\s*"([^"]+)"/)?.[1];
      log(`OpenCode CLI probe result: ${id ?? 'no session ID found'}`);
      resolve(id);
    });
  });
}
