import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { McpServerManager, DEFAULT_MCP_SERVERS } from './mcpManager';

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
  // MCP sync — project-local only (no global config modifications)
  // -------------------------------------------------------------------------

  /**
   * Write MCP server definitions to project-local config files only.
   * Covers: .claude/settings.local.json, .vscode/mcp.json, opencode.json, .mcp.json
   * The memory server uses <root>/.autodev/MEMORY.jsonl as its storage file.
   */
  static syncProjectMcpServers(root: string, log?: (m: string) => void): void {
    const memoryFilePath = '.autodev/MEMORY.jsonl';

    const servers = [
      ...DEFAULT_MCP_SERVERS,
      {
        name: 'memory',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-memory'],
        env: { MEMORY_FILE_PATH: memoryFilePath },
        tools: ['*'] as string[],
      },
    ];

    // Claude CLI project-local (not committed per-user): .claude/settings.local.json
    _mergeJson(path.join(root, '.claude', 'settings.local.json'), (cfg) => {
      const mcp = _obj(cfg['mcpServers']);
      for (const s of servers) {
        mcp[s.name] = { command: s.command, args: s.args, ...(s.env ? { env: s.env } : {}) };
      }
      cfg['mcpServers'] = mcp;
    }, log, 'Claude project-local MCP (.claude/settings.local.json)');

    // VS Code workspace MCP: .vscode/mcp.json
    _mergeJson(path.join(root, '.vscode', 'mcp.json'), (cfg) => {
      const srv = _obj(cfg['servers']);
      for (const s of servers) {
        srv[s.name] = { command: s.command, args: s.args, ...(s.env ? { env: s.env } : {}) };
      }
      cfg['servers'] = srv;
    }, log, 'VS Code MCP (.vscode/mcp.json)');

    // OpenCode project config: opencode.json (merged with existing permission key)
    _mergeJson(path.join(root, 'opencode.json'), (cfg) => {
      const mcp = _obj(cfg['mcp']);
      for (const s of servers) {
        const entry: Record<string, unknown> = {
          type: 'local',
          command: [s.command, ...s.args],
          enabled: true,
        };
        if (s.env && Object.keys(s.env).length > 0) { entry['environment'] = s.env; }
        mcp[s.name] = entry;
      }
      cfg['mcp'] = mcp;
    }, log, 'OpenCode project MCP (opencode.json)');

    // Copilot CLI project-level: .mcp.json (standard project MCP config)
    _mergeJson(path.join(root, '.mcp.json'), (cfg) => {
      const mcp = _obj(cfg['mcpServers']);
      for (const s of servers) {
        mcp[s.name] = {
          type: 'local',
          command: s.command,
          args: s.args,
          ...(s.env ? { env: s.env } : {}),
          tools: s.tools ?? ['*'],
        };
      }
      cfg['mcpServers'] = mcp;
    }, log, 'Copilot CLI project MCP (.mcp.json)');
  }

  /**
   * @deprecated Use syncProjectMcpServers(root) instead.
   * Kept for backwards compat — no longer called from applyAll.
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

    // Project-local MCP sync — no global config files are modified
    if (root) {
      try { ConfigManager.syncProjectMcpServers(root, log); }
      catch (err) { log?.(`ConfigManager: Project MCP sync error: ${err}`); }
    }
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
