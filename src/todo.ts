import * as fs from 'fs';

// ---------------------------------------------------------------------------
// TODO.md parser — mirrors PHP TodoParser/TodoWriter
// ---------------------------------------------------------------------------

export type TaskStatus = 'todo' | 'in-progress' | 'done';

export interface Task {
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
  let section = '';
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    // Section headings: ## Todo  ## In Progress  ## Done
    const headingMatch = line.match(/^\s*#{1,3}\s+(.+)$/u);
    if (headingMatch) {
      section = headingMatch[1].toLowerCase().trim();
      continue;
    }

    const task = parseLine(line, section, lineNo);
    if (task) { tasks.push(task); }
  }
  return tasks;
}

function parseLine(line: string, section: string, lineNo: number): Task | null {
  const ln = line.trimEnd();

  // Done:        - [x] 2026-02-28  text
  let m = ln.match(/^\s*(?:-\s*)?\[x\]\s*(\d{4}-\d{2}-\d{2}\s+)?(.+)$/iu);
  if (m) { return { status: 'done', text: m[2].trim(), completedDate: m[1]?.trim(), line: lineNo }; }

  // In progress: - [~] text
  m = ln.match(/^\s*(?:-\s*)?\[~\]\s*(.+)$/iu);
  if (m) { return { status: 'in-progress', text: m[1].trim(), line: lineNo }; }

  // Todo:        - [ ] text
  m = ln.match(/^\s*(?:-\s*)?\[\s+\]\s*(.+)$/iu);
  if (m) { return { status: 'todo', text: m[1].trim(), line: lineNo }; }

  // Plain bullet under a known section
  m = ln.match(/^\s*-\s+(.+)$/u);
  if (m) {
    const text = m[1].trim();
    if (section.includes('done')) { return { status: 'done', text, line: lineNo }; }
    if (section.includes('progress')) { return { status: 'in-progress', text, line: lineNo }; }
    if (section.includes('todo')) { return { status: 'todo', text, line: lineNo }; }
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

/** Append a new task line to the ## Todo section. */
export function appendTask(filePath: string, text: string): void {
  let content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const todoMatch = content.match(/^(##\s+Todo\s*\n)/mu);
  if (todoMatch && todoMatch.index !== undefined) {
    const insertAt = todoMatch.index + todoMatch[0].length;
    content = content.slice(0, insertAt) + `- [ ] ${text}\n` + content.slice(insertAt);
  } else {
    content += `\n## Todo\n- [ ] ${text}\n`;
  }
  fs.writeFileSync(filePath, content, 'utf8');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
