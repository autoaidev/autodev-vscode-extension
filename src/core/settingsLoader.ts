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

/** Load settings from `<root>/.vscode/autodev.json`, falling back to defaults. */
export function loadSettingsForRoot(root: string): AutodevSettings {
  try {
    const file = path.join(root, '.vscode', 'autodev.json');
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
