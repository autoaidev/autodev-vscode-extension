// ---------------------------------------------------------------------------
// grokTuiProvider -- Grok sessions via `grok agent stdio` (ACP/JSON-RPC).
//
// Uses the ACP (Agent Communication Protocol) over JSON-RPC on stdin/stdout:
//
//   grok -m <model> agent stdio
//
// Each task gets a FRESH session (no -c accumulation) which prevents the
// context from filling up across tasks and triggering auto-compaction.
//
// Flow per task:
//   initialize → authenticate → session/new → /always-approve on → session/prompt
//
// agent_message_chunk events are streamed to stdoutFile.  The exitFile is
// written only when session/prompt resolves (task fully complete).
//
// Default model: sxs-claude-opus-4-6 (Claude-family). Override via settings.grokModel.
// ---------------------------------------------------------------------------

import * as fs from 'fs';
import * as readline from 'readline';
import * as child_process from 'child_process';
import { RateLimitDetector } from '../rateLimit';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default model. Override via settings.grokModel. */
export const GROK_DEFAULT_MODEL = 'sxs-claude-opus-4-6';

/** Path to the grok binary — use env override for non-default installs. */
const GROK_BIN = process.env['GROK_BIN'] ?? 'grok';

// ---------------------------------------------------------------------------
// Per-workspace state
// ---------------------------------------------------------------------------

/** True if the root has a live grok session that can be resumed. */
const _hasSession = new Set<string>();

/** Last sessionId per workspace root — enables session/load (resume) on next task. */
const _sessionIds = new Map<string, string>();

/** Roots with an actively-running grok turn. */
const _busyRoots = new Set<string>();

/** Active child processes by root — used to kill them on extension deactivate. */
const _activeChildren = new Map<string, child_process.ChildProcess>();

/** True while a grok ACP turn is running for the given workspace root. */
export function isGrokTuiBusy(root: string): boolean {
  return _busyRoots.has(root);
}

