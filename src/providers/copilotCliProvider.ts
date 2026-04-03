import { exec } from 'child_process';

// ---------------------------------------------------------------------------
// Copilot CLI command builder
// ---------------------------------------------------------------------------

/**
 * Build the shell command string for the copilot-cli provider.
 * Passes @file so Copilot CLI reads the prompt file itself — avoids shell
 * argument splitting and Unicode corruption from Tee-Object piping.
 *
 * Resume behaviour:
 *   - sessionId provided  → --resume <id>  (specific session from probe)
 *   - neither             → fresh session
 */
export function buildCopilotCliCommand(
  promptFile: string,
  sessionId?: string,
): string {
  const resumeFlag = sessionId ? ` --resume ${sessionId}` : '';
  const promptRefArg = `-p ${JSON.stringify(`@${promptFile}`)}`;
  return `copilot --autopilot --yolo --no-ask-user --allow-all --no-auto-update --allow-all-paths --allow-all-urls --allow-all-tools --enable-all-github-mcp-tools --stream on --no-color --max-autopilot-continues 2000${resumeFlag} ${promptRefArg}`;
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
