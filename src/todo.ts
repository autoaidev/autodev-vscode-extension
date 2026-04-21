import * as fs from 'fs';
import * as crypto from 'crypto';

/** Generate a task ID like "task-20260421-a3f9k2" */
function shortId(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const hash = crypto.randomBytes(4).toString('hex').slice(0, 6);
  return `task-${date}-${hash}`;
}

// ---------------------------------------------------------------------------
// TODO.md parser — mirrors PHP TodoParser/TodoWriter
// ---------------------------------------------------------------------------

export type TaskStatus = 'todo' | 'in-progress' | 'done';

export interface Task {
  id?: string;
  status: TaskStatus;
  text: string;
  completedDate?: string;
  /** 1-based line number in the file */
  line: number;
}

/** Parse TODO.md into an ordered list of Tasks. */
export function parseTodo(filePath: string): Task[] {
  if (!fs.existsSync(filePath)) { return []; }
  const content = fs.readFileSync(filePath, 'utf8');
  return parseTodoContent(content);
}

export function parseTodoContent(content: string): Task[] {
  const tasks: Task[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const task = parseLine(lines[i], i + 1);
    if (task) { tasks.push(task); }
  }
  return tasks;
}

/** Extract optional leading task ID, e.g. "[task-20260421-a3f9k2] actual text" */
function extractId(raw: string): { id?: string; text: string } {
  const m = raw.match(/^\[(task-\d{8}-[a-f0-9]{6})\]\s+(.+)$/i);
  if (m) { return { id: m[1], text: m[2] }; }
  return { text: raw };
}

function parseLine(line: string, lineNo: number): Task | null {
  const ln = line.trimEnd();

  // Done:        - [x] 2026-02-28  text
  let m = ln.match(/^\s*(?:-\s*)?\[x\]\s*(\d{4}-\d{2}-\d{2}\s+)?(.+)$/iu);
  if (m) {
    const { id, text } = extractId(m[2].trim());
    return { id, status: 'done', text, completedDate: m[1]?.trim(), line: lineNo };
  }

  // In progress: - [~] text
  m = ln.match(/^\s*(?:-\s*)?\[~\]\s*(.+)$/iu);
  if (m) {
    const { id, text } = extractId(m[1].trim());
    return { id, status: 'in-progress', text, line: lineNo };
  }

  // Todo:        - [ ] text
  m = ln.match(/^\s*(?:-\s*)?\[\s+\]\s*(.+)$/iu);
  if (m) {
    const { id, text } = extractId(m[1].trim());
    return { id, status: 'todo', text, line: lineNo };
  }

  return null;
}

/** Return the first todo task (not in-progress), or null if none pending. */
export function pickNextTask(tasks: Task[]): Task | null {
  return tasks.find(t => t.status === 'todo') ?? null;
}

export function countRemaining(tasks: Task[]): number {
  return tasks.filter(t => t.status === 'todo' || t.status === 'in-progress').length;
}

// ---------------------------------------------------------------------------
// TODO.md writer — mark tasks in-progress or done
// ---------------------------------------------------------------------------

export function markInProgress(filePath: string, task: Task): void {
  const content = fs.readFileSync(filePath, 'utf8');
  const escaped = escapeRegex(task.text);
  const updated = content.replace(
    new RegExp(`(^\\s*(?:-\\s*)?)(\\[\\s+\\])(\\s+${escaped}.*)$`, 'mu'),
    '$1[~]$3'
  );
  fs.writeFileSync(filePath, updated, 'utf8');
}

/** Reset a [~] in-progress task back to [ ] todo. */
export function resetToTodo(filePath: string, task: Task): void {
  const content = fs.readFileSync(filePath, 'utf8');
  const escaped = escapeRegex(task.text);
  const updated = content.replace(
    new RegExp(`(^\\s*(?:-\\s*)?)\\[~\\](\\s+${escaped}.*)$`, 'mu'),
    '$1[ ]$2'
  );
  fs.writeFileSync(filePath, updated, 'utf8');
}

/** Reset ALL [~] in-progress tasks back to [ ] todo. */
export function resetAllInProgress(filePath: string): void {
  if (!fs.existsSync(filePath)) { return; }
  const content = fs.readFileSync(filePath, 'utf8');
  const updated = content.replace(/^(\s*(?:-\s*)?)\[~\]/gmu, '$1[ ]');
  fs.writeFileSync(filePath, updated, 'utf8');
}

export function markDone(filePath: string, task: Task): void {
  const date = new Date().toISOString().slice(0, 10);
  const escaped = escapeRegex(task.text);
  const content = fs.readFileSync(filePath, 'utf8');

  // Try replacing [~] first, then [ ]
  let updated = content.replace(
    new RegExp(`(^\\s*(?:-\\s*)?)\\[~\\](\\s+${escaped}.*)$`, 'mu'),
    `$1[x] ${date}  ${task.text}`
  );
  if (updated === content) {
    updated = content.replace(
      new RegExp(`(^\\s*(?:-\\s*)?)\\[\\s+\\](\\s+${escaped}.*)$`, 'mu'),
      `$1[x] ${date}  ${task.text}`
    );
  }
  fs.writeFileSync(filePath, updated, 'utf8');
}

/** Append a new task line to the ## Todo section (at the bottom, before the next heading). */
export function appendTask(filePath: string, text: string): string {
  const id = shortId();
  const line = `- [ ] [${id}] ${text}`;
  let content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const todoMatch = content.match(/^(##\s+Todo\s*\n)/mu);
  if (todoMatch && todoMatch.index !== undefined) {
    const afterHeading = todoMatch.index + todoMatch[0].length;
    // Find the next ## heading after the Todo heading (In Progress / Done / etc.)
    const rest = content.slice(afterHeading);
    const nextSection = rest.match(/^##\s+/mu);
    const insertAt = nextSection ? afterHeading + nextSection.index! : content.length;
    content = content.slice(0, insertAt) + line + '\n' + content.slice(insertAt);
  } else {
    content += `\n## Todo\n${line}\n`;
  }
  fs.writeFileSync(filePath, content, 'utf8');
  return id;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
