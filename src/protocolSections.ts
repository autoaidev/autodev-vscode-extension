// ---------------------------------------------------------------------------
// Protocol sections — injected into the agent profile based on which MCPs
// are enabled. Wrapped in BEGIN/END markers so toggling an MCP off cleanly
// removes the corresponding rules on the next regeneration.
// ---------------------------------------------------------------------------

const EMAIL_BEGIN = '<!-- AUTODEV:email-protocol:begin -->';
const EMAIL_END   = '<!-- AUTODEV:email-protocol:end -->';
const JIRA_BEGIN  = '<!-- AUTODEV:jira-protocol:begin -->';
const JIRA_END    = '<!-- AUTODEV:jira-protocol:end -->';

const EMAIL_BLOCK = `## Email protocol (zerolib-email MCP)

The \`zerolib-email\` MCP is connected. Use it to communicate with stakeholders.

**Reply rules — to avoid email loops:**
- **Do NOT** send a reply just to confirm a task is completed. Mark the TODO item done and move on.
- **Only reply** when you hit a real problem the sender needs to know about: blocker, missing info, ambiguity, failed dependency, permissions issue.
- One reply per problem. Never reply to your own outgoing messages.
- Do not CC, forward, or escalate to anyone the original sender did not include.
- Subject line: prefix problem replies with \`[needs input]\`. Keep it short.
- Never include credentials, API keys, or secrets in email bodies.`;

const JIRA_BLOCK = `## Jira protocol (mcp-atlassian MCP)

The \`mcp-atlassian\` MCP is connected. Use it to read and update Jira tickets tied to your tasks.

**Comment rules — to avoid notification loops:**
- **Do NOT** comment just to say a ticket is done. Transition status (\`In Progress\` → \`Done\`) and move on.
- **Only comment** when you hit a real problem reviewers need to see: blocker, decision required, scope change, failed acceptance criteria.
- One comment per problem. Never reply to your own previous comments.
- Do not @-mention anyone who isn't already a watcher / assignee / reporter.
- Never include credentials or secrets in comments or descriptions.`;

interface SettingsLike {
  mcpServers?: Record<string, { enabled?: boolean } | undefined>;
}

function _isEnabled(s: SettingsLike | undefined, name: string): boolean {
  const entry = s?.mcpServers?.[name];
  if (!entry) return false;
  return entry.enabled !== false;
}

function _stripBlock(body: string, begin: string, end: string): string {
  const re = new RegExp(`\\n*${_escape(begin)}[\\s\\S]*?${_escape(end)}\\n*`, 'g');
  return body.replace(re, '\n').replace(/\n{3,}/g, '\n\n');
}

function _escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Strip any existing protocol markers from `body`, then append fresh blocks
 * for each MCP currently enabled in `settings`. Returns the new body.
 */
export function applyProtocolSections(body: string, settings: SettingsLike | undefined): string {
  let out = _stripBlock(body, EMAIL_BEGIN, EMAIL_END);
  out = _stripBlock(out, JIRA_BEGIN, JIRA_END);
  out = out.trimEnd();

  const additions: string[] = [];
  if (_isEnabled(settings, 'zerolib-email')) {
    additions.push(`${EMAIL_BEGIN}\n\n${EMAIL_BLOCK}\n\n${EMAIL_END}`);
  }
  if (_isEnabled(settings, 'mcp-atlassian')) {
    additions.push(`${JIRA_BEGIN}\n\n${JIRA_BLOCK}\n\n${JIRA_END}`);
  }

  if (additions.length === 0) return out + '\n';
  return out + '\n\n' + additions.join('\n\n') + '\n';
}
