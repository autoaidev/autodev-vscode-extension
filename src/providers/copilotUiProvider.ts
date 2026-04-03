import * as vscode from 'vscode';

// ---------------------------------------------------------------------------
// Copilot UI provider
// ---------------------------------------------------------------------------

/** Send a prompt to GitHub Copilot Chat (UI-based). */
export async function sendCopilotUi(
  prompt: string,
  log: (msg: string) => void,
): Promise<void> {
  await Promise.resolve(vscode.commands.executeCommand('workbench.action.chat.open', {
    query: prompt,
    isPartialQuery: false,
  }));
  log('Sent to Copilot chat');
}
