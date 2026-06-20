import * as path from 'path';
import { AdmZipArchive } from './archive';
import { ARCHIVE_PATHS, TOP_FOLDER } from './layout';
import { SESSION_BACKUP_PROVIDERS } from './sessionProviders';
import { parseManifest } from './manifest';

export interface ImportResult {
  destRoot: string;
  workspaceFiles: number;
  /** Provider id → number of session-trace files restored. */
  restoredByProvider: Record<string, number>;
  manifestRestored: boolean;
}

/**
 * Restore an agent backup ZIP into a destination folder and wire up its
 * session state so it resumes there. Mirrors {@link './export'} using the
 * same shared layout (DRY).
 *
 * The workspace `.autodev/` (including `session-state.json`) is restored
 * verbatim, so connected session IDs travel automatically — the per-provider
 * `restore()` calls place the matching traces into each host store.
 */
export async function restoreAgentBackup(zipPath: string, destRoot: string): Promise<ImportResult> {
  const archive = AdmZipArchive.open(zipPath);

  // Reject archives that aren't an agent backup.
  if (!archive.entryPaths().some(p => p.startsWith(`${TOP_FOLDER}/`))) {
    throw new Error('Not an AutoDev agent backup (missing agent-export/ root).');
  }

  // 1. Workspace state + root docs back into the destination folder.
  const workspaceFiles = archive.extractDir(ARCHIVE_PATHS.workspace, destRoot);

  // 2. Provider session traces into their host stores (Strategy).
  const restoredByProvider: Record<string, number> = {};
  for (const provider of SESSION_BACKUP_PROVIDERS) {
    const n = await provider.restore(destRoot, archive);
    if (n > 0) { restoredByProvider[provider.id] = n; }
  }

  const manifest = parseManifest(archive.readText(ARCHIVE_PATHS.manifest));
  return { destRoot, workspaceFiles, restoredByProvider, manifestRestored: !!manifest };
}

/**
 * Interactive command flow: pick a backup ZIP, pick a destination folder,
 * restore, then offer to open the restored workspace.
 */
export async function importAgentBackup(defaultRoot?: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const vscode = require('vscode') as typeof import('vscode');
  const picked = await vscode.window.showOpenDialog({
    title: 'Select Agent Backup ZIP',
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: { 'ZIP Archive': ['zip'] },
    defaultUri: defaultRoot ? vscode.Uri.file(defaultRoot) : undefined,
  });
  if (!picked || picked.length === 0) { return; }

  const destPick = await vscode.window.showOpenDialog({
    title: 'Select Destination Folder for Restored Agent',
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Restore Here',
    defaultUri: defaultRoot ? vscode.Uri.file(defaultRoot) : undefined,
  });
  if (!destPick || destPick.length === 0) { return; }

  const zipPath = picked[0].fsPath;
  const destRoot = destPick[0].fsPath;

  try {
    const result = await restoreAgentBackup(zipPath, destRoot);
    const sameWorkspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath === destRoot;
    const restored = Object.entries(result.restoredByProvider)
      .map(([id, n]) => `${id} (${n})`)
      .join(', ');
    const detail = restored
      ? ` Session traces restored: ${restored}.`
      : '';
    const action = await vscode.window.showInformationMessage(
      `AutoDev: Restored agent (${result.workspaceFiles} file(s)) to ${path.basename(destRoot)}.${detail}`,
      ...(sameWorkspace ? [] : ['Open Folder']),
    );
    if (action === 'Open Folder') {
      void vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(destRoot), { forceNewWindow: true });
    }
  } catch (e) {
    vscode.window.showErrorMessage(`AutoDev: Import failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
