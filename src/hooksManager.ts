import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Hooks manager — installs/removes autodev command hooks for both:
//   - Claude Code        → <root>/.claude/settings.json   (PascalCase events)
//   - Copilot CLI        → <root>/.github/copilot/settings.json (camelCase events)
// Each hook appends its stdin JSON payload (one event) as a JSONL line to
// ~/.autodev/hooks-events.jsonl. The task-loop polls that file every 10 s and
// forwards events via WebSocket.
//
// Hooks bodies are Node.js (not Python) — autodev already requires Node.js,
// so we drop the python3 dependency.
// ---------------------------------------------------------------------------

const AUTODEV_MARKER = '__autodev_hooks__';

// Claude Code uses PascalCase event names.
const CLAUDE_HOOK_EVENTS = [
  // Tool lifecycle
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  // Session lifecycle
  'SessionStart',
  'SessionEnd',
  'Setup',
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

// Copilot CLI uses camelCase event names. Full list per
// https://docs.github.com/en/enterprise-cloud@latest/copilot/reference/copilot-cli-reference/cli-hooks-reference
const COPILOT_HOOK_EVENTS = [
  'sessionStart',
  'sessionEnd',
  'userPromptSubmitted',
  'preToolUse',
  'postToolUse',
  'postToolUseFailure',
  'agentStop',
  'subagentStart',
  'subagentStop',
  'preCompact',
  'permissionRequest',
  'notification',
  'errorOccurred',
] as const;

/**
 * Path of the JSONL sink for a given workspace.
 *
 * Per-workspace, NOT homedir. When two VS Code instances run on the same
 * machine, they share `os.homedir()` — so a homedir-scoped sink causes both
 * pollers to see (and forward, attributed to themselves) every hook from
 * every instance. The result was hooks from `tester-1` showing up under
 * `A1` in pixel-office because A1's poller read the line first. Scoping
 * the sink to the workspace avoids the cross-talk entirely.
 */
export function hooksJsonlPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.autodev', 'hooks-events.jsonl');
}

/**
 * Build a Node.js one-liner that reads stdin JSON and appends one JSONL line
 * to `<workspaceRoot>/.autodev/hooks-events.jsonl`. The workspace path is
 * baked into the string at install time (escaped via JSON.stringify) so the
 * hook always writes to the right place, regardless of cwd when it fires.
 *
 * Optionally injects a hook event name and provider id into the payload —
 * needed for Copilot CLI which doesn't include the event name in its stdin.
 */
function nodeAppenderJs(workspaceRoot: string, injectEvent?: string, injectProvider?: string): string {
  const inject = [
    injectEvent    ? `d.hook=${JSON.stringify(injectEvent)};`        : '',
    injectProvider ? `d.provider=${JSON.stringify(injectProvider)};` : '',
  ].join('');
  const targetFile = JSON.stringify(hooksJsonlPath(workspaceRoot));
  // eslint-disable-next-line max-len
  return `let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{let d;try{d=JSON.parse(s)}catch(e){d={_raw:s.replace(/[\\r\\n]+/g," ")}}${inject}const fs=require("fs"),p=require("path"),f=${targetFile};fs.mkdirSync(p.dirname(f),{recursive:true});fs.appendFileSync(f,JSON.stringify(d)+"\\n")})`;
}

/** Shell command for Claude Code — Claude already includes hook_event_name in
 *  the stdin payload, so we don't need to inject anything. */
function claudeHookCommand(workspaceRoot: string): string {
  return `node -e '${nodeAppenderJs(workspaceRoot)}'`;
}

/** Shell command for one Copilot CLI event — Copilot doesn't include the
 *  event name in stdin, so we bake it into the JS. */
function copilotHookCommand(eventName: string, workspaceRoot: string): string {
  return `node -e '${nodeAppenderJs(workspaceRoot, eventName, 'copilot-cli')}'`;
}

/** Returns a shell command that synthesises a hook event with no stdin payload.
 *  Used by the dispatcher to emit SessionStart/SessionEnd for providers that
 *  lack native hooks (or before the CLI has a chance to fire its own).
 *  `workspaceRoot` controls which workspace's JSONL sink the hook writes to. */
