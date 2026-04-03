import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ProviderId } from './providers';

// ---------------------------------------------------------------------------
// AutoDev settings — stored in .vscode/autodev.json inside each workspace
// ---------------------------------------------------------------------------

export interface AutodevSettings {
  /** Active AI provider */
  provider: ProviderId;
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
  /** Seconds to wait between loop ticks when TODO is empty */
  loopInterval: number;
  /** Minutes before a running task is considered timed out */
  taskTimeoutMinutes: number;
  /** Minutes between periodic check-in notifications while a task is running */
  taskCheckInMinutes: number;
  /** If true, retry timed-out tasks instead of marking them failed */
  retryOnTimeout: boolean;
  /** If true, reset any [~] in-progress tasks to [ ] when the loop starts */
  autoResetPendingTasks: boolean;
  /** Path to the agent instructions file (defaults to AUTODEV.md in workspace root) */
  profilePath: string;
  /** Path to TODO.md (defaults to TODO.md in workspace root) */
  todoPath: string;
  /** If true, pass --resume / --session flag to CLI providers to continue the last session */
  resumeSession: boolean;
}

const DEFAULTS: AutodevSettings = {
  provider: 'claude' as ProviderId,
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
  ensureGitignore(path.dirname(dir), '.vscode/autodev.json');
}

/** Add `entry` to the project .gitignore if not already present. */
function ensureGitignore(root: string, entry: string): void {
  const gitignorePath = path.join(root, '.gitignore');
  try {
    let content = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf8') : '';
    const lines = content.split('\n').map(l => l.trim());
    if (lines.includes(entry)) { return; }
    // Append with a trailing newline
    if (content.length > 0 && !content.endsWith('\n')) { content += '\n'; }
    content += `${entry}\n`;
    fs.writeFileSync(gitignorePath, content, 'utf8');
  } catch { /* ignore — .gitignore may not be writable */ }
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
