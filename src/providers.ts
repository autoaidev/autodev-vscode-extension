// ---------------------------------------------------------------------------
// AI provider definitions — CLI-only providers
// ---------------------------------------------------------------------------

export type ProviderId = 'claude-cli' | 'copilot-cli' | 'opencode-cli';

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
  'opencode-cli': {
    label: 'OpenCode CLI',
    extensionId: '',
    isCli: true,
  },
};
