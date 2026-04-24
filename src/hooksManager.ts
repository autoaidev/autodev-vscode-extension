import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Claude Code hooks manager — installs/removes autodev command hooks that
// append each event as a JSONL line to ~/.autodev/hooks-events.jsonl.
// The task loop polls that file every 10 s and forwards events via WebSocket.
// ---------------------------------------------------------------------------

const AUTODEV_MARKER = '__autodev_hooks__';

const HOOK_EVENTS = [
  // Tool lifecycle
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PostToolBatch',
  // Session lifecycle
  'SessionStart',
  'SessionEnd',
  'Stop',
  'StopFailure',
  // Subagent / teammate
  'SubagentStart',
  'SubagentStop',
  'TeammateIdle',
  // Permissions
  'PermissionRequest',
  'PermissionDenied',
  // User prompt
  'UserPromptSubmit',
  'UserPromptExpansion',
  // Tasks
  'TaskCreated',
  'TaskCompleted',
  // Context / workspace
  'CwdChanged',
  'FileChanged',
  'InstructionsLoaded',
  'ConfigChange',
  // Compaction
  'PreCompact',
  'PostCompact',
  // Elicitation
  'Elicitation',
  'ElicitationResult',
  // Worktree
  'WorktreeCreate',
  'WorktreeRemove',
  // General
  'Notification',
] as const;

/** Path of the JSONL sink that hook commands write to. */
export const HOOKS_JSONL_PATH = path.join(os.homedir(), '.autodev', 'hooks-events.jsonl');

/**
 * Returns a shell command that appends a synthetic hook event to hooks-events.jsonl.
 * The JSON payload is base64-encoded to avoid all shell quoting issues.
 * Used by the dispatcher to emit SessionStart/SessionEnd for providers that lack
 * native hooks (copilot-cli, opencode-cli).
 */
export function getManualHookCmd(provider: string, hookEvent: string, sessionName?: string): string {
  const payload = { hook: hookEvent, provider, _session_name: sessionName ?? '' };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64');
  return (
    `python3 -c "import base64,json,os,datetime; ` +
    `d=json.loads(base64.b64decode('${b64}').decode()); ` +
    `d['timestamp']=datetime.datetime.utcnow().isoformat()+'Z'; ` +
    `p=os.path.expanduser('~/.autodev/hooks-events.jsonl'); ` +
    `os.makedirs(os.path.dirname(p),exist_ok=True); ` +
    `open(p,'a').write(json.dumps(d)+'\\n')"`
  );
}

/** Shell command installed as the hook body — minifies stdin JSON and appends a JSONL line. */
const HOOK_COMMAND =
  `python3 -c "import sys,json,os; ` +
  `d=json.load(sys.stdin); ` +
  `p=os.path.expanduser('~/.autodev/hooks-events.jsonl'); ` +
  `os.makedirs(os.path.dirname(p),exist_ok=True); ` +
  `open(p,'a').write(json.dumps(d)+'\\n')"`;

function settingsPath(scope: 'project' | 'global', workspaceRoot: string): string {
  return scope === 'global'
    ? path.join(os.homedir(), '.claude', 'settings.json')
    : path.join(workspaceRoot, '.claude', 'settings.json');
}

function readSettings(filePath: string): any {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return {}; }
}

export function areHooksInstalled(scope: 'project' | 'global', workspaceRoot: string): boolean {
  const raw = readSettings(settingsPath(scope, workspaceRoot));
  const hooks = raw?.hooks ?? {};
  return HOOK_EVENTS.some(ev =>
    (hooks[ev] ?? []).some((g: any) => g[AUTODEV_MARKER] === true)
  );
}

export function installHooks(
  scope: 'project' | 'global',
  workspaceRoot: string,
): void {
  const filePath = settingsPath(scope, workspaceRoot);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const raw = readSettings(filePath);
  const hooks = raw.hooks ?? {};

  for (const ev of HOOK_EVENTS) {
    const groups = ((hooks[ev] ?? []) as any[]).filter(g => !g[AUTODEV_MARKER]);
    groups.push({
      [AUTODEV_MARKER]: true,
      matcher: '',
      hooks: [{ type: 'command', command: HOOK_COMMAND }],
    });
    hooks[ev] = groups;
  }

  raw.hooks = hooks;
  fs.writeFileSync(filePath, JSON.stringify(raw, null, 2), 'utf8');
}

export function uninstallHooks(scope: 'project' | 'global', workspaceRoot: string): void {
  const filePath = settingsPath(scope, workspaceRoot);
  const raw = readSettings(filePath);
  if (!raw.hooks) { return; }

  for (const ev of HOOK_EVENTS) {
    if (!raw.hooks[ev]) { continue; }
    raw.hooks[ev] = (raw.hooks[ev] as any[]).filter(g => !g[AUTODEV_MARKER]);
    if (raw.hooks[ev].length === 0) { delete raw.hooks[ev]; }
  }

  if (Object.keys(raw.hooks).length === 0) { delete raw.hooks; }
  fs.writeFileSync(filePath, JSON.stringify(raw, null, 2), 'utf8');
}
