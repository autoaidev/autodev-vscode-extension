import * as fs from 'fs';
import * as path from 'path';
import { Task } from './todo';

// ---------------------------------------------------------------------------
// PromptBuilder — mirrors PHP PromptBuilder
// ---------------------------------------------------------------------------

const AUTODEV_FILENAME = 'AUTODEV.md';
const AUTODEV_DEFAULT_FILENAME = 'AUTODEV.default.md';
const TODO_FILENAME = 'TODO.md';

/** Bundled fallback instructions shipped with the extension (media/AUTODEV.default.md). */
function defaultAutodevPath(): string {
  // __dirname resolves to out/ at runtime; media/ is a sibling of src/ and out/
  return path.join(__dirname, '..', 'media', AUTODEV_DEFAULT_FILENAME);
}

export function buildPrompt(task: Task, todoDir: string, autodevPath?: string): string {
  const resolvedAutodev = autodevPath || path.join(todoDir, AUTODEV_FILENAME);
  const todoPath = path.join(todoDir, TODO_FILENAME);

  // Use workspace AUTODEV.md if it exists, otherwise fall back to the bundled default
  const autodevContent = readOrEmpty(resolvedAutodev) || readOrEmpty(defaultAutodevPath());
  const todoContent = readOrEmpty(todoPath);

  const taskInstruction = buildTaskInstruction(task.text);

  const parts: string[] = [];

  if (autodevContent) {
    parts.push(`# Project Instructions (AUTODEV.md)\n\n${autodevContent.trim()}`);
  }

  if (todoContent) {
    parts.push(`# Current TODO.md\n\n${todoContent.trim()}`);
  }

  parts.push(taskInstruction);

  return parts.join('\n\n---\n\n');
}

function buildTaskInstruction(taskText: string): string {
  return `# Active Task

${taskText}

## Instructions

0. **First**, mark this task as in-progress in **TODO.md** by changing \`[ ]\` to \`[~]\` on this task's line and saving the file.
1. Read and understand the full codebase before making changes.
2. Implement this task completely, including all required files and tests.
3. When the task is done, mark it as completed in **TODO.md** by replacing \`[~]\` with \`[x] YYYY-MM-DD  task text\` (ISO date, two spaces, then the original task text).
4. Commit all changes with a descriptive commit message.
5. Stop after completing this one task — do not start the next task.
`;
}

function readOrEmpty(filePath: string): string {
  try {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  } catch {
    return '';
  }
}
