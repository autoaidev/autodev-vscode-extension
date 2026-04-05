import * as fs from 'fs';
import * as path from 'path';
import { Task } from './todo';
import { autodevDir } from './sessionState';

// ---------------------------------------------------------------------------
// File path constants — all files live under <workspace>/.autodev/
// ---------------------------------------------------------------------------

/** Agent profile instructions written for each task run */
export const AGENT_PROFILE_FILE = '.autodev/AGENT_PROFILE.md';

/** Task message written for each task run */
export const MESSAGE_FILE = '.autodev/MESSAGE.md';

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

/** Bundled fallback profile shipped with the extension */
function defaultProfilePath(): string {
  return path.join(__dirname, '..', 'media', 'AUTODEV.default.md');
}

function readOrEmpty(filePath: string): string {
  try {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  } catch { return ''; }
}

function buildTaskInstruction(taskText: string, todoContent: string, noCommit = false): string {
  const commitStep = noCommit
    ? '4. Do **NOT** commit — the user is responsible for all git operations.'
    : '4. Commit all changes with a descriptive conventional commit message.';

  const parts: string[] = [];

  if (todoContent) {
    parts.push(`# Current TODO.md\n\n${todoContent.trim()}`);
  }

  parts.push(`# Active Task

${taskText}

## Instructions

0. **First**, mark this task as in-progress in **TODO.md** by changing \`[ ]\` to \`[~]\` on this task's line and saving the file.
1. Read and understand the full codebase before making changes.
2. Implement this task completely, including all required files and tests.
3. When the task is done, mark it as completed in **TODO.md** by replacing \`[~]\` with \`[x] YYYY-MM-DD  task text\` (ISO date, two spaces, then the original task text).
${commitStep}
5. Stop after completing this one task — do not start the next task.
`);

  return parts.join('\n\n---\n\n');
}

/**
 * Builds the agent message for a task, writing two separate files:
 *   - `.autodev/AGENT_PROFILE.md`  — profile instructions (frontmatter stripped)
 *   - `.autodev/MESSAGE.md`        — task + current TODO
 *
 * Returns the combined prompt string for use by UI providers that cannot
 * read files via @-references.
 */
export function buildMessage(
  task: Task,
  root: string,
  todoDir: string,
  profilePath?: string,
): string {
  autodevDir(root);

  // Resolve and read profile
  const resolvedProfile = profilePath || path.join(todoDir, 'AUTODEV.md');
  let rawProfile = readOrEmpty(resolvedProfile);
  if (!rawProfile) { rawProfile = readOrEmpty(defaultProfilePath()); }

  const { meta, body: profileBody } = parseFrontmatter(rawProfile);

  // Read TODO
  const todoContent = readOrEmpty(path.join(todoDir, 'TODO.md'));

  // Build task message
  const taskMessage = buildTaskInstruction(task.text, todoContent, meta.noCommit);

  // Write split files
  fs.writeFileSync(path.join(root, AGENT_PROFILE_FILE), profileBody, 'utf8');
  fs.writeFileSync(path.join(root, MESSAGE_FILE), taskMessage, 'utf8');

  // Combined string for UI providers
  const parts: string[] = [];
  if (profileBody.trim()) {
    parts.push(`# Project Instructions (AUTODEV.md)\n\n${profileBody.trim()}`);
  }
  parts.push(taskMessage);
  return parts.join('\n\n---\n\n');
}
