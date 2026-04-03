// ---------------------------------------------------------------------------
// AI provider definitions
// ---------------------------------------------------------------------------

export type ProviderId = 'claude' | 'claude-cli' | 'copilot' | 'copilot-cli' | 'opencode-cli';

export interface ProviderConfig {
  label: string;
  /** VS Code extension ID required for this provider (empty string for CLI providers). */
  extensionId: string;
  /** True for providers that run in a VS Code terminal instead of the chat UI. */
  isCli?: boolean;
}

export const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  'claude-cli': {
    label: 'Claude CLI',
    extensionId: '',
    isCli: true,
  },
  'copilot-cli': {
    label: 'Copilot CLI',
    extensionId: '',
    isCli: true,
  },
  claude: {
    label: 'Claude UI (beta)',
    extensionId: 'anthropic.claude-code',
  },
  copilot: {
    label: 'Copilot UI (beta)',
    extensionId: 'GitHub.copilot-chat',
  },
  'opencode-cli': {
    label: 'OpenCode CLI (beta)',
    extensionId: '',
    isCli: true,
  },
};
