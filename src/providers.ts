// ---------------------------------------------------------------------------
// AI provider definitions
// ---------------------------------------------------------------------------

export type ProviderId = 'copilot' | 'claude';

export interface ProviderConfig {
  label: string;
  extensionId: string;
}

export const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  copilot: {
    label: 'Copilot',
    extensionId: 'GitHub.copilot-chat',
  },
  claude: {
    label: 'Claude',
    extensionId: 'anthropic.claude-code',
  },
};
