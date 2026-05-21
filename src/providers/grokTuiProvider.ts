// ---------------------------------------------------------------------------
// grokTuiProvider -- long-running Grok sessions via the grok CLI.
//
// Grok is invoked in single-turn headless mode:
//
//   grok -m <model> --always-approve --cwd <root> --prompt-file <file>
//
// The first turn creates a new session under ~/.grok/sessions/<encoded-cwd>/.
// Subsequent turns add `-c` (--continue) to resume that session so the agent
// retains context across tasks.
//
// No terminal is spawned — all I/O goes through the extension-host process.
// Mirrors the claude-tui / opencode-sdk provider pattern.
//
// Default model: sxs-claude-opus-4-6 (Claude-family model available in grok).
// Override via settings.grokModel.
// ---------------------------------------------------------------------------

import * as fs from 'fs';
import * as child_process from 'child_process';
import { RateLimitDetector } from '../rateLimit';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default model (Claude-family). Override via settings.grokModel. */
export const GROK_DEFAULT_MODEL = 'sxs-claude-opus-4-6';

/** Path to the grok binary — use env override for non-default installs. */
const GROK_BIN = process.env['GROK_BIN'] ?? 'grok';

// ---------------------------------------------------------------------------
// Per-workspace state
// ---------------------------------------------------------------------------

/** True once grok has run at least one turn for this root (enables -c on next turn). */
const _hasSession = new Set<string>();

/** Roots with an actively-running grok turn. */
const _busyRoots = new Set<string>();

/** True while a grok-tui turn is running for the given workspace root. */
export function isGrokTuiBusy(root: string): boolean {
  return _busyRoots.has(root);
}

// ---------------------------------------------------------------------------
// sendGrokTuiPrompt
//
// Fire-and-forget: reads the combined prompt file, passes it to grok via
// --prompt-file, streams stdout to stdoutFile, writes exit code to exitFile.
// ---------------------------------------------------------------------------
export function sendGrokTuiPrompt(
  root: string,
  /** Absolute path to the combined agent-profile + message file. */
  promptFilePath: string,
  stdoutFile: string,
  exitFile: string,
  log: (msg: string) => void,
  model?: string,
  /** Optional callback invoked once to reveal the output panel to the user. */
  showOutput?: () => void,
): void {
  showOutput?.();

  const resolvedModel = model || GROK_DEFAULT_MODEL;
  const useContinue = _hasSession.has(root);

  const args: string[] = [
    '-m', resolvedModel,
    '--always-approve',
    '--cwd', root,
    '--prompt-file', promptFilePath,
  ];
  if (useContinue) {
    args.push('-c');
  }

  log(`Grok TUI: spawning (model=${resolvedModel}, continue=${useContinue})`);
  log(`Grok TUI: ${GROK_BIN} ${args.join(' ')}`);

  try { fs.writeFileSync(stdoutFile, '', 'utf8'); } catch { /* ignore */ }
  try { fs.writeFileSync(exitFile,   '', 'utf8'); } catch { /* ignore */ }

  _busyRoots.add(root);

  let child: child_process.ChildProcess;
  try {
    child = child_process.spawn(GROK_BIN, args, {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });
  } catch (spawnErr) {
    const msg = (spawnErr as Error)?.message ?? String(spawnErr);
    log(`Grok TUI spawn error: ${msg}`);
    try { fs.appendFileSync(stdoutFile, `\n[Grok spawn error: ${msg}]\n`, 'utf8'); } catch { /* ignore */ }
    try { fs.writeFileSync(exitFile, '1\n', 'utf8'); } catch { /* ignore */ }
    _busyRoots.delete(root);
    return;
  }

  let lineBuf = '';

  function flushLine(force = false) {
    let nl: number;
    while ((nl = lineBuf.indexOf('\n')) !== -1) {
      const line = lineBuf.slice(0, nl).replace(/\r$/, '');
      lineBuf = lineBuf.slice(nl + 1);
      if (line) { log(`  ${line}`); }
    }
    if (force && lineBuf.trim()) {
      log(`  ${lineBuf}`);
      lineBuf = '';
    }
  }

  child.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    try { fs.appendFileSync(stdoutFile, text, 'utf8'); } catch { /* ignore */ }
    lineBuf += text;
    flushLine();
  });

  child.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8').trim();
    if (text) { log(`Grok TUI stderr: ${text}`); }
  });

  child.on('error', (err) => {
    const msg = err.message;
    log(`Grok TUI process error: ${msg}`);
    try { fs.appendFileSync(stdoutFile, `\n[Grok error: ${msg}]\n`, 'utf8'); } catch { /* ignore */ }
    try { fs.writeFileSync(exitFile, '1\n', 'utf8'); } catch { /* ignore */ }
    _busyRoots.delete(root);
  });

  child.on('close', (code) => {
    flushLine(true);
    const exitCode = code ?? 1;
    log(`Grok TUI: process exited (code=${exitCode})`);
    try { fs.writeFileSync(exitFile, `${exitCode}\n`, 'utf8'); } catch { /* ignore */ }

    if (exitCode === 0) {
      // Mark session as started so next turn uses -c (session continuation).
      _hasSession.add(root);
    }

    _busyRoots.delete(root);
  });
}

// ---------------------------------------------------------------------------
// closeGrokTuiSession
//
// Forget the session state for a workspace root so the next turn starts fresh.
// ---------------------------------------------------------------------------
export function closeGrokTuiSession(root: string, log: (msg: string) => void): void {
  if (_hasSession.has(root)) {
    log('Grok TUI: clearing session state (next task starts fresh)');
    _hasSession.delete(root);
  }
}

/** Reset all sessions — called on extension deactivate. */
export function closeAllGrokTuiSessions(): void {
  _hasSession.clear();
  _busyRoots.clear();
}

// ---------------------------------------------------------------------------
// detectGrokTuiRateLimit
// ---------------------------------------------------------------------------
export function detectGrokTuiRateLimit(stdoutContent: string): ReturnType<typeof RateLimitDetector.detect> {
  return RateLimitDetector.detect(stdoutContent);
}
