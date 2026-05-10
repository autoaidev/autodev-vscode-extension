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

// High-frequency / large-payload events we intentionally skip in the generic catch-all
// (tool events have dedicated hooks; these are too noisy or already handled explicitly)
const SKIP_EVENTS = new Set([
  'message.part.delta',
  'message.part.removed',
  'message.removed',
  'session.diff',
  // Skip events that have their own explicit named hooks below so we don't double-log
  'tool.execute.before',
  'tool.execute.after',
  'permission.asked',
  'permission.replied',
  'tui.prompt.append',
  'tui.command.execute',
  'tui.toast.show',
  'command.executed',
  'file.edited',
]);

const SESSION_MAP: Record<string, string> = {
  'session.created':    'SessionStart',
  'session.idle':       'Stop',
  'session.error':      'StopFailure',
  'session.deleted':    'SessionEnd',
  'session.compacted':  'PostCompact',
  'session.updated':    'SessionStatus',
  'session.status':     'SessionStatus',
  'message.updated':    'MessageUpdated',
  'message.removed':    'MessageRemoved',
  'todo.updated':       'TaskCreated',
  'command.executed':   'CommandExecuted',
  'file.edited':        'FileEdited',
  'file.watcher.updated': 'FileWatcherUpdated',
  'permission.asked':   'PermissionAsked',
  'permission.replied': 'PermissionReplied',
  'server.connected':   'ServerConnected',
  'lsp.updated':        'LspUpdated',
  'installation.updated': 'InstallationUpdated',
  'tui.prompt.append':  'TuiPromptAppend',
  'tui.command.execute':'TuiCommandExecute',
  'tui.toast.show':     'TuiToastShow',
};

function appendEvent(ev: Record<string, unknown>): void {
  try {
    const dir = dirname(JSONL_PATH);
    if (!existsSync(dir)) { mkdirSync(dir, { recursive: true }); }
    ev['timestamp'] = new Date().toISOString();
    appendFileSync(JSONL_PATH, JSON.stringify(ev) + '\\n', 'utf8');
  } catch { }
}

// Helper to extract session ID from various event shapes
function extractSessionId(input: any): string | null {
  return input?.sessionID ?? input?.session_id ?? input?.properties?.sessionID ?? null;
}

// messageId -> role ('user' | 'assistant') — populated from message.updated metadata events
const msgRole = new Map<string, string>();
// Accumulated assistant text per session.
// message.part.updated fires for each text part with the full text so far
// (last update per part-id is the complete text). We collect them by partId
// and flush the combined text as one AgentMessage on session.idle.
const sessionText = new Map<string, string>();
// sessionId -> (partId -> latestText)
const sessionPartText = new Map<string, Map<string, string>>();