export function getManualHookCmd(provider: string, hookEvent: string, workspaceRoot: string, sessionName?: string): string {
  // Build the JSON payload safely with JSON.stringify, then escape single
  // quotes for the surrounding shell single-quoted argument.
  const payload = {
    hook: hookEvent,
    provider,
    _session_name: sessionName ?? '',
  };
  const payloadJson = JSON.stringify(payload).replace(/'/g, `'\\''`);
  const targetFile = JSON.stringify(hooksJsonlPath(workspaceRoot));
  // eslint-disable-next-line max-len
  const js = `const d=${payloadJson};d.timestamp=new Date().toISOString();const fs=require("fs"),p=require("path"),f=${targetFile};fs.mkdirSync(p.dirname(f),{recursive:true});fs.appendFileSync(f,JSON.stringify(d)+"\\n")`;
  return `node -e '${js}'`;
}

// ---------------------------------------------------------------------------
// Claude Code hooks  (.claude/settings.json)
// ---------------------------------------------------------------------------

function claudeSettingsPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.claude', 'settings.json');
}

function readJson(filePath: string): any {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return {}; }
}

/** Hook events that were once registered by autodev but have since been removed from Claude Code. */
const OBSOLETE_HOOK_EVENTS = ['PostToolBatch', 'UserPromptExpansion'] as const;

/** Remove autodev entries for any obsolete or unrecognised hook events from a hooks object in-place. */
function purgeObsoleteHooks(hooks: Record<string, any[]>): void {
  for (const ev of OBSOLETE_HOOK_EVENTS) {
    if (!hooks[ev]) { continue; }
    hooks[ev] = hooks[ev].filter((g: any) => !g[AUTODEV_MARKER]);
    if (hooks[ev].length === 0) { delete hooks[ev]; }
  }
}

/**
 * True if the entry's command writes to *this* workspace's JSONL sink.
 * Legacy entries from <= v1.0.71 wrote to `os.homedir()/.autodev/...` (shared
 * across every VS Code instance on the host) — we treat those as not
 * installed so the install flow naturally migrates them on next call.
 */
function isCurrentClaudeEntry(group: any, workspaceRoot: string): boolean {
  if (!group || group[AUTODEV_MARKER] !== true) return false;
  const cmd = group.hooks?.[0]?.command;
  if (typeof cmd !== 'string') return false;
  const expectedSink = hooksJsonlPath(workspaceRoot);
  return cmd.includes(JSON.stringify(expectedSink));
}

export function areClaudeHooksInstalled(workspaceRoot: string): boolean {
  const filePath = claudeSettingsPath(workspaceRoot);
  const raw = readJson(filePath);
  const hooks = raw?.hooks ?? {};

  // Silently clean up obsolete entries whenever we check
  const hadObsolete = OBSOLETE_HOOK_EVENTS.some(ev => (hooks[ev] ?? []).some((g: any) => g[AUTODEV_MARKER]));
  if (hadObsolete && raw?.hooks) {
    purgeObsoleteHooks(raw.hooks);
    if (Object.keys(raw.hooks).length === 0) { delete raw.hooks; }
    try { fs.writeFileSync(filePath, JSON.stringify(raw, null, 2), 'utf8'); } catch { /* ignore */ }
  }

  return CLAUDE_HOOK_EVENTS.some(ev =>
    (hooks[ev] ?? []).some((g: any) => isCurrentClaudeEntry(g, workspaceRoot))
  );
}

export function installClaudeHooks(workspaceRoot: string): void {
  const filePath = claudeSettingsPath(workspaceRoot);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const raw = readJson(filePath);
  const hooks = raw.hooks ?? {};

  purgeObsoleteHooks(hooks);

  const claudeCmd = claudeHookCommand(workspaceRoot);
  for (const ev of CLAUDE_HOOK_EVENTS) {
    const groups = ((hooks[ev] ?? []) as any[]).filter(g => !g[AUTODEV_MARKER]);
    groups.push({
      [AUTODEV_MARKER]: true,
      matcher: '',
      hooks: [{ type: 'command', command: claudeCmd }],
    });
    hooks[ev] = groups;
  }

  raw.hooks = hooks;
  fs.writeFileSync(filePath, JSON.stringify(raw, null, 2), 'utf8');
}

export function uninstallClaudeHooks(workspaceRoot: string): void {
  const filePath = claudeSettingsPath(workspaceRoot);
  const raw = readJson(filePath);
  if (!raw.hooks) { return; }

  purgeObsoleteHooks(raw.hooks);

  for (const ev of CLAUDE_HOOK_EVENTS) {
    if (!raw.hooks[ev]) { continue; }
    raw.hooks[ev] = (raw.hooks[ev] as any[]).filter(g => !g[AUTODEV_MARKER]);
    if (raw.hooks[ev].length === 0) { delete raw.hooks[ev]; }
  }

  if (Object.keys(raw.hooks).length === 0) { delete raw.hooks; }
  fs.writeFileSync(filePath, JSON.stringify(raw, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// Copilot CLI hooks  (.github/copilot/settings.json)
//
// Copilot CLI loads repo settings from `.github/copilot/settings.json` and
// `.github/copilot/settings.local.json`. The `hooks` field there has the
// shape:
//   { "<eventName>": [ { type, bash, powershell?, cwd?, timeoutSec? }, ... ] }
// Copilot doesn't support a per-entry "marker" field like Claude does (it
// validates each command strictly), so we identify our own entries by
// inspecting the `bash` command for our HOOK_COMMAND fingerprint.
// ---------------------------------------------------------------------------

function copilotSettingsPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.github', 'copilot', 'settings.json');
}

/** True if the entry was installed by autodev (matches our HOOK_COMMAND). */
function isAutodevCopilotEntry(entry: any): boolean {
  return typeof entry?.bash === 'string'
    && entry.bash.includes('.autodev/hooks-events.jsonl');
}

/** True if the entry's bash command writes to *this* workspace's JSONL sink. */
function isCurrentCopilotEntry(entry: any, workspaceRoot: string): boolean {
  if (!isAutodevCopilotEntry(entry)) return false;
  const expectedSink = hooksJsonlPath(workspaceRoot);
  return typeof entry.bash === 'string' && entry.bash.includes(JSON.stringify(expectedSink));
}

export function areCopilotHooksInstalled(workspaceRoot: string): boolean {
  const filePath = copilotSettingsPath(workspaceRoot);
  const raw = readJson(filePath);
  const hooks = raw?.hooks ?? {};
  return COPILOT_HOOK_EVENTS.some(ev =>
    (hooks[ev] ?? []).some((e: any) => isCurrentCopilotEntry(e, workspaceRoot))
  );
}

export function installCopilotHooks(workspaceRoot: string): void {
  const filePath = copilotSettingsPath(workspaceRoot);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const raw = readJson(filePath);
  const hooks = raw.hooks ?? {};

  for (const ev of COPILOT_HOOK_EVENTS) {
    const existing = ((hooks[ev] ?? []) as any[]).filter(e => !isAutodevCopilotEntry(e));
    existing.push({
      type: 'command',
      bash: copilotHookCommand(ev, workspaceRoot),
      timeoutSec: 30,
    });
    hooks[ev] = existing;
  }

  raw.hooks = hooks;
  fs.writeFileSync(filePath, JSON.stringify(raw, null, 2), 'utf8');
}

export function uninstallCopilotHooks(workspaceRoot: string): void {
  const filePath = copilotSettingsPath(workspaceRoot);
  const raw = readJson(filePath);
  if (!raw.hooks) { return; }

  for (const ev of COPILOT_HOOK_EVENTS) {
    if (!raw.hooks[ev]) { continue; }
    raw.hooks[ev] = (raw.hooks[ev] as any[]).filter(e => !isAutodevCopilotEntry(e));
    if (raw.hooks[ev].length === 0) { delete raw.hooks[ev]; }
  }

  if (Object.keys(raw.hooks).length === 0) { delete raw.hooks; }
  fs.writeFileSync(filePath, JSON.stringify(raw, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// Combined helpers — install/uninstall both Claude + Copilot in one call so
// the user doesn't have to think about which provider they're running.
// ---------------------------------------------------------------------------

export function installHooks(scope: 'project' | 'global', workspaceRoot: string): void {
  // Scope arg kept for backwards compatibility — always project now.
  void scope;
  installClaudeHooks(workspaceRoot);
  installCopilotHooks(workspaceRoot);
}

export function uninstallHooks(scope: 'project' | 'global', workspaceRoot: string): void {
  void scope;
  uninstallClaudeHooks(workspaceRoot);
  uninstallCopilotHooks(workspaceRoot);
}

export function areHooksInstalled(scope: 'project' | 'global', workspaceRoot: string): boolean {
  void scope;
  // Either side counts as "installed" — the UI shows a single combined state.
  return areClaudeHooksInstalled(workspaceRoot) || areCopilotHooksInstalled(workspaceRoot);
}
