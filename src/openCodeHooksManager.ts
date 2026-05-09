import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// OpenCode hooks manager — installs/removes an OpenCode plugin that appends
// hook events to <workspaceRoot>/.autodev/hooks-events.jsonl in the same
// format as the Claude Code hooks, so the task loop can stream them to
// Pixel Office.
//
// The plugin is placed at <workspaceRoot>/.opencode/plugins/autodev-hooks.ts
// OpenCode discovers plugins in that directory automatically.
// ---------------------------------------------------------------------------

const PLUGIN_FILENAME = 'autodev-hooks.ts';
const PLUGIN_MARKER   = '// __autodev_opencode_hooks__';

function pluginDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.opencode', 'plugins');
}

function pluginPath(workspaceRoot: string): string {
  return path.join(pluginDir(workspaceRoot), PLUGIN_FILENAME);
}

// ---------------------------------------------------------------------------
// Plugin content — TypeScript executed by OpenCode/Bun at runtime.
// The JSONL path is baked in at install time (workspace-scoped, forward
// slashes only so Bun/Windows path handling doesn't break the string).
// ---------------------------------------------------------------------------

function buildPluginContent(workspaceRoot: string): string {
  // Bake in the workspace-scoped JSONL path with forward slashes so the
  // plugin always writes to the right place regardless of the process cwd.
  const jsonlPath = JSON.stringify(
    path.join(workspaceRoot, '.autodev', 'hooks-events.jsonl').replace(/\\/g, '/'),
  );
  return `${PLUGIN_MARKER}
// AutoDev hooks plugin for OpenCode — auto-generated, do not edit.
// Streams tool/session events to Pixel Office via <workspaceRoot>/.autodev/hooks-events.jsonl
import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';

// Path is baked in at install time (workspace-scoped, always forward slashes)
const JSONL_PATH: string = ${jsonlPath};

// High-frequency / large-payload events that are not useful in the UI
const SKIP_EVENTS = new Set([
  'message.part.updated',
  'message.part.delta',
  'message.part.removed',
  'session.diff',
]);

const SESSION_MAP: Record<string, string> = {
  'session.created':   'SessionStart',
  'session.idle':      'Stop',
  'session.error':     'StopFailure',
  'session.deleted':   'SessionEnd',
  'session.compacted': 'PostCompact',
  'session.updated':   'SessionStatus',
  'session.status':    'SessionStatus',
  'message.updated':   'MessageUpdated',
  'message.removed':   'MessageRemoved',
  'todo.updated':      'TaskCreated',
};

function appendEvent(ev: Record<string, unknown>): void {
  try {
    const dir = dirname(JSONL_PATH);
    if (!existsSync(dir)) { mkdirSync(dir, { recursive: true }); }
    ev['timestamp'] = new Date().toISOString();
    appendFileSync(JSONL_PATH, JSON.stringify(ev) + '\\n', 'utf8');
  } catch { }
}

export const AutodevHooksPlugin = async () => ({
  'tool.execute.before': async (input: any, callData?: any) => {
    appendEvent({
      opencode_event:  'tool.execute.before',
      hook_event_name: 'PreToolUse',
      provider:        'opencode',
      tool_name:       input?.tool ?? 'unknown',
      tool_input:      callData?.args ?? null,
      session_id:      input?.sessionID ?? null,
      call_id:         input?.callID ?? null,
    });
  },

  'tool.execute.after': async (input: any, callData?: any) => {
    const rawOut = callData?.output;
    const outText = typeof rawOut === 'string' ? rawOut.slice(0, 400) : null;
    appendEvent({
      opencode_event:  'tool.execute.after',
      hook_event_name: 'PostToolUse',
      provider:        'opencode',
      tool_name:       input?.tool ?? 'unknown',
      tool_input:      input?.args ?? null,
      tool_output:     outText != null ? { title: callData?.title ?? null, text: outText } : null,
      session_id:      input?.sessionID ?? null,
      call_id:         input?.callID ?? null,
    });
  },

  'event': async (ctx: any) => {
    const evt   = ctx?.event ?? ctx ?? {};
    const t: string = evt?.type ?? '';
    if (!t || SKIP_EVENTS.has(t)) return;

    const props     = evt?.properties ?? {};
    const sessionId = props?.sessionID ?? props?.id ?? null;
    const msgInfo   = props?.info ?? null;
    const role      = msgInfo?.role   ?? null;
    const agent     = msgInfo?.agent  ?? null;
    const modelId   = msgInfo?.model?.modelID ?? null;
    const errMsg    = props?.error?.message ?? props?.message ?? null;

    appendEvent({
      opencode_event:  t,
      hook_event_name: SESSION_MAP[t] ?? t,
      provider:        'opencode',
      session_id:      sessionId,
      message:         errMsg ?? (agent ? \`\${agent}\${modelId ? \` (\${modelId})\` : ''}\` : role),
      role,
      agent,
      model:           modelId,
    });
  },
});
`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function isOpenCodeHooksInstalled(workspaceRoot: string): boolean {
  try {
    const content = fs.readFileSync(pluginPath(workspaceRoot), 'utf8');
    // Check both the marker AND that the path is workspace-scoped (not a stale
    // homedir path from an older install).
    const expectedPath = path.join(workspaceRoot, '.autodev', 'hooks-events.jsonl').replace(/\\/g, '/');
    return content.includes(PLUGIN_MARKER) && content.includes(expectedPath);
  } catch {
    return false;
  }
}

export function installOpenCodeHooks(workspaceRoot: string): void {
  const dir = pluginDir(workspaceRoot);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(pluginPath(workspaceRoot), buildPluginContent(workspaceRoot), 'utf8');
}

/**
 * Read the workspace-scoped hooks-events.jsonl and return the session ID from
 * the most recent OpenCode session.created / session.idle / session.updated event.
 * Returns undefined if the file is absent or no session event has been seen yet.
 */
export function getOpenCodeSessionIdFromHooks(workspaceRoot: string): string | undefined {
  const jsonlFile = path.join(workspaceRoot, '.autodev', 'hooks-events.jsonl');
  try {
    const lines = fs.readFileSync(jsonlFile, 'utf8').split('\n').filter(Boolean);
    // Walk backwards — most recent event first
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const ev = JSON.parse(lines[i]);
        if (ev.provider !== 'opencode') { continue; }
        const sid: string | undefined = ev.session_id ?? undefined;
        if (sid) { return sid; }
      } catch { /* malformed line */ }
    }
  } catch { /* file absent */ }
  return undefined;
}

export function uninstallOpenCodeHooks(workspaceRoot: string): void {
  const p = pluginPath(workspaceRoot);
  if (!fs.existsSync(p)) { return; }
  try {
    const content = fs.readFileSync(p, 'utf8');
    if (content.includes(PLUGIN_MARKER)) {
      fs.unlinkSync(p);
    }
  } catch { /* ignore */ }
}
