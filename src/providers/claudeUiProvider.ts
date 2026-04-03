import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/** Encode a PowerShell script as UTF-16LE base64 for -EncodedCommand. */
export function psEncoded(script: string): string {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return `powershell -NoProfile -WindowStyle Hidden -EncodedCommand ${encoded}`;
}

function sendEnter(log: (msg: string) => void): void {
  let cmd: string;
  if (process.platform === 'win32') {
    cmd = psEncoded(`Add-Type -AssemblyName System.Windows.Forms\n[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')`);
  } else if (process.platform === 'darwin') {
    cmd = `osascript -e 'tell application "System Events" to key code 36'`;
  } else {
    cmd = `xdotool key Return`;
  }
  exec(cmd, err => { if (err) { log(`sendEnter error: ${err.message}`); } });
}

function pasteAndSubmit(log: (msg: string) => void): void {
  let cmd: string;
  if (process.platform === 'win32') {
    const script = [
      `Add-Type -TypeDefinition @'`,
      `using System; using System.Runtime.InteropServices;`,
      `public class WinFocus {`,
      `  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);`,
      `  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();`,
      `  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);`,
      `  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);`,
      `  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();`,
      `}`,
      `'@ -ErrorAction SilentlyContinue`,
      `$p = Get-Process -Name 'Code' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1`,
      `if ($p) {`,
      `  $fg = [WinFocus]::GetForegroundWindow()`,
      `  $fgTid = 0; [WinFocus]::GetWindowThreadProcessId($fg, [ref]$fgTid) | Out-Null`,
      `  $vsTid = 0; [WinFocus]::GetWindowThreadProcessId($p.MainWindowHandle, [ref]$vsTid) | Out-Null`,
      `  [WinFocus]::AttachThreadInput($vsTid, $fgTid, $true) | Out-Null`,
      `  [WinFocus]::SetForegroundWindow($p.MainWindowHandle) | Out-Null`,
      `  [WinFocus]::AttachThreadInput($vsTid, $fgTid, $false) | Out-Null`,
      `  Start-Sleep -Milliseconds 400`,
      `}`,
      `Add-Type -AssemblyName System.Windows.Forms`,
      `[System.Windows.Forms.SendKeys]::SendWait('^v')`,
      `Start-Sleep -Milliseconds 1000`,
      `[System.Windows.Forms.SendKeys]::SendWait(' ')`,
      `Start-Sleep -Milliseconds 300`,
      `[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')`,
    ].join('\n');
    cmd = psEncoded(script);
  } else if (process.platform === 'darwin') {
    cmd = [
      `osascript -e 'tell application "Visual Studio Code" to activate'`,
      `sleep 0.4`,
      `osascript -e 'tell application "System Events" to keystroke "v" using {command down}'`,
      `sleep 1.0`,
      `osascript -e 'tell application "System Events" to keystroke " "'`,
      `sleep 0.3`,
      `osascript -e 'tell application "System Events" to key code 36'`,
    ].join(' && ');
  } else {
    cmd = [
      `xdotool search --name "Visual Studio Code" windowactivate --sync 2>/dev/null || true`,
      `sleep 0.4`,
      `xdotool key ctrl+v`,
      `sleep 1.0`,
      `xdotool type ' '`,
      `sleep 0.3`,
      `xdotool key Return`,
    ].join(' && ');
  }
  exec(cmd, err => { if (err) { log(`pasteAndSubmit error: ${err.message}`); } });
}

// ---------------------------------------------------------------------------
// Claude UI provider
// ---------------------------------------------------------------------------

/**
 * Send a prompt to the Claude VS Code extension (UI-based).
 * Uses clipboard paste into an existing panel, or opens a new one via URI.
 */
export async function sendClaudeUi(
  prompt: string,
  root: string,
  sessionId: string | undefined,
  log: (msg: string) => void,
): Promise<void> {
  const existingTab = vscode.window.tabGroups.all
    .flatMap(g => g.tabs)
    .find(t =>
      t.input instanceof vscode.TabInputWebview && (
        t.input.viewType.toLowerCase().includes('claude') ||
        t.label.toLowerCase().includes('claude')
      )
    );

  if (existingTab) {
    if (root) {
      fs.writeFileSync(path.join(root, 'TEMP_PROMPT.md'), prompt, 'utf8');
    }
    await vscode.env.clipboard.writeText('@TEMP_PROMPT.md');
    await vscode.commands.executeCommand('claude-vscode.focus');
    await sleep(300);
    pasteAndSubmit(log);
    log('Sent to Claude via clipboard paste + Enter (existing panel, @ref)');
  } else {
    const promptParam = encodeURIComponent(prompt.slice(0, 2000));
    const sessionParam = sessionId ? `&session=${encodeURIComponent(sessionId)}` : '';
    const uri = `vscode://anthropic.claude-code/open?prompt=${promptParam}${sessionParam}`;
    await new Promise<void>(resolve => {
      const openCmd = process.platform === 'win32'
        ? psEncoded(`Start-Process "${uri}"`)
        : process.platform === 'darwin'
          ? `open "${uri}"`
          : `xdg-open "${uri}"`;
      exec(openCmd, () => resolve());
    });
    await sleep(1500);
    sendEnter(log);
    log(`Sent to Claude via vscode:// URI + Enter (session=${sessionId ?? 'new'})`);
  }
}
