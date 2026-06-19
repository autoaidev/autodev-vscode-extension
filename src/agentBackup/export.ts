import * as path from 'path';
import * as vscode from 'vscode';
import { AdmZipArchive } from './archive';
import { ARCHIVE_PATHS, ROOT_DOCS, WORKSPACE_DIRS } from './layout';
import { SESSION_BACKUP_PROVIDERS } from './sessionProviders';
import { ProviderManifestEntry, SessionManifest, readSessionState } from './manifest';

/**
 * Bundle an agent's traces, memory and protocol files into a single ZIP so
 * it can be preserved or moved to another folder/machine. The structure is
 * defined once in {@link './layout'} and shared with the import path.
 */
export async function exportAgentBackup(root: string): Promise<void> {
  const archive = AdmZipArchive.create();

  // Workspace state directories (single source of truth in layout).
  for (const rel of WORKSPACE_DIRS) {
    archive.addDir(path.join(root, rel), `${ARCHIVE_PATHS.workspace}/${rel}`);
  }

  // Root-level agent docs.
  for (const f of ROOT_DOCS) {
    archive.addFile(path.join(root, f), `${ARCHIVE_PATHS.workspace}/${f}`);
  }

  // Provider session traces (Strategy — one entry per provider family).
  const sessionState = readSessionState(root);
  const providers: Record<string, ProviderManifestEntry> = {};
  let capturedCount = 0;
  for (const provider of SESSION_BACKUP_PROVIDERS) {
    const result = await provider.collect(root, archive);
    const connected: Record<string, string | null> = {};
    for (const key of provider.sessionStateKeys) {
      connected[key] = sessionState[key] ?? null;
    }
    providers[provider.id] = {
      portability: provider.portability,
      note: provider.note,
      discoveredSessionIds: result.discoveredIds,
      connectedSessionIds: connected,
      tracesCaptured: result.tracesCaptured,
    };
    if (result.tracesCaptured) { capturedCount++; }
  }

  // Session-ID manifest (per-provider, honest portability tags).
  const manifest: SessionManifest = {
    exportedAt: new Date().toISOString(),
    workspaceRoot: root,
    providers,
  };
  archive.addBuffer(ARCHIVE_PATHS.manifest, Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));

  const dest = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(root, 'agent.zip')),
    title: 'Export Agent Backup ZIP',
    filters: { 'ZIP Archive': ['zip'] },
  });
  if (!dest) { return; }

  archive.write(dest.fsPath);
  const captured = Object.entries(providers)
    .filter(([, e]) => e.tracesCaptured)
    .map(([id]) => id);
  const detail = capturedCount > 0
    ? `Traces captured: ${captured.join(', ')}.`
    : 'Workspace state captured (no portable provider traces found).';
  const action = await vscode.window.showInformationMessage(
    `AutoDev: Agent backup exported to ${path.basename(dest.fsPath)}. ${detail}`,
    'Reveal in Explorer',
  );
  if (action === 'Reveal in Explorer') {
    void vscode.commands.executeCommand('revealFileInOS', dest);
  }
}
