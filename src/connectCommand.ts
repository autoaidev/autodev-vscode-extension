import * as vscode from 'vscode';
import { applySetupUrl, applyWsUrl } from 'autodev-cli/connect';
import { loadSettings } from './settings';

// ---------------------------------------------------------------------------
// "Connect to Office" command
//
// Replaces the fiddly hand-paste of a raw WebSocket URL into a Settings field
// with a dedicated flow: the user pastes EITHER a signed pixel-office setup URL
// (GET /api/offices/{slug}/agents/{id}/credentials → data.setupUrl) OR a plain
// office WebSocket URL (wss://host?token=…&endpoint=…). Both are consumed by
// the exact same code the bundled `autodev connect` command runs:
//
//   • setup URL  → applySetupUrl()  — fetch the signed credentials, then write
//                                     .autodev/settings.json + sync MCP config.
//   • WS URL     → applyWsUrl()     — parse token/endpoint, write settings +
//                                     sync MCP config (settings loader derives
//                                     serverBaseUrl/serverApiKey/webhookSlug).
//
// We invoke these in-process rather than spawning a shell: it is the identical
// bundled-CLI connect code (the extension already consumes autodev-cli as a
// library everywhere), it gives clean success/failure via try/catch instead of
// parsing terminal output, and it avoids the terminal-spawn race that
// VsProcessLauncher warns about.
//
// The setup URL is signed and single-use — treat it as a secret. Never echo it
// to logs or error toasts; sanitize any error text that might embed it.
// ---------------------------------------------------------------------------

type Logger = (msg: string) => void;

interface ConnectDeps {
  /** Extension output-channel logger (must never receive the raw URL). */
  log: Logger;
  /** Called after a successful bind so the sidebar re-reads settings/status. */
  onConnected: () => void;
}

/** Register the `autodev.connectOffice` command. */
export function registerConnectCommand(
  context: vscode.ExtensionContext,
  deps: ConnectDeps,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('autodev.connectOffice', () => connectOffice(deps)),
  );
}

/**
 * Strip anything that looks like a signed/secret URL out of a user-facing
 * string. Removes the exact URL the user pasted and redacts the query string of
 * any other URL (token/sig/endpoint live there).
 */
function redactUrls(text: string, secret: string): string {
  let out = text;
  if (secret) { out = out.split(secret).join('<url>'); }
  out = out.replace(/(https?:\/\/[^\s?]+)\?[^\s]*/gi, '$1?<redacted>');
  out = out.replace(/(wss?:\/\/[^\s?]+)\?[^\s]*/gi, '$1?<redacted>');
  return out;
}

async function connectOffice(deps: ConnectDeps): Promise<void> {
  const { log, onConnected } = deps;
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) {
    vscode.window.showWarningMessage('AutoDev: Open a workspace folder before connecting to an office.');
    return;
  }

  const input = await vscode.window.showInputBox({
    title: 'AutoDev: Connect to Office',
    prompt: 'Paste a pixel-office setup URL or a WebSocket URL to bind this workspace.',
    placeHolder: 'https://office.example/api/offices/<slug>/agents/<id>/credentials?sig=…   or   wss://host?token=…&endpoint=…',
    ignoreFocusOut: true,
    validateInput: (value) => {
      const v = value.trim();
      if (!v) { return 'Enter a setup URL or a WebSocket URL.'; }
      let u: URL;
      try { u = new URL(v); } catch { return 'That is not a valid URL.'; }
      if (!['http:', 'https:', 'ws:', 'wss:'].includes(u.protocol)) {
        return 'URL must start with https://, http://, wss://, or ws://.';
      }
      return undefined;
    },
  });

  if (input === undefined) { return; } // user cancelled
  const url = input.trim();
  const isWs = url.startsWith('ws://') || url.startsWith('wss://');

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'AutoDev: Connecting to office…' },
    async () => {
      try {
        if (isWs) {
          // Plain office WS URL: parse + save + MCP sync (settings loader derives
          // serverBaseUrl/serverApiKey/webhookSlug from the URL).
          applyWsUrl(root, url);
        } else {
          // Signed setup URL: fetch credentials, then save + MCP sync.
          await applySetupUrl(root, url);
        }
        // Re-read the just-written settings to name the office in the toast.
        const s = loadSettings();
        const slug = s.webhookSlug || 'office';
        onConnected(); // refresh the sidebar so SERVER/status shows connected
        log(`Connected to office (endpoint: ${slug})`);
        vscode.window.showInformationMessage(`AutoDev: Connected to office ${slug}`);
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        const msg = redactUrls(raw, url);
        log(`Connect to office failed: ${msg}`);
        vscode.window.showErrorMessage(`AutoDev: Failed to connect to office — ${msg}`);
      }
    },
  );
}
