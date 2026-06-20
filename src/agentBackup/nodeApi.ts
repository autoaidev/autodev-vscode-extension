/**
 * Pure Node.js entry point for the agent backup module — no `vscode` dependency.
 * This is the target of the `autoaidev/agentBackup` package export and is used
 * by the CLI. The VS Code-specific command wrappers (dialogs, notifications) live
 * in `./export` and `./import` and are only imported inside the extension host.
 */
export { createAgentBackup } from './export';
export type { ExportResult } from './export';
export { restoreAgentBackup } from './import';
export type { ImportResult } from './import';
