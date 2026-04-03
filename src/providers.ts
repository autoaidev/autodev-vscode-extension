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
  claude: {
    label: 'Claude',
    extensionId: 'anthropic.claude-code',
  },
  'claude-cli': {
    label: 'Claude CLI',
    extensionId: '',
    isCli: true,
  },
  copilot: {
    label: 'Copilot',
    extensionId: 'GitHub.copilot-chat',
  },
  'copilot-cli': {
    label: 'Copilot CLI',
    extensionId: '',
    isCli: true,
  },
  'opencode-cli': {
    label: 'OpenCode CLI',
    extensionId: '',
    isCli: true,
  },
};