export const AutodevHooksPlugin = async () => ({
  // -------------------------------------------------------------------------
  // Tool lifecycle — explicit named hooks (these do NOT fire via generic 'event')
  // -------------------------------------------------------------------------
  'tool.execute.before': async (input: any, output?: any) => {
    appendEvent({
      hook_event_name: 'PreToolUse',
      provider:        'opencode',
      tool_name:       input?.tool ?? 'unknown',
      tool_input:      output?.args ?? input?.args ?? null,
      session_id:      extractSessionId(input),
    });
  },

  'tool.execute.after': async (input: any, output?: any) => {
    const rawOut = output?.output ?? output?.result ?? output?.text;
    const outText = typeof rawOut === 'string' ? rawOut.slice(0, 400) : null;
    appendEvent({
      hook_event_name: 'PostToolUse',
      provider:        'opencode',
      tool_name:       input?.tool ?? 'unknown',
      tool_input:      input?.args ?? null,
      tool_output:     outText != null ? { title: output?.title ?? null, text: outText } : null,
      session_id:      extractSessionId(input),
    });
  },

  // -------------------------------------------------------------------------
  // Permission hooks — explicit so we always capture even if generic 'event'
  // doesn't fire for them. Critical for detecting blocked/waiting states.
  // -------------------------------------------------------------------------
  'permission.asked': async (input: any, output?: any) => {
    appendEvent({
      hook_event_name: 'PermissionAsked',
      provider:        'opencode',
      session_id:      extractSessionId(input),
      tool_name:       input?.tool ?? null,
      tool_input:      input?.args ?? null,
      message:         input?.message ?? input?.description ?? null,
    });
  },

  'permission.replied': async (input: any, output?: any) => {
    appendEvent({
      hook_event_name: 'PermissionReplied',
      provider:        'opencode',
      session_id:      extractSessionId(input),
      tool_name:       input?.tool ?? null,
      granted:         input?.granted ?? output?.granted ?? null,
    });
  },

  // -------------------------------------------------------------------------
  // TUI events — explicit named hooks
  // -------------------------------------------------------------------------
  'tui.prompt.append': async (input: any) => {
    appendEvent({
      hook_event_name: 'TuiPromptAppend',
      provider:        'opencode',
      session_id:      extractSessionId(input),
      message:         input?.text ?? null,
    });
  },

  'tui.command.execute': async (input: any) => {
    appendEvent({
      hook_event_name: 'TuiCommandExecute',
      provider:        'opencode',
      session_id:      extractSessionId(input),
      message:         input?.command ?? input?.name ?? null,
    });
  },

  'tui.toast.show': async (input: any) => {
    appendEvent({
      hook_event_name: 'TuiToastShow',
      provider:        'opencode',
      session_id:      extractSessionId(input),
      message:         input?.message ?? input?.text ?? null,
    });
  },

  // -------------------------------------------------------------------------
  // Command + file events — explicit named hooks
  // -------------------------------------------------------------------------
  'command.executed': async (input: any) => {
    appendEvent({
      hook_event_name: 'CommandExecuted',
      provider:        'opencode',
      session_id:      extractSessionId(input),
      message:         input?.command ?? input?.name ?? null,
    });
  },

  'file.edited': async (input: any) => {
    appendEvent({
      hook_event_name: 'FileEdited',
      provider:        'opencode',
      session_id:      extractSessionId(input),
      message:         input?.file ?? input?.path ?? null,
    });
  },

  // -------------------------------------------------------------------------
  // Generic catch-all for remaining events (session/message/todo/lsp/server…)
  // SKIP_EVENTS excludes high-noise events and events already handled above.
  // message.part.updated (type:'text') is handled here to accumulate the AI's
  // response text; it's flushed as a single AgentMessage on session.idle.
  // -------------------------------------------------------------------------
  'event': async (ctx: any) => {
    const evt   = ctx?.event ?? ctx ?? {};
    const t: string = evt?.type ?? '';

    // --- message.updated: track message role for filtering text parts later ---
    if (t === 'message.updated') {
      const uprops = evt?.properties ?? {};
      const info   = uprops?.info ?? {};
      const msgId  = info?.id ?? null;
      const role   = info?.role ?? null;
      if (msgId && role) { msgRole.set(msgId, role); }
      return; // metadata-only — never emit directly
    }

    // --- message.part.updated: track ASSISTANT text parts by partId ---
    // Each update carries the FULL accumulated text so far for that part.
    // We only care about type:'text' (not 'reasoning', 'step-start', etc.)
    // and only for messages with role 'assistant'.
    if (t === 'message.part.updated') {
      const uprops  = evt?.properties ?? {};
      const part    = uprops?.part ?? {};
      const sid     = uprops?.sessionID ?? part?.sessionID ?? null;
      const msgId   = part?.messageID ?? null;
      const isAsst  = !msgId || (msgRole.get(msgId) ?? 'assistant') === 'assistant';
      if (sid && isAsst && part?.type === 'text' && typeof part?.text === 'string' && part.text) {
        const partId = part?.id ?? 'default';
        if (!sessionPartText.has(sid)) { sessionPartText.set(sid, new Map()); }
        sessionPartText.get(sid)!.set(partId, part.text);
        // Rebuild combined text for this session
        sessionText.set(sid, [...sessionPartText.get(sid)!.values()].join('\\n\\n'));
      }
      return; // never emit directly — too noisy
    }

    if (!t || SKIP_EVENTS.has(t)) { return; }

    const props     = evt?.properties ?? {};
    const sessionId = props?.sessionID ?? props?.id ?? null;
    const msgInfo   = props?.info ?? null;
    const role      = msgInfo?.role   ?? null;
    const agent     = msgInfo?.agent  ?? null;
    const modelId   = msgInfo?.model?.modelID ?? msgInfo?.modelID ?? null;
    const errMsg    = props?.error?.message ?? props?.message ?? null;

    // --- session.idle: flush accumulated assistant text as AgentMessage ---
    if (t === 'session.idle' && sessionId && sessionText.has(sessionId)) {
      const text = sessionText.get(sessionId)!;
      sessionText.delete(sessionId);
      sessionPartText.delete(sessionId);
      if (text.trim()) {
        appendEvent({
          hook_event_name: 'AgentMessage',
          provider:        'opencode',
          session_id:      sessionId,
          message:         text.slice(0, 3000),
        });
      }
    }

    appendEvent({
      hook_event_name: SESSION_MAP[t] ?? t,
      provider:        'opencode',
      session_id:      sessionId,
      message:         errMsg ?? (agent ? \`\${agent}\${modelId ? \` (\${modelId})\` : ''}\` : role),
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
