import * as fs from 'fs';
import * as path from 'path';
import { ProviderId } from '../providers';

// ---------------------------------------------------------------------------
// AutoDev settings — pure Node.js loader (no VS Code dependency).
// The VS Code extension's settings.ts re-exports these and adds UI helpers.
// ---------------------------------------------------------------------------

export interface AutodevSettings {
  provider: ProviderId;
  /** Full WS URL with token+endpoint encoded: wss://host/ws?token=xxx&endpoint=slug */
  wsUrl: string;
  /** Derived from wsUrl (or set directly for backward compat). */
  serverBaseUrl: string;
  serverApiKey: string;
  webhookSlug: string;
  discordToken: string;
  discordChannelId: string;
  discordOwners: string;
  loopInterval: number;
  taskTimeoutMinutes: number;
  taskCheckInMinutes: number;
  retryOnTimeout: boolean;
  autoResetPendingTasks: boolean;
  profilePath: string;
  todoPath: string;
  resumeSession: boolean;
  vncEnabled: boolean;
  vncHost: string;
  vncPort: number;
  vncPassword: string;
  rdpEnabled: boolean;
  rdpHost: string;
  rdpPort: number;
  rdpUsername: string;
  rdpPassword: string;
  rdpDomain: string;
  /** Public WSS URL for guacamole-lite (e.g. wss://myhost.com/guac-ws). If empty, falls back to ws://<rdpHost>:4567 */
  rdpGuacWsUrl: string;
  enableFileBrowser: boolean;
  gitEnabled: boolean;
  hooksEnabled: boolean;
  hooksScope: 'project' | 'global';
  openCodeHooksEnabled: boolean;
  /**
   * If true, the VS Code extension auto-starts the task loop on activation
   * (when a wsUrl is set). Useful for `autodev --setup-url=… --ide=vscode`
   * where the user expects the agent to come online immediately on launch.
   * Default false — opt in via .autodev/settings.json (the CLI sets it true).
   */
  autoStartLoop: boolean;
  /**
   * Per-project MCP server definitions managed by autodev. Stored in the
   * standard `mcpServers` shape (`{ <name>: { command, args, env } }`) so
   * users can paste server snippets verbatim from MCP docs (e.g.
   * mcp-atlassian for Jira). On save, the extension fans these out to every
   * provider's project-local config (.mcp.json, .claude/settings.local.json,
   * opencode.json, .vscode/mcp.json) alongside the autodev defaults.
   */
  mcpServers: Record<string, { command: string; args?: string[]; env?: Record<string, string>; enabled?: boolean }>;
  /**
   * Names of built-in MCP servers (from DEFAULT_MCP_SERVERS) that the user
   * has explicitly disabled. Built-ins default to enabled when not listed.
   */
  disabledBuiltinMcp: string[];
}

export const SETTINGS_DEFAULTS: AutodevSettings = {
  provider: 'claude-cli' as ProviderId,
  wsUrl: '',
  serverBaseUrl: '',
  serverApiKey: '',
  webhookSlug: '',
  discordToken: '',
  discordChannelId: '',
  discordOwners: '',
  loopInterval: 30,
  taskTimeoutMinutes: 30,
  taskCheckInMinutes: 20,
  retryOnTimeout: false,
  autoResetPendingTasks: true,
  profilePath: '',
  todoPath: '',
  resumeSession: false,
  vncEnabled: false,
  vncHost: '',
  vncPort: 5900,
  vncPassword: '',
  rdpEnabled: false,
  rdpHost: '',
  rdpPort: 3389,
  rdpUsername: '',
  rdpPassword: '',
  rdpDomain: '',
  rdpGuacWsUrl: '',
  enableFileBrowser: false,
  gitEnabled: false,
  hooksEnabled: false,
  hooksScope: 'project',
  openCodeHooksEnabled: false,
  autoStartLoop: false,
  mcpServers: {},
  disabledBuiltinMcp: [],
};

/**
 * Parse a full WS URL (wss://host/ws?token=xxx&endpoint=slug) into the three
 * legacy fields.  Returns null if the URL is empty or not a WS scheme.
 */
export function parseWsUrl(wsUrl: string): { serverBaseUrl: string; serverApiKey: string; webhookSlug: string } | null {
  if (!wsUrl || (!wsUrl.startsWith('ws://') && !wsUrl.startsWith('wss://'))) { return null; }
  try {
    const u = new URL(wsUrl);
    const token    = u.searchParams.get('token')    ?? '';
    const endpoint = u.searchParams.get('endpoint') ?? '';
    u.search = '';
    return { serverBaseUrl: u.toString(), serverApiKey: token, webhookSlug: endpoint };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Settings file location.
//
// Canonical:  <root>/.autodev/settings.json
// Legacy:     <root>/.vscode/autodev.json   (still read for back-compat)
//
// Reads prefer the canonical file. If it is missing but the legacy file
// exists, the legacy file is read transparently. New writes always go to the
// canonical path so a workspace migrates automatically on the next save.
// ---------------------------------------------------------------------------

export const NEW_SETTINGS_REL_PATH = '.autodev/settings.json';
export const LEGACY_SETTINGS_REL_PATH = '.vscode/autodev.json';

/** Path that should be used for writes (always the new canonical location). */
export function settingsWritePath(root: string): string {
  return path.join(root, '.autodev', 'settings.json');
}

/** Path that should be used for reads — canonical if present, else legacy. */
export function settingsReadPath(root: string): string {
  const canonical = path.join(root, '.autodev', 'settings.json');
  if (fs.existsSync(canonical)) { return canonical; }
  const legacy = path.join(root, '.vscode', 'autodev.json');
  if (fs.existsSync(legacy)) { return legacy; }
  return canonical; // doesn't exist; callers handle missing-file
}

/** Load settings, preferring `.autodev/settings.json` and falling back to the legacy `.vscode/autodev.json`. */
export function loadSettingsForRoot(root: string): AutodevSettings {
  try {
    const file = settingsReadPath(root);
    if (!fs.existsSync(file)) { return { ...SETTINGS_DEFAULTS }; }
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<AutodevSettings>;
    const merged = { ...SETTINGS_DEFAULTS, ...raw };
    // If wsUrl is set, derive the three legacy fields from it (wsUrl takes priority).
    const parsed = parseWsUrl(merged.wsUrl);
    if (parsed) {
      merged.serverBaseUrl = parsed.serverBaseUrl;
      merged.serverApiKey  = parsed.serverApiKey;
      merged.webhookSlug   = parsed.webhookSlug;
    }
    return merged;
  } catch {
    return { ...SETTINGS_DEFAULTS };
  }
}
