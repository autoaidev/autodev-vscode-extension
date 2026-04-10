import * as fs from 'fs';
import * as path from 'path';
import { ProviderId } from './providers';

// ---------------------------------------------------------------------------
// All autodev runtime files live under <workspace>/.autodev/
// ---------------------------------------------------------------------------

/** Returns the .autodev directory path, creating it if needed. */
export function autodevDir(root: string): string {
  const dir = path.join(root, '.autodev');
  if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
  return dir;
}

/** .autodev/session-state.json — session IDs keyed by provider */
export const SESSION_STATE_FILE = '.autodev/session-state.json';

/** .autodev/TEMP_SESSION_OUT.txt — CLI stdout tee for session ID extraction */
export const SESSION_OUT_FILE = '.autodev/TEMP_SESSION_OUT.txt';

/** .autodev/TEMP_PROMPT.md — prompt written for CLI providers (legacy) */
export const PROMPT_FILE = '.autodev/TEMP_PROMPT.md';

/** .autodev/AGENT_PROFILE.md — profile instructions written per task */
export const AGENT_PROFILE_FILE = '.autodev/AGENT_PROFILE.md';

/**.autodev/output/<providerId>.txt — stdout capture per provider */
export function stdoutFilePath(root: string, providerId: string): string {
  const dir = path.join(autodevDir(root), 'output');
  if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
  return path.join(dir, `${providerId}.txt`);
}

/** .autodev/output/<providerId>-exit.txt — written with exit code when CLI process finishes */
export function exitFilePath(root: string, providerId: string): string {
  const dir = path.join(autodevDir(root), 'output');
  if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
  return path.join(dir, `${providerId}-exit.txt`);
}

type SessionMap = Partial<Record<string, string>>;

function readMap(root: string): SessionMap {
  try {
    const p = path.join(root, SESSION_STATE_FILE);
    if (fs.existsSync(p)) { return JSON.parse(fs.readFileSync(p, 'utf8')) as SessionMap; }
  } catch { }
  return {};
}

function writeMap(root: string, map: SessionMap): void {
  autodevDir(root); // ensure dir exists
  fs.writeFileSync(path.join(root, SESSION_STATE_FILE), JSON.stringify(map, null, 2), 'utf8');
}

export function getSessionId(root: string, providerId: ProviderId): string | undefined {
  return readMap(root)[providerId] ?? undefined;
}

export function saveSessionId(root: string, providerId: ProviderId, sessionId: string): void {
  const map = readMap(root);
  map[providerId] = sessionId;
  writeMap(root, map);
}

export function clearSessionId(root: string, providerId: ProviderId): void {
  const map = readMap(root);
  delete map[providerId];
  writeMap(root, map);
}

// ---------------------------------------------------------------------------
// Session ID extractors — scan raw stdout per provider
// ---------------------------------------------------------------------------

/** Claude: "session_id":"<id>" in --output-format stream-json events */
export function extractClaudeSessionId(stdout: string): string | undefined {
  return stdout.match(/"session_id"\s*:\s*"([^"]+)"/)?.[1];
}

/** Copilot: "sessionId":"<id>" in JSON stream */
export function extractCopilotSessionId(stdout: string): string | undefined {
  return stdout.match(/"sessionId"\s*:\s*"([^"]+)"/)?.[1];
}

/** OpenCode: "sessionID":"ses_xxx" in --format json event stream */
export function extractOpenCodeSessionId(stdout: string): string | undefined {
  return stdout.match(/"sessionID"\s*:\s*"(ses_[^"]+)"/)?.[1];
}

/**
 * After a CLI task finishes, try to capture and persist the session ID.
 * - claude-cli:    reads from .autodev/output/claude-cli.txt (stdout tee)
 * - opencode-cli:  reads from .autodev/output/opencode-cli.txt (--format json tee)
 * - copilot-cli:   reads from .autodev/TEMP_SESSION_OUT.txt
 * Falls back silently — never throws.
 */
export function captureAndSaveSessionId(
  root: string,
  providerId: ProviderId,
  /** Fallback session ID (e.g. from findLatestClaudeSession for claude-cli) */
  fallbackSessionId?: string,
): void {
  try {
    // For claude-cli and opencode-cli, session ID is in the per-provider stdout capture file
    const captureFile = (providerId === 'claude-cli' || providerId === 'opencode-cli')
      ? stdoutFilePath(root, providerId)
      : path.join(root, SESSION_OUT_FILE);
    if (fs.existsSync(captureFile)) {
      const stdout = fs.readFileSync(captureFile, 'utf8');
      let id: string | undefined;
      if (providerId === 'claude-cli')    { id = extractClaudeSessionId(stdout); }
      if (providerId === 'copilot-cli')   { id = extractCopilotSessionId(stdout); }
      if (providerId === 'opencode-cli')  { id = extractOpenCodeSessionId(stdout); }
      if (id) { saveSessionId(root, providerId, id); return; }
    }
    if (fallbackSessionId) { saveSessionId(root, providerId, fallbackSessionId); }
  } catch { }
}
