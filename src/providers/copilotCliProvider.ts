import { exec } from 'child_process';

// ---------------------------------------------------------------------------
// Copilot CLI command builder
// ---------------------------------------------------------------------------

/**
 * Build the shell command string for the copilot-cli provider.
 * The combined prompt has already been written to `promptFile` by the caller.
 * We pass it as `@<path>` so copilot reads the file — one clean line, no
 * shell quoting issues with multi-line content.
 *
 * Resume behaviour:
 *   - sessionId provided  → --resume <id>
 *   - neither             → fresh session
 */
export function buildCopilotCliCommand(
  promptFile: string,
  sessionId?: string,
): string {
  const resumeFlag = sessionId ? ` --resume ${sessionId}` : '';
  const flags = `--autopilot --yolo --no-ask-user --allow-all --no-auto-update --allow-all-paths --allow-all-urls --allow-all-tools --enable-all-github-mcp-tools --stream on --no-color --max-autopilot-continues 2000${resumeFlag}`;
  return `copilot ${flags} -p "@${promptFile}"`;
}

/**
 * Run a tiny probe prompt against Copilot CLI (via Node exec, not the terminal)
 * and extract the session ID from the JSON output.
 * Used to obtain a real session ID before sending the main prompt.
 */
export function probeCopilotSession(
  cwd: string,
  log: (msg: string) => void,
): Promise<string | undefined> {
  return new Promise(resolve => {
    const cmd = `copilot --yolo --allow-all --allow-all-paths --allow-all-urls --allow-all-tools --output-format json -p "session-init"`;
    log(`Copilot CLI probe: ${cmd}`);
    exec(cmd, { cwd, encoding: 'utf8', timeout: 30000 }, (_err, stdout) => {
      const match = (stdout ?? '').match(/"sessionId"\s*:\s*"([^"]+)"/);
      const id = match?.[1];
      log(`Copilot CLI probe result: ${id ?? 'no session ID found'}`);
      resolve(id);
    });
  });
}
