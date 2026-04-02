import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// AutoDev settings — stored in .vscode/autodev.json inside each workspace
// ---------------------------------------------------------------------------

export interface AutodevSettings {
  /** Active AI provider */
  provider: 'copilot' | 'claude';
  /** Base URL of the autodev server (e.g. https://myserver.com) */
  serverBaseUrl: string;
  /** API key (X-API-Key) for the autodev server */
  serverApiKey: string;
  /** Webhook endpoint slug — events POST to {serverBaseUrl}/webhook/{slug}, logs polled from {serverBaseUrl}/v1/logs */
  webhookSlug: string;
  /** Discord bot token */
  discordToken: string;
  /** Discord channel ID to post messages to */
  discordChannelId: string;
  /** Discord webhook URL (simpler alternative to bot — just POSTs embeds) */
  discordWebhookUrl: string;
  /** Comma-separated list of Discord usernames or user IDs allowed to send tasks to the bot */
  discordOwners: string;
  /** Max consecutive tasks before stopping the loop */
  maxIterations: number;
  /** Seconds to wait between loop ticks when TODO is empty */
  loopInterval: number;
  /** Path to the agent instructions file (defaults to AUTODEV.md in workspace root) */
  profilePath: string;
  /** Path to TODO.md (defaults to TODO.md in workspace root) */
  todoPath: string;
}

const DEFAULTS: AutodevSettings = {
  provider: 'copilot',
  serverBaseUrl: '',
  serverApiKey: '',
  webhookSlug: '',
  discordToken: '',
  discordChannelId: '',
  discordWebhookUrl: '',
  discordOwners: '',
  maxIterations: 300,
  loopInterval: 30,
  profilePath: '',
  todoPath: '',
};

function settingsPath(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) { return undefined; }
  return path.join(folders[0].uri.fsPath, '.vscode', 'autodev.json');
}

export function loadSettings(): AutodevSettings {
  const file = settingsPath();
  if (!file || !fs.existsSync(file)) { return { ...DEFAULTS }; }
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<AutodevSettings>;
    return { ...DEFAULTS, ...raw };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings: AutodevSettings): void {
  const file = settingsPath();
  if (!file) { return; }
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
  fs.writeFileSync(file, JSON.stringify(settings, null, 2), 'utf8');
}

/** Open .vscode/autodev.json in the editor (create with defaults if missing). */
export async function openSettingsFile(): Promise<void> {
  const file = settingsPath();
  if (!file) {
    vscode.window.showWarningMessage('AutoDev: No workspace folder open.');
    return;
  }
  if (!fs.existsSync(file)) {
    saveSettings(DEFAULTS);
  }
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  await vscode.window.showTextDocument(doc);
}
