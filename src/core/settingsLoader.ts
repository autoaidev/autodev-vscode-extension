import * as fs from 'fs';
import * as path from 'path';
import { ProviderId } from '../providers';

// ---------------------------------------------------------------------------
// AutoDev settings — pure Node.js loader (no VS Code dependency).
// The VS Code extension's settings.ts re-exports these and adds UI helpers.
// ---------------------------------------------------------------------------

export interface AutodevSettings {
  provider: ProviderId;
  serverBaseUrl: string;
  serverApiKey: string;
  webhookSlug: string;
  discordToken: string;
  discordChannelId: string;
  discordWebhookUrl: string;
  discordOwners: string;
  loopInterval: number;
  taskTimeoutMinutes: number;
  taskCheckInMinutes: number;
  retryOnTimeout: boolean;
  autoResetPendingTasks: boolean;
  profilePath: string;
  todoPath: string;
  resumeSession: boolean;
}

export const SETTINGS_DEFAULTS: AutodevSettings = {
  provider: 'claude-cli' as ProviderId,
  serverBaseUrl: '',
  serverApiKey: '',
  webhookSlug: '',
  discordToken: '',
  discordChannelId: '',
  discordWebhookUrl: '',
  discordOwners: '',
  loopInterval: 30,
  taskTimeoutMinutes: 30,
  taskCheckInMinutes: 20,
  retryOnTimeout: false,
  autoResetPendingTasks: true,
  profilePath: '',
  todoPath: '',
  resumeSession: false,
};

/** Load settings from `<root>/.vscode/autodev.json`, falling back to defaults. */
export function loadSettingsForRoot(root: string): AutodevSettings {
  try {
    const file = path.join(root, '.vscode', 'autodev.json');
    if (!fs.existsSync(file)) { return { ...SETTINGS_DEFAULTS }; }
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<AutodevSettings>;
    return { ...SETTINGS_DEFAULTS, ...raw };
  } catch {
    return { ...SETTINGS_DEFAULTS };
  }
}
