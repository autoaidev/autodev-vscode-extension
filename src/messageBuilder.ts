import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Task } from './todo';
import { autodevDir } from './sessionState';
import { applyProtocolSections, applyMcpSkills } from './protocolSections';
import { assembleProfileBody } from './profileBuilder';
import { loadSettingsForRoot } from './core/settingsLoader';

// ---------------------------------------------------------------------------
// File path constants — all files live under <workspace>/.autodev/
// ---------------------------------------------------------------------------

/** Agent profile instructions written for each task run */
export const AGENT_PROFILE_FILE = '.autodev/AGENT_PROFILE.md';

/** Directory where per-task message files are stored */
export const MESSAGES_DIR = '.autodev/messages';

/** Directory where attachments are saved, grouped by timestamp+hash */
export const ATTACHMENTS_DIR = '.autodev/messages/attachments';

// Marker pair used to identify the autodev-managed block in CLAUDE.md / AGENTS.md
const AGENT_REF_BEGIN = '<!-- autodev:profile-ref:begin -->';
const AGENT_REF_END   = '<!-- autodev:profile-ref:end -->';

/**
 * Ensure `CLAUDE.md` and `AGENTS.md` in `root` contain an import reference
 * to `.autodev/AGENT_PROFILE.md` inside autodev marker tags.
 * Idempotent — replaces the existing block on every rebuild.
 * Creates the file with just the reference block if it doesn't exist yet.
 */
function injectAgentProfileRef(root: string, sectionPaths: string[] = []): void {
  // Inject AGENT_PROFILE.md plus every deployed section file directly so the
  // LLM auto-loads all sub-files (agents only follow @-refs one level deep).
  const lines = [`@${AGENT_PROFILE_FILE}`, ...sectionPaths.map(p => `@${p}`)];
  const ref = lines.join('\n');
  const block = `${AGENT_REF_BEGIN}\n${ref}\n${AGENT_REF_END}`;
  const markerRe = /<!-- autodev:profile-ref:begin -->[\s\S]*?<!-- autodev:profile-ref:end -->/;

  for (const filename of ['CLAUDE.md', 'AGENTS.md']) {
    const filePath = path.join(root, filename);
    let content = '';
    if (fs.existsSync(filePath)) {
      content = fs.readFileSync(filePath, 'utf8');
    }
    if (markerRe.test(content)) {
      // Replace existing block
      content = content.replace(markerRe, block);
    } else {
      // Prepend block — agents read the top of the file first
      content = block + (content ? '\n\n' + content : '');
    }
    fs.writeFileSync(filePath, content, 'utf8');
  }
}

const COPILOT_INSTRUCTIONS_FILE = '.github/copilot-instructions.md';
const COPILOT_BEGIN = '<!-- autodev:profile:begin -->';
const COPILOT_END   = '<!-- autodev:profile:end -->';

/**
 * Sync the assembled profile body into `.github/copilot-instructions.md`.
 * GitHub Copilot cannot follow `@`-import references, so the content is
 * written inline, wrapped in idempotent autodev marker tags.
 * The file is created (including the `.github/` directory) if absent.
 */
function syncCopilotInstructions(root: string, profileBody: string): void {
  const block = `${COPILOT_BEGIN}\n${profileBody.trim()}\n${COPILOT_END}`;
  const markerRe = /<!-- autodev:profile:begin -->[\s\S]*?<!-- autodev:profile:end -->/;

  const githubDir = path.join(root, '.github');
  if (!fs.existsSync(githubDir)) {
    fs.mkdirSync(githubDir, { recursive: true });
  }

  const filePath = path.join(root, COPILOT_INSTRUCTIONS_FILE);
  let content = '';
  if (fs.existsSync(filePath)) {
    content = fs.readFileSync(filePath, 'utf8');
  }
  if (markerRe.test(content)) {
    content = content.replace(markerRe, block);
  } else {
    content = block + (content ? '\n\n' + content : '');
  }
  fs.writeFileSync(filePath, content, 'utf8');
}

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

export interface ProfileMeta {
  title?: string;
  description?: string;
  /** When true, the task instruction omits the commit step */
  noCommit?: boolean;
}

/**
 * Parse YAML-like frontmatter from a markdown file.
 * Returns metadata and the body with frontmatter stripped.
 */
export function parseFrontmatter(content: string): { meta: ProfileMeta; body: string } {
  if (!content.startsWith('---')) {
    return { meta: {}, body: content };
  }
  const end = content.indexOf('\n---', 3);
  if (end === -1) {
    return { meta: {}, body: content };
  }
  const block = content.slice(3, end).trim();
  const body = content.slice(end + 4).trimStart();
  const meta: ProfileMeta = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^(\w+):\s*"?(.+?)"?\s*$/);
    if (!m) { continue; }
    const [, key, val] = m;
    const clean = val.replace(/^"|"$/g, '');
    if (key === 'title') { meta.title = clean; }
    if (key === 'description') { meta.description = clean; }
    if (key === 'noCommit') { meta.noCommit = clean === 'true'; }
  }
  return { meta, body };
}

// ---------------------------------------------------------------------------
// Message builder
// ---------------------------------------------------------------------------



/** Returns the .autodev/messages directory, creating it if needed. */
function messagesDir(root: string): string {
  const dir = path.join(root, MESSAGES_DIR);
  if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
  return dir;
}

