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
    // Reuse an existing live terminal when one is already at a prompt.
    // Disposing+recreating races the shell boot — sendText() can land before
    // bash/PowerShell is reading stdin, silently dropping the command. Reusing
    // the terminal avoids the race because the prompt is already up.
    const existing = vscode.window.terminals.find(
      t => t.name === name && t.exitStatus === undefined,
    );
    let terminal: vscode.Terminal;
    if (existing) {
      terminal = existing;
    } else {
      // Drop any dead terminal with the same name so the new one keeps the label.
      vscode.window.terminals.find(t => t.name === name)?.dispose();
      terminal = vscode.window.createTerminal({ name, cwd });
    }
    terminal.show(true);
    terminal.sendText(cmd);
  }
}
