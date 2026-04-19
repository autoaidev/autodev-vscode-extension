import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Claude Code hooks manager — installs/removes autodev HTTP hooks so every
// tool call, stop, notification, etc. is streamed to Pixel Office in real time.
// ---------------------------------------------------------------------------

const AUTODEV_MARKER = '__autodev_hooks__';

const HOOK_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'SessionStart',
  'Notification',
] as const;

function settingsPath(scope: 'project' | 'global', workspaceRoot: string): string {
  return scope === 'global'
    ? path.join(os.homedir(), '.claude', 'settings.json')
    : path.join(workspaceRoot, '.claude', 'settings.json');
}

function readSettings(filePath: string): any {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return {}; }
}

/** Derive the HTTP base URL from a wss:// or ws:// URL. */
export function deriveHttpBaseUrl(wsUrl: string): string {
  try {
    const u = new URL(wsUrl);
    u.pathname = '';
    u.search = '';
    u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:';
    return u.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
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
  httpBaseUrl: string,
  apiKey: string,
): void {
  const filePath = settingsPath(scope, workspaceRoot);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const raw = readSettings(filePath);
  const hooks = raw.hooks ?? {};
  const url = `${httpBaseUrl}/api/hooks/event`;

  for (const ev of HOOK_EVENTS) {
    // Remove any existing autodev groups, then append fresh one
    const groups = ((hooks[ev] ?? []) as any[]).filter(g => !g[AUTODEV_MARKER]);
    groups.push({
      [AUTODEV_MARKER]: true,
      matcher: '',
      hooks: [{ type: 'http', url, headers: { Authorization: `Bearer ${apiKey}` } }],
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
