import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { McpServerManager } from './mcpManager';

// ---------------------------------------------------------------------------
// ConfigManager — applies permission/settings files for each CLI provider
// and syncs default MCP servers to all of them.
//
// Covers:
//   Claude CLI  : ~/.claude/settings.json  (permissions)
//                 <root>/.claude/settings.json  (project-level allow:*)
//   Copilot CLI : ~/.copilot/mcp-config.json  (MCP only — no extra perms)
//   OpenCode CLI: %APPDATA%/opencode/config.json  (permission: {"*":"allow"})
//                 <root>/opencode.json  (project-level)
//
// MCP entries are merged in via McpServerManager.addDefaults().
// This class is vscode-free so it can be tested or called independently.
// ---------------------------------------------------------------------------

export class ConfigManager {
  // -------------------------------------------------------------------------
  // Claude CLI
  // -------------------------------------------------------------------------

  /**
   * Write bypassPermissions to ~/.claude/settings.json and, if a workspace
   * root is provided, allow:* to <root>/.claude/settings.json.
   */
  static applyClaudePermissions(root?: string, log?: (m: string) => void): void {
    // User-level: bypass all permission prompts
    const userFile = path.join(os.homedir(), '.claude', 'settings.json');
    _mergeJson(userFile, (cfg) => {
      const perms = _obj(cfg['permissions']);
      perms['defaultMode'] = 'bypassPermissions';
      perms['skipDangerousModePermissionPrompt'] = true;
      cfg['permissions'] = perms;
    }, log, 'Claude user settings');

    // Project-level: allow all tools
    if (root) {
      const projectFile = path.join(root, '.claude', 'settings.json');
      _mergeJson(projectFile, (cfg) => {
        const perms = _obj(cfg['permissions']);
        perms['allow'] = ['*'];
        cfg['permissions'] = perms;
      }, log, 'Claude project settings');
    }
  }

  // -------------------------------------------------------------------------
  // OpenCode CLI
  // -------------------------------------------------------------------------

  /**
   * Write permission:{"*":"allow"} to the OpenCode user config and optionally
   * to <root>/opencode.json (project-level).
   */
  static applyOpenCodePermissions(root?: string, log?: (m: string) => void): void {
    // User-level config path reused from McpServerManager
    const userFile = McpServerManager.configPathFor('opencode-cli');
    _mergeJson(userFile, (cfg) => {
      cfg['permission'] = { '*': 'allow' };
    }, log, 'OpenCode user config');

    // Project-level
    if (root) {
      const projectFile = path.join(root, 'opencode.json');
      _mergeJson(projectFile, (cfg) => {
        // Preserve any existing provider/model keys, only touch permission
        cfg['permission'] = { '*': 'allow' };
      }, log, 'OpenCode project config');
    }
  }

  // -------------------------------------------------------------------------
  // MCP sync (delegates to McpServerManager)
  // -------------------------------------------------------------------------

  /**
   * Add any missing default MCP servers to all three CLI providers.
   * Already-present entries are not overwritten.
   */
  static syncDefaultMcpServers(log?: (m: string) => void): void {
    McpServerManager.addDefaults(undefined, log);
  }

  // -------------------------------------------------------------------------
  // Master entry point — call once at extension activation
  // -------------------------------------------------------------------------

  static applyAll(root?: string, log?: (m: string) => void): void {
    try { ConfigManager.applyClaudePermissions(root, log); }
    catch (err) { log?.(`ConfigManager: Claude permissions error: ${err}`); }

    try { ConfigManager.applyOpenCodePermissions(root, log); }
    catch (err) { log?.(`ConfigManager: OpenCode permissions error: ${err}`); }

    try { ConfigManager.syncDefaultMcpServers(log); }
    catch (err) { log?.(`ConfigManager: MCP sync error: ${err}`); }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _obj(val: unknown): Record<string, unknown> {
  return (typeof val === 'object' && val !== null ? val : {}) as Record<string, unknown>;
}

/**
 * Read a JSON file, apply a mutation, and write it back.
 * Creates missing parent directories automatically.
 */
function _mergeJson(
  filePath: string,
  mutate: (cfg: Record<string, unknown>) => void,
  log: ((m: string) => void) | undefined,
  label: string,
): void {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
    let cfg: Record<string, unknown> = {};
    if (fs.existsSync(filePath)) {
      try { cfg = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>; } catch { }
    }
    mutate(cfg);
    fs.writeFileSync(filePath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
    log?.(`ConfigManager: applied ${label}`);
  } catch (err) {
    log?.(`ConfigManager: failed ${label}: ${err}`);
  }
}