/** Generates a timestamp string like 20250410_143022 for use in filenames. */
function timestamp(): string {
  const d = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/**
 * Save an attachment to `.autodev/messages/attachments/<groupId>/filename`.
 * If `groupId` is omitted a new `<timestamp>_<hex>` folder is created.
 * Returns the workspace-relative forward-slash path (suitable for embedding in .md).
 */
export function saveAttachment(
  workspaceRoot: string,
  filename: string,
  data: Buffer | string,
  groupId?: string,
): string {
  const group = groupId ?? `${timestamp()}_${crypto.randomBytes(4).toString('hex')}`;
  const dir = path.join(workspaceRoot, ATTACHMENTS_DIR, group);
  if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
  const filePath = path.join(dir, filename);
  if (Buffer.isBuffer(data)) {
    fs.writeFileSync(filePath, data);
  } else {
    fs.writeFileSync(filePath, data, 'utf8');
  }
  return path.relative(workspaceRoot, filePath).replace(/\\/g, '/');
}

/**
 * Write arbitrary content to a timestamped message file and return the full path.
 * Used for reminder/check-in messages that bypass buildMessage().
 */
export function writeMessageFile(root: string, content: string): string {
  const dir = messagesDir(root);
  const filePath = path.join(dir, `MESSAGE_${timestamp()}.md`);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

function readOrEmpty(filePath: string): string {
  try {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  } catch { return ''; }
}

function buildTaskInstruction(taskText: string, todoContent: string, noCommit = false): string {
  const commitLine = noCommit
    ? 'Do **NOT** commit — the user is responsible for all git operations.'
    : 'Commit each completed task with a descriptive conventional commit message.';

  return `Read \`TODO.md\`, work through every unfinished task from top to bottom, and do not stop until all tasks are marked \`[x]\`.

For each task:
1. Mark it \`[~]\` in \`TODO.md\` **before** starting any work.
2. Implement the task fully.
3. Mark it \`[x] YYYY-MM-DD  task text\` in \`TODO.md\` when done (ISO date, two spaces, original task text).
4. ${commitLine}
5. Immediately continue to the next \`[ ]\` task — do not pause or stop.

The session ends only when \`TODO.md\` contains zero \`[ ]\` and zero \`[~]\` entries.
`;
}

/**
 * Builds the agent message for a task, writing two separate files:
 *   - `.autodev/AGENT_PROFILE.md`                   — profile instructions (frontmatter stripped)
 *   - `.autodev/messages/MESSAGE_<timestamp>.md`     — task + current TODO
 *
 * Returns `{ prompt, messageFile }` where `prompt` is the combined string for UI
 * providers that cannot read files via @-references, and `messageFile` is the
 * absolute path of the written message file for CLI providers.
 */
/**
 * Assembles and writes `.autodev/AGENT_PROFILE.md` from the currently enabled
 * profile sections + any active MCP protocol injections. Also deploys / removes
 * Claude skill files for enabled / disabled MCPs.
 *
 * Called directly from the sidebar "Save & Rebuild Profile" button so the file
 * is updated immediately without waiting for a task run.
 */
export function rebuildProfile(root: string): void {
  autodevDir(root);
  let settings: ReturnType<typeof loadSettingsForRoot> | undefined;
  try { settings = loadSettingsForRoot(root); } catch { /* ignore */ }

  const enabledSections = settings?.enabledProfileSections ?? [];
  const customRefs = settings?.customProfileRefs ?? [];
  const { body: profileBody, sectionPaths } = assembleProfileBody(enabledSections, root, customRefs);
  const finalProfileBody = applyProtocolSections(profileBody, settings);
  applyMcpSkills(root, settings);

  const profileFilePath = path.join(root, AGENT_PROFILE_FILE);
  fs.writeFileSync(profileFilePath, finalProfileBody, 'utf8');
  injectAgentProfileRef(root, sectionPaths);
  syncCopilotInstructions(root, finalProfileBody);
}

export function buildMessage(
  task: Task,
  root: string,
  todoDir: string,
  includeProfile = true,
): { prompt: string; messageFile: string } {
  autodevDir(root);

  // Load workspace settings (MCP servers, enabled profile sections, etc.)
  let settings: ReturnType<typeof loadSettingsForRoot> | undefined;
  try { settings = loadSettingsForRoot(root); } catch { /* ignore */ }

  // Read the noCommit flag from the identity section frontmatter
  const identityFile = path.join(__dirname, '..', 'media', 'profile', '00-identity.md');
  const { meta } = parseFrontmatter(readOrEmpty(identityFile));

  // Assemble the profile index from the enabled section files
  const enabledSections = settings?.enabledProfileSections ?? [];
  const customRefs = settings?.customProfileRefs ?? [];
  const { body: profileBody, sectionPaths } = assembleProfileBody(enabledSections, root, customRefs);

  // Inject protocol sections (email, jira, ...) for any MCP currently enabled
  // in the workspace settings. Toggling an MCP off cleanly removes its block
  // on the next regeneration.
  const finalProfileBody = applyProtocolSections(profileBody, settings);

  // Deploy / remove Claude skill files for enabled / disabled MCPs
  if (root) { applyMcpSkills(root, settings); }

  // Always write the profile file so the LLM can @-reference it
  const profileFilePath = path.join(root, AGENT_PROFILE_FILE);
  fs.writeFileSync(profileFilePath, finalProfileBody, 'utf8');
  injectAgentProfileRef(root, sectionPaths);
  syncCopilotInstructions(root, finalProfileBody);
  // Build the task trigger message — profile is loaded by agents via CLAUDE.md → @.autodev/AGENT_PROFILE.md
  const taskMessage = buildTaskInstruction(task.text, '', meta.noCommit);

  const messageFile = writeMessageFile(root, taskMessage);

  // For UI providers (non-CLI) embed the profile inline since they can't read files
  const parts: string[] = [];
  if (includeProfile && finalProfileBody.trim()) {
    parts.push(`# Project Instructions (AUTODEV.md)\n\n${finalProfileBody.trim()}`);
  }
  parts.push(taskMessage);
  return { prompt: parts.join('\n\n---\n\n'), messageFile };
}
