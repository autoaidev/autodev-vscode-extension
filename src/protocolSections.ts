import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Protocol sections — for each MCP server enabled in settings, look up
// `media/mcp/<server-name>.md` and inject its contents into the agent profile,
// wrapped in BEGIN/END markers. Toggling an MCP off cleanly removes its block
// on the next regeneration.
//
// To add a new protocol: drop a markdown file in `media/mcp/` named exactly
// after the MCP server (e.g. `media/mcp/zerolib-email.md`). No code changes
// required.
// ---------------------------------------------------------------------------

const BEGIN_MARKER = '<!-- AUTODEV:mcp-protocol:';
const END_MARKER   = ':end -->';

interface SettingsLike {
  mcpServers?: Record<string, { enabled?: boolean } | undefined>;
}

function _isEnabled(s: SettingsLike | undefined, name: string): boolean {
  const entry = s?.mcpServers?.[name];
  if (!entry) return false;
  return entry.enabled !== false;
}

function _mcpDir(): string {
  return path.join(__dirname, '..', 'media', 'mcp');
}

/** Strip every existing `<!-- AUTODEV:mcp-protocol:*:begin -->...end -->` block. */
function _stripAllProtocolBlocks(body: string): string {
  // Greedy-safe non-greedy match across newlines
  const re = /\n*<!-- AUTODEV:mcp-protocol:[^:]+:begin -->[\s\S]*?<!-- AUTODEV:mcp-protocol:[^:]+:end -->\n*/g;
  return body.replace(re, '\n').replace(/\n{3,}/g, '\n\n');
}

/**
 * Strip any existing protocol markers from `body`, then append fresh blocks
 * from `media/mcp/<name>.md` for each MCP currently enabled in `settings`.
 */
export function applyProtocolSections(body: string, settings: SettingsLike | undefined): string {
  let out = _stripAllProtocolBlocks(body).trimEnd();

  const dir = _mcpDir();
  if (!fs.existsSync(dir)) return out + '\n';

  const enabledNames = Object.keys(settings?.mcpServers ?? {})
    .filter(name => _isEnabled(settings, name))
    .sort();

  const additions: string[] = [];
  for (const name of enabledNames) {
    const file = path.join(dir, `${name}.md`);
    if (!fs.existsSync(file)) continue;
    let content: string;
    try { content = fs.readFileSync(file, 'utf8').trim(); } catch { continue; }
    if (!content) continue;
    additions.push(
      `${BEGIN_MARKER}${name}:begin -->\n\n${content}\n\n${BEGIN_MARKER}${name}${END_MARKER}`,
    );
  }

  if (additions.length === 0) return out + '\n';
  return out + '\n\n' + additions.join('\n\n') + '\n';
}
