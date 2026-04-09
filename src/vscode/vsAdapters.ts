import * as vscode from 'vscode';
import * as path from 'path';
import { IFileWatcher, IDisposable, IProcessLauncher } from '../core/adapters';

// ---------------------------------------------------------------------------
// VS Code implementations of the core interfaces.
// These are used by the extension; the SDK uses NodeFileWatcher/NodeProcessLauncher.
// ---------------------------------------------------------------------------

/** Wraps `vscode.workspace.createFileSystemWatcher` to match IFileWatcher. */
export class VsFileWatcher implements IFileWatcher {
  watch(filePath: string, onChange: () => void): IDisposable {
    const pattern = new vscode.RelativePattern(
      path.dirname(filePath),
      path.basename(filePath),
    );
    const w = vscode.workspace.createFileSystemWatcher(pattern);
    w.onDidChange(onChange);
    w.onDidCreate(onChange);
    return { dispose: () => w.dispose() };
  }
}

/** Wraps `vscode.window.createTerminal` to match IProcessLauncher. */
export class VsProcessLauncher implements IProcessLauncher {
  launch(cmd: string, name: string, cwd: string): void {
    vscode.window.terminals.find(t => t.name === name)?.dispose();
    const terminal = vscode.window.createTerminal({ name, cwd });
    terminal.show(true);
    terminal.sendText(cmd);
  }
}
