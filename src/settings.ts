import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// Re-export the pure settings type and loader so VS Code extension code can
// import from a single place.
export { AutodevSettings, SETTINGS_DEFAULTS, loadSettingsForRoot } from 'autodev-cli/core/settingsLoader';
import {
  AutodevSettings,
  SETTINGS_DEFAULTS,
  loadSettingsForRoot,
  settingsWritePath,
  settingsReadPath,
} from 'autodev-cli/core/settingsLoader';

// ---------------------------------------------------------------------------
// VS Code-aware settings helpers
// ---------------------------------------------------------------------------

function settingsPath(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) { return undefined; }
  return settingsWritePath(folders[0].uri.fsPath);
}

function settingsPathForReading(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) { return undefined; }
  return settingsReadPath(folders[0].uri.fsPath);
}

/** Load settings using the VS Code workspace root (falls back to defaults). */
export function loadSettings(): AutodevSettings {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) { return { ...SETTINGS_DEFAULTS }; }
  return loadSettingsForRoot(folders[0].uri.fsPath);
}

export function saveSettings(settings: AutodevSettings): void {
  const file = settingsPath();
  if (!file) { return; }
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
  // mcpServers is no longer stored in .autodev/settings.json — .mcp.json owns it.
  const { mcpServers: _drop, ...rest } = settings as AutodevSettings & { mcpServers?: unknown };
  void _drop;
  fs.writeFileSync(file, JSON.stringify(rest, null, 2), 'utf8');
  ensureGitignore(path.dirname(dir), '.autodev/');
  // Sensitive config files that may contain API keys or private server definitions
  for (const entry of [
    '.mcp.json', 'opencode.json', '.opencode.json', 'AGENTS.md', 'CLAUDE.md',
    '.claude/settings.json', '.claude/settings.local.json',
    '.vscode/mcp.json', '.vscode/settings.json',
    '.openai.json', '.copilot-instructions.md',
  ]) {
    ensureGitignore(path.dirname(dir), entry);
  }
  // AI-managed task/state files that should not pollute the repo
  for (const entry of [
    'TODO.md', 'DONE.md', 'TASKS.md', 'SOUL.md', 'MEMORY.md', 'JOURNAL.md', 'CONTRACTS.md',
    '.autodev/',  
  ]) {
    ensureGitignore(path.dirname(dir), entry);
  }
}

/** Add `entry` to the project .gitignore if not already present. */
function ensureGitignore(root: string, entry: string): void {
  const gitignorePath = path.join(root, '.gitignore');
  try {
    let content = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf8') : '';
    const lines = content.split('\n').map(l => l.trim());
    if (lines.includes(entry)) { return; }
    if (content.length > 0 && !content.endsWith('\n')) { content += '\n'; }
    content += `${entry}\n`;
    fs.writeFileSync(gitignorePath, content, 'utf8');
  } catch { /* ignore — .gitignore may not be writable */ }
}

/** Open the settings file in the editor (create with defaults at the canonical path if missing). */
export async function openSettingsFile(): Promise<void> {
  const readFile  = settingsPathForReading();
  const writeFile = settingsPath();
  if (!writeFile) {
    vscode.window.showWarningMessage('AutoDev: No workspace folder open.');
    return;
  }
  const file = readFile && fs.existsSync(readFile) ? readFile : writeFile;
  if (!fs.existsSync(file)) {
    saveSettings(SETTINGS_DEFAULTS);
  }
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  await vscode.window.showTextDocument(doc);
}

// ---------------------------------------------------------------------------
// Built-in profile list
// ---------------------------------------------------------------------------

export interface ProfileOption {
  title: string;
  description: string;
  filePath: string;
}

function parseFrontmatterMeta(content: string): { title?: string; description?: string } {
  if (!content.startsWith('---')) { return {}; }
  const end = content.indexOf('\n---', 3);
  if (end === -1) { return {}; }
  const block = content.slice(3, end);
  const result: { title?: string; description?: string } = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^(\w+):\s*"?(.+?)"?\s*$/);
    if (!m) { continue; }
    const clean = m[2].replace(/^"|"$/g, '');
    if (m[1] === 'title') { result.title = clean; }
    if (m[1] === 'description') { result.description = clean; }
  }
  return result;
}

/** Return the list of built-in agent profiles from the extension media folder. */
export function getBuiltinProfiles(): ProfileOption[] {
  try {
    const mediaDir = path.join(__dirname, '..', 'media');
    if (!fs.existsSync(mediaDir)) { return []; }
    const files = fs.readdirSync(mediaDir)
      .filter(f => f.endsWith('.md'))
      .sort();
    const profiles: ProfileOption[] = [];
    for (const file of files) {
      const filePath = path.join(mediaDir, file);
      const content = fs.readFileSync(filePath, 'utf8');
      const { title, description } = parseFrontmatterMeta(content);
      if (title) {
        profiles.push({ title, description: description ?? '', filePath });
      }
    }
    return profiles;
  } catch {
    return [];
  }
}