// ---------------------------------------------------------------------------
// sendGrokTuiPrompt
//
// Fire-and-forget: reads the combined prompt file, sends it via ACP, streams
// agent_message_chunk events to stdoutFile, writes exit code to exitFile.
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
  log(`Grok ACP: spawning (model=${resolvedModel})`);

  try { fs.writeFileSync(stdoutFile, '', 'utf8'); } catch { /* ignore */ }
  try { fs.writeFileSync(exitFile,   '', 'utf8'); } catch { /* ignore */ }

  _busyRoots.add(root);

  let child: child_process.ChildProcess;
  try {
    // Pass -m flag before the `agent stdio` subcommand to select the model.
    child = child_process.spawn(GROK_BIN, ['-m', resolvedModel, 'agent', 'stdio'], {
      cwd: root,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    _activeChildren.set(root, child);
  } catch (spawnErr) {
    const msg = (spawnErr as Error)?.message ?? String(spawnErr);
    log(`Grok ACP spawn error: ${msg}`);
    try { fs.appendFileSync(stdoutFile, `\n[Grok spawn error: ${msg}]\n`, 'utf8'); } catch { /* ignore */ }
    try { fs.writeFileSync(exitFile, '1\n', 'utf8'); } catch { /* ignore */ }
    _busyRoots.delete(root);
    return;
  }

  // -------------------------------------------------------------------------
  // JSON-RPC dispatcher
  // -------------------------------------------------------------------------
  const pending = new Map<number, { resolve: (r: any) => void; reject: (e: Error) => void }>();
  let nextId = 1;

  function request(method: string, params: unknown, timeoutMs = 30_000): Promise<any> {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      pending.set(id, {
        resolve(result: any)  { clearTimeout(timer); resolve(result); },
        reject(error: Error)  { clearTimeout(timer); reject(error); },
      });
      const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
      child.stdin?.write(msg);
    });
  }

  // -------------------------------------------------------------------------
  // Line-by-line stdout reader
  // -------------------------------------------------------------------------
  const rl = readline.createInterface({ input: child.stdout! });

  // Flag: only write to stdoutFile during the main task prompt (not always-approve turn).
  let mainPromptActive = false;

  rl.on('line', (line: string) => {
    let message: any;
    try { message = JSON.parse(line); } catch { return; }

    if (message.method === 'session/update') {
      const update = message.params?.update;
      if (update?.sessionUpdate === 'agent_message_chunk' && mainPromptActive && update.content?.text) {
        const chunk: string = update.content.text;
        try { fs.appendFileSync(stdoutFile, chunk, 'utf8'); } catch { /* ignore */ }
        const preview = chunk.replace(/\r?\n/g, ' ').trim().substring(0, 100);
        if (preview) { log(`  ${preview}`); }
      }
      return;
    }

    // Resolve/reject pending RPC calls — ignore string ids (e.g. "skills-reload").
    if (typeof message.id !== 'number') { return; }
    const pendingReq = pending.get(message.id as number);
    if (!pendingReq) { return; }
    pending.delete(message.id as number);
    if (message.error) {
      pendingReq.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
    } else {
      pendingReq.resolve(message.result ?? {});
    }
  });

  child.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8').trim();
    if (text) { log(`Grok ACP stderr: ${text}`); }
  });

  const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

  // -------------------------------------------------------------------------
  // ACP flow (async, fire-and-forget)
  // -------------------------------------------------------------------------
  async function run(): Promise<void> {
    try {
      // Read prompt file
      let promptContent: string;
      try {
        promptContent = fs.readFileSync(promptFilePath, 'utf8');
      } catch (readErr) {
        throw new Error(`Failed to read prompt file: ${(readErr as Error).message}`);
      }

      // 1. Initialize
      const init = await request('initialize', {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
      });
      log(`Grok ACP: initialized (agent v${init._meta?.agentVersion ?? '?'})`);

      // 2. Authenticate
      const authMethods = new Set<string>(
        ((init.authMethods ?? []) as Array<{ id: string }>).map(m => m.id),
      );
      const methodId: string | null =
        process.env['XAI_API_KEY'] && authMethods.has('xai.api_key') ? 'xai.api_key'
        : authMethods.has('cached_token')                            ? 'cached_token'
        : null;
      if (!methodId) {
        throw new Error('No valid auth method. Run `grok login` or set XAI_API_KEY.');
      }
      await request('authenticate', { methodId, _meta: { headless: true } });
      log('Grok ACP: authenticated');

      // 3. Resume existing session or start a fresh one.
      // session/load preserves task history (prior tool calls, context, outputs).
      // closeGrokTuiSession() clears _sessionIds[root] so the reset interval
      // in taskLoop.ts still forces a fresh session after N tasks.
      let sessionId: string;
      const existingId = _sessionIds.get(root);
      if (existingId) {
        try {
          const loaded = await request('session/load', { sessionId: existingId });
          sessionId = loaded.sessionId ?? existingId;
          log(`Grok ACP: resumed session ${sessionId}`);
        } catch (loadErr) {
          log(`Grok ACP: session/load failed (${(loadErr as Error).message}) — starting fresh`);
          const fresh = await request('session/new', { cwd: root, mcpServers: [], modelId: resolvedModel });
          sessionId = fresh.sessionId;
          log(`Grok ACP: new session ${sessionId}`);
        }
      } else {
        const fresh = await request('session/new', { cwd: root, mcpServers: [], modelId: resolvedModel });
        sessionId = fresh.sessionId;
        log(`Grok ACP: new session ${sessionId}`);
      }
      _sessionIds.set(root, sessionId);

      // 4. Enable always-approve (non-critical, continue on failure).
      try {
        await request('session/prompt', {
          sessionId,
          prompt: [{ type: 'text', text: '/always-approve on' }],
        }, 15_000);
      } catch (aaErr) {
        log(`Grok ACP: always-approve command failed (non-fatal): ${(aaErr as Error).message}`);
      }

      // 5. Main task prompt — reset stdoutFile so always-approve output is excluded.
      try { fs.writeFileSync(stdoutFile, '', 'utf8'); } catch { /* ignore */ }
      mainPromptActive = true;

      log(`Grok ACP: sending prompt (${promptContent.length} chars)`);
      const result = await request('session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text: promptContent }],
      }, 600_000); // 10 min
      log(`Grok ACP: prompt complete (stopReason=${result?.stopReason ?? 'unknown'})`);

      // 6. Wait for all chunks to flush to stdoutFile.
      let prevSize = -1, stable = 0;
      while (stable < 3) {
        await sleep(300);
        const stat = await fs.promises.stat(stdoutFile).catch(() => ({ size: 0 }));
        if (stat.size === prevSize) { stable++; } else { prevSize = stat.size; stable = 0; }
      }

      fs.writeFileSync(exitFile, '0\n', 'utf8');
      _hasSession.add(root);

    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      log(`Grok ACP error: ${msg}`);
      try { fs.appendFileSync(stdoutFile, `\n[Grok ACP error: ${msg}]\n`, 'utf8'); } catch { /* ignore */ }
      try { fs.writeFileSync(exitFile, '1\n', 'utf8'); } catch { /* ignore */ }
    } finally {
      rl.close();
      _activeChildren.delete(root);
      _busyRoots.delete(root);
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
    }
  }

  run();
}

// ---------------------------------------------------------------------------
// closeGrokTuiSession
// ---------------------------------------------------------------------------
export function closeGrokTuiSession(root: string, log: (msg: string) => void): void {
  if (_hasSession.has(root) || _sessionIds.has(root)) {
    log('Grok ACP: clearing session state (next task will start a fresh session)');
    _hasSession.delete(root);
    _sessionIds.delete(root);
  }
}

/** Reset all sessions — called on extension deactivate. */
export function closeAllGrokTuiSessions(): void {
  for (const child of _activeChildren.values()) {
    try { child.kill('SIGKILL'); } catch { /* ignore */ }
  }
  _activeChildren.clear();
  _hasSession.clear();
  _sessionIds.clear();
  _busyRoots.clear();
}

// ---------------------------------------------------------------------------
// detectGrokTuiRateLimit
// ---------------------------------------------------------------------------
export function detectGrokTuiRateLimit(stdoutContent: string): ReturnType<typeof RateLimitDetector.detect> {
  return RateLimitDetector.detect(stdoutContent);
}
