import * as fs from 'fs';
import * as path from 'path';
import { ProviderId } from './providers';

// ---------------------------------------------------------------------------
// CLI session ID persistence — stored in .autodev-session-state.json
// Mirrors the PHP MetaStore approach (keys per provider).
// ---------------------------------------------------------------------------

export const SESSION_STATE_FILE = '.autodev-session-state.json';

/** Session output capture file — CLI stdout is tee'd here so we can parse session IDs. */
export const SESSION_OUT_FILE = 'TEMP_SESSION_OUT.txt';

type SessionMap = Partial<Record<string, string>>;

function readMap(root: string): SessionMap {
  try {
    const p = path.join(root, SESSION_STATE_FILE);
    if (fs.existsSync(p)) { return JSON.parse(fs.readFileSync(p, 'utf8')) as SessionMap; }
  } catch { }
  return {};
}

function writeMap(root: string, map: SessionMap): void {
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

/** OpenCode: "sessionID":"<id>" in JSON stream */
export function extractOpenCodeSessionId(stdout: string): string | undefined {
  return stdout.match(/"sessionID"\s*:\s*"([^"]+)"/)?.[1];
}

/**
 * After a CLI task finishes, try to capture and persist the session ID.
 * - claude-cli:    reads session ID from the JSONL capture file (stdout tee)
 * - copilot-cli:   reads from TEMP_SESSION_OUT.txt
 * - opencode-cli:  reads from TEMP_SESSION_OUT.txt
 * Falls back silently — never throws.
 */
export function captureAndSaveSessionId(
  root: string,
  providerId: ProviderId,
  /** Fallback session ID (e.g. from findLatestClaudeSession for claude-cli) */
  fallbackSessionId?: string,
): void {
  try {
    // Try reading from the captured output file first
    const outFile = path.join(root, SESSION_OUT_FILE);
    if (fs.existsSync(outFile)) {
      const stdout = fs.readFileSync(outFile, 'utf8');
      let id: string | undefined;
      if (providerId === 'claude-cli')    { id = extractClaudeSessionId(stdout); }
      if (providerId === 'copilot-cli')   { id = extractCopilotSessionId(stdout); }
      if (providerId === 'opencode-cli')  { id = extractOpenCodeSessionId(stdout); }
      if (id) { saveSessionId(root, providerId, id); return; }
    }
    // Fallback (e.g. JSONL-based ID for claude-cli)
    if (fallbackSessionId) { saveSessionId(root, providerId, fallbackSessionId); }
  } catch { }
}
