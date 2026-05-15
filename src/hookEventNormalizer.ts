// ---------------------------------------------------------------------------
// hookEventNormalizer — converts raw events from any supported provider into
// the unified hook-event schema written to .autodev/hooks-events.jsonl.
//
// Unified schema (same as Claude/Copilot CLI hook scripts):
//   hook_event_name  — PascalCase event name  (required)
//   provider         — source provider string (required)
//   tool_name        — name of tool involved  (optional)
//   tool_input       — tool arguments         (optional)
//   tool_output      — { text: string }       (optional)
//   success          — boolean                (optional)
//   session_id       — session / call ID      (optional)
//   message          — free-form text         (optional)
//   timestamp        — ISO-8601 (added here)  (required)
//
// Usage:
//   import { normalizeEvent } from './hookEventNormalizer';
//   const hookEv = normalizeEvent('copilot-sdk', rawSdkEvent);
//   if (hookEv) fs.appendFileSync(jsonlPath, JSON.stringify(hookEv) + '\n');
// ---------------------------------------------------------------------------

export interface HookEvent {
  hook_event_name: string;
  provider: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_output?: { text: string } | null;
  success?: boolean;
  session_id?: string | null;
  message?: string | null;
  timestamp: string;
  [key: string]: unknown; // allow extra provider-specific fields to pass through
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeStr(v: unknown): string | null {
  if (v == null) { return null; }
  if (typeof v === 'string') { return v; }
  try { return JSON.stringify(v); } catch { return String(v); }
}

function safeObj(v: unknown): unknown {
  if (v == null) { return null; }
  try { return JSON.parse(JSON.stringify(v)); } catch { return String(v); }
}

function textOut(v: unknown, maxLen = 400): { text: string } | null {
  if (v == null) { return null; }
  const s = typeof v === 'string' ? v : safeStr(v) ?? '';
  return s.length > 0 ? { text: s.slice(0, maxLen) } : null;
}

// ---------------------------------------------------------------------------
// Provider: 'copilot-sdk'
//
// Raw event shape: { type: string; data?: Record<string, unknown>; ephemeral?: boolean }
// Caller should only pass non-ephemeral events.

// toolCallId → toolName: populated by tool.execution_start, consumed by
// tool.execution_complete so we can resolve the tool name even when the SDK
// doesn't repeat it in the completion payload.  Auto-pruned after 500 entries.
const _toolCallNames = new Map<string, string>();
// ---------------------------------------------------------------------------
function normalizeCopilotSdk(
  raw: Record<string, unknown>,
  provider: string,
): Omit<HookEvent, 'timestamp'> | null {
  const type = raw['type'] as string | undefined;
  if (!type) { return null; }

  const d = (raw['data'] as Record<string, unknown> | undefined) ?? {};
  const toolName = (d['toolName'] ?? d['name'] ?? d['toolId']) as string | undefined;

  // Safe-serialise the raw data payload so pixel-office has all available fields.
  const rawData = safeObj(d) as Record<string, unknown> | null;

  // Base event: include safe raw data so nothing is lost, then let mapped
  // fields below override / supplement.
  const base: Record<string, unknown> = {
    sdk_type: type,
    data:     rawData,
  };

  switch (type) {
    case 'tool.execution_start': {
      const callId = safeStr(d['toolCallId']);
      if (callId && toolName) {
        if (_toolCallNames.size > 500) { _toolCallNames.clear(); }
        _toolCallNames.set(callId, toolName);
      }
      return {
        ...base,
        hook_event_name: 'PreToolUse',
        provider,
        tool_name:  toolName ?? 'unknown',
        tool_input: safeObj(d['arguments']),
        session_id: callId,
      };
    }

    case 'tool.execution_complete': {
      const success = d['success'] as boolean | undefined;
      const result  = d['result']  as Record<string, unknown> | undefined;
      const err     = d['error']   as Record<string, unknown> | undefined;
      const outRaw  = success === false
        ? (err?.['message'])
        : (result?.['content'] ?? result?.['detailedContent']);
      // tool name: prefer explicit field, then the start-event cache by toolCallId,
      // then telemetry properties.command (present on failures), else 'unknown'.
      const callId2  = safeStr(d['toolCallId']);
      const telemetry = d['toolTelemetry'] as Record<string, unknown> | undefined;
      const telProps  = telemetry?.['properties'] as Record<string, unknown> | undefined;
      const resolvedToolName = toolName
        ?? (callId2 ? _toolCallNames.get(callId2) : undefined)
        ?? safeStr(telProps?.['command'])
        ?? 'unknown';
      if (callId2) { _toolCallNames.delete(callId2); } // clean up
      return {
        ...base,
        hook_event_name: success === false ? 'PostToolUseFailure' : 'PostToolUse',
        provider,
        tool_name:   resolvedToolName,
        tool_output: textOut(outRaw),
        success:     success ?? true,
        session_id:  safeStr(d['toolCallId']),
      };
    }

    case 'subagent.started':
      return {
        ...base,
        hook_event_name: 'SubagentStart',
        provider,
        message:    safeStr(d['agentDisplayName'] ?? d['agentName']),
        session_id: safeStr(d['toolCallId']),
      };

    case 'assistant.message': {
      const content = d['content'] as string | undefined;
      const tools   = d['toolRequests'] as unknown[] | undefined;
      if ((!content || content.length === 0) && (!tools || tools.length === 0)) { return null; }
      const summary = content && content.length > 0
        ? content.slice(0, 200)
        : `[${(tools ?? []).length} tool call(s)]`;
      return {
        ...base,
        hook_event_name: 'AgentMessage',
        provider,
        message:    summary,
        session_id: safeStr(d['messageId'] ?? d['interactionId']),
      };
    }

    case 'session.task_complete':
      return {
        ...base,
        hook_event_name: 'Stop',
        provider,
        message: safeStr(d['summary']),
      };

    case 'user.message':
      return {
        ...base,
        hook_event_name: 'UserPromptSubmit',
        provider,
        message:    safeStr(d['content']),
        session_id: safeStr(d['messageId']),
      };

    case 'assistant.turn_start':
      return { ...base, hook_event_name: 'TurnStart', provider };

    case 'assistant.turn_end':
      return { ...base, hook_event_name: 'TurnEnd', provider };

    case 'permission.requested':
      return {
        ...base,
        hook_event_name: 'PermissionRequest',
        provider,
        message:    safeStr(d['permissionRequest']),
        session_id: safeStr(d['requestId']),
      };

    default:
      return null; // unknown / uninteresting event
  }
}

// ---------------------------------------------------------------------------
// Provider: 'opencode-sdk'
//
// Raw event shape: the outer SSE envelope; relevant data in payload.properties.
// ---------------------------------------------------------------------------
function normalizeOpencodeSDK(
  raw: Record<string, unknown>,
  provider: string,
): Omit<HookEvent, 'timestamp'> | null {
  const payload = (raw['payload'] ?? raw) as Record<string, unknown>;
  const type  = payload['type'] as string | undefined;
  const props = payload['properties'] as Record<string, unknown> | undefined;
  if (!type) { return null; }

  const toolName = (props?.['toolID'] ?? props?.['name'] ?? props?.['tool']) as string | undefined;
  const sessionId = safeStr(props?.['sessionID'] ?? props?.['session_id']);

  switch (type) {
    case 'tool.execute.before':
      return {
        hook_event_name: 'PreToolUse',
        provider,
        tool_name:  toolName ?? 'unknown',
        tool_input: safeObj(props?.['args'] ?? props?.['input']),
        session_id: sessionId,
      };

    case 'tool.execute.after': {
      const rawOut = props?.['output'] ?? props?.['result'] ?? props?.['text'];
      return {
        hook_event_name: 'PostToolUse',
        provider,
        tool_name:   toolName ?? 'unknown',
        tool_input:  safeObj(props?.['args'] ?? props?.['input']),
        tool_output: textOut(rawOut),
        session_id:  sessionId,
      };
    }

    case 'permission.updated': {
      const permTitle = safeStr(props?.['title']);
      return {
        hook_event_name: 'PermissionReplied',
        provider,
        message:    permTitle,
        session_id: sessionId,
      };
    }

    case 'session.compacted':
      return {
        hook_event_name: 'PostCompact',
        provider,
        session_id: sessionId,
      };

    case 'session.idle': {
      // Optional _assistantText injected by opencodeSdkProvider for flush
      const assistantText = props?.['_assistantText'] as string | undefined;
      if (assistantText) {
        return {
          hook_event_name: 'AgentMessage',
          provider,
          message:    assistantText,
          session_id: sessionId,
        };
      }
      return {
        hook_event_name: 'Stop',
        provider,
        session_id: sessionId,
      };
    }

    case 'session.error':
      return {
        hook_event_name: 'StopFailure',
        provider,
        message:    safeStr(props?.['error'] ?? props?.['message']),
        session_id: sessionId,
      };

    case 'message.part.delta':
      return null; // streamed text — not forwarded

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Provider: 'claude-cli' / 'copilot-cli'
//
// Raw event = the JSON that was already written by the hook script.
// It already has hook_event_name + provider; we just ensure timestamp + schema.
// ---------------------------------------------------------------------------
function normalizeCliHook(
  raw: Record<string, unknown>,
  provider: string,
): Omit<HookEvent, 'timestamp'> | null {
  const hookName = raw['hook_event_name'] as string | undefined ?? raw['hook'] as string | undefined;
  if (!hookName) { return null; }
  return {
    ...raw,
    hook_event_name: hookName,
    provider:        (raw['provider'] as string | undefined) ?? provider,
    tool_name:       (raw['tool_name'] as string | undefined) ?? (raw['tool'] as string | undefined),
    session_id:      safeStr(raw['session_id'] ?? raw['sessionId']),
    message:         safeStr(raw['message'] ?? raw['summary']),
  } as Omit<HookEvent, 'timestamp'>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Normalize a raw provider event into the unified HookEvent schema.
 *
 * @param provider  One of: 'copilot-sdk' | 'opencode-sdk' | 'claude-cli' |
 *                          'copilot-cli' | or any string for pass-through.
 * @param raw       The raw event object from the provider.
 * @returns         A HookEvent ready to be JSON-stringified, or null if the
 *                  event type is not mapped / not interesting.
 */
export function normalizeEvent(
  provider: string,
  raw: Record<string, unknown>,
): HookEvent | null {
  let partial: Omit<HookEvent, 'timestamp'> | null = null;

  if (provider === 'copilot-sdk') {
    partial = normalizeCopilotSdk(raw, provider);
  } else if (provider === 'opencode-sdk') {
    partial = normalizeOpencodeSDK(raw, provider);
  } else {
    // claude-cli, copilot-cli, or any other — treat as already-formatted hook
    partial = normalizeCliHook(raw, provider);
  }

  if (!partial) { return null; }
  return { ...partial, timestamp: new Date().toISOString() } as HookEvent;
}

/**
 * Append a normalized event to a JSONL sink file.
 * Creates the directory if it doesn't exist.
 * Silently ignores write errors (non-critical path).
 */
export function appendHookEvent(
  jsonlPath: string,
  provider: string,
  raw: Record<string, unknown>,
  fs: { mkdirSync: (p: string, opts: { recursive: boolean }) => void; appendFileSync: (p: string, d: string, opts: BufferEncoding | { encoding: BufferEncoding }) => void; },
  path: { dirname: (p: string) => string },
  onError?: (err: unknown) => void,
): void {
  const ev = normalizeEvent(provider, raw);
  if (!ev) { return; }
  try {
    fs.mkdirSync(path.dirname(jsonlPath), { recursive: true });
    fs.appendFileSync(jsonlPath, JSON.stringify(ev) + '\n', 'utf8');
  } catch (e) {
    onError?.(e);
  }
}
