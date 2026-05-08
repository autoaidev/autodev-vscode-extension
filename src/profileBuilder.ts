import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Profile section definitions
// ---------------------------------------------------------------------------

export interface ProfileSection {
  /** Slug used in HTML comment markers and settings key */
  id: string;
  /** Human-readable label for the sidebar ProfileBuilder checkbox */
  label: string;
  /** Filename inside media/profile/ */
  file: string;
  /** 2–3 critical rules shown inline in the index. Full content lives in the file. */
  keyRules: string[];
}

export const PROFILE_SECTIONS: ProfileSection[] = [
  {
    id: '00-identity', label: 'Identity & Autonomous Mode', file: '00-identity.md',
    keyRules: [
      'Work autonomously — never ask for permission or pause for confirmation.',
      'Mark tasks `[~]` before starting, `[x] YYYY-MM-DD` when done.',
      'Read `TODO.md` at the start of every session.',
    ],
  },
  {
    id: '01-learning', label: 'Learning Protocol (SUMMARY.md)', file: '01-learning.md',
    keyRules: [
      'After each completed task append lessons to `SUMMARY.md`.',
      'Never repeat a mistake already recorded in `SUMMARY.md`.',
    ],
  },
  {
    id: '02-memory-mcp', label: 'Memory MCP — State Persistence', file: '02-memory-mcp.md',
    keyRules: [
      'Use Memory MCP to persist state, decisions, and context across sessions.',
      'Read memory at session start; write updates after every significant action.',
    ],
  },
  {
    id: '03-living-docs', label: 'Living Project Docs', file: '03-living-docs.md',
    keyRules: [
      'Keep `PROJECT.md`, `TROUBLESHOOTING.md`, `SETUP.md`, and `CHANGELOG.md` current.',
      'Update docs as part of every task — not as an afterthought.',
    ],
  },
  {
    id: '04-skill-files', label: 'Automatic Skill Development', file: '04-skill-files.md',
    keyRules: [
      'Read `copilot-instructions.md`, `CLAUDE.md`, and `AGENTS.md` before starting any task.',
      'Distil reusable patterns into skill files after discovering them.',
    ],
  },
  {
    id: '05-skill-creation', label: 'Skill Creation Protocol', file: '05-skill-creation.md',
    keyRules: [
      'Create a skill file for any pattern applied more than once.',
      'Skill files live in `.claude/skills/<slug>/SKILL.md`.',
    ],
  },
  {
    id: '06-core-rules', label: 'Core Rules & TODO Archival', file: '06-core-rules.md',
    keyRules: [
      'Read every file before editing it. Use safe, reversible writes.',
      'Archive done tasks to `DONE.md` when TODO.md exceeds scope.',
    ],
  },
  {
    id: '07-core-loop', label: 'Core Loop & Task Classification', file: '07-core-loop.md',
    keyRules: [
      'Classify → Plan → Implement → Verify. Never skip the Verify step.',
      'Work tasks top-to-bottom; do not skip or reorder without a recorded reason.',
    ],
  },
  {
    id: '08-thinking', label: 'Thinking, Decomposition & Validation', file: '08-thinking.md',
    keyRules: [
      'Think step-by-step before acting on any multi-file task.',
      'Decompose tasks that touch more than 3 files into explicit subtasks.',
    ],
  },
  {
    id: '09-parallel-panel', label: 'Parallel Specialist Panel (§2)', file: '09-parallel-panel.md',
    keyRules: [
      'For complex decisions, consult the 5-agent specialist panel before acting.',
      'Record panel consensus in the task notes before implementing.',
    ],
  },
  {
    id: '10-codebase-verification', label: 'Codebase Orientation & Verification', file: '10-codebase-verification.md',
    keyRules: [
      'Run orientation (grep, search, read key files) before writing any code.',
      'After every change, verify with tests and a diff review.',
    ],
  },
  {
    id: '11-git-debug-security', label: 'Git, Debugging & Security', file: '11-git-debug-security.md',
    keyRules: [
      'Use conventional commits (`feat:`, `fix:`, `chore:` …). One concern per commit.',
      'Apply OWASP Top-10 checks before marking any security-sensitive task done.',
    ],
  },
  {
    id: '12-todo-format', label: 'TODO.md Format & Marking Rules', file: '12-todo-format.md',
    keyRules: [
      '`[ ]` pending · `[~]` in-progress · `[x] YYYY-MM-DD` done. Never omit the `[ ]`.',
      'Read 3 lines above and below any TODO entry before acting on it.',
    ],
  },
  {
    id: '13-workflow-principles', label: 'Workflow, Quality & Principles', file: '13-workflow-principles.md',
    keyRules: [
      'Feature work: branch → implement → test → PR. No direct commits to main.',
      'Quality gate: lint + tests green before any task is marked `[x]`.',
    ],
  },
];

/** Returns all section IDs in order — useful as the default "all enabled" value. */
export const ALL_SECTION_IDS: string[] = PROFILE_SECTIONS.map(s => s.id);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function profileMediaDir(): string {
  return path.join(__dirname, '..', 'media', 'profile');
}

function md5(content: string): string {
  return crypto.createHash('md5').update(content).digest('hex');
}

/**
 * Copy a section file from `media/profile/` to `<root>/.autodev/profile/`
 * so it is accessible via `@.autodev/profile/<file>` references inside the
 * workspace. Returns the workspace-relative `@` path, or null on failure.
 */
function deploySectionFile(section: ProfileSection, root: string): string | null {
  const src = path.join(profileMediaDir(), section.file);
  if (!fs.existsSync(src)) { return null; }
  const destDir = path.join(root, '.autodev', 'profile');
  if (!fs.existsSync(destDir)) { fs.mkdirSync(destDir, { recursive: true }); }
  const dest = path.join(destDir, section.file);
  try {
    fs.copyFileSync(src, dest);
    return `.autodev/profile/${section.file}`;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Profile assembly — index format
// ---------------------------------------------------------------------------

/**
 * Assemble AGENT_PROFILE.md as a compact **index**:
 * - Each enabled section shows its key rules inline (immediate context).
 * - A `@.autodev/profile/<file>` line lets agents load the full section on demand.
 * - Full section files are copied to `<root>/.autodev/profile/` so the `@`
 *   references resolve inside the workspace.
 * - Custom `@path` references are appended at the end.
 *
 * @param enabledIds    Section IDs to include. Empty = all sections.
 * @param root          Workspace root. Required to deploy section files.
 * @param customRefs    Additional `@path` lines to append (from user settings).
 */
export function assembleProfileBody(
  enabledIds: string[] | undefined,
  root: string,
  customRefs: string[] = [],
): string {
  const ids = enabledIds && enabledIds.length > 0 ? enabledIds : ALL_SECTION_IDS;
  const orderedSections = PROFILE_SECTIONS.filter(s => ids.includes(s.id));

  const header = [
    '# AutoDev Agent Profile',
    '',
    '> This is a **protocol index**. Read the key rules for each section now.',
    '> Before working in a domain, load its full protocol via the `@` reference below.',
    '',
    '---',
    '',
  ].join('\n');

  const parts: string[] = [];

  for (const section of orderedSections) {
    const refPath = deploySectionFile(section, root);
    const refLine = refPath ? `\n→ Full protocol: @${refPath}` : '';
    const rulesLines = section.keyRules.map(r => `- ${r}`).join('\n');
    // Hash over key rules + ref so the marker changes if either is updated
    const hash = md5(rulesLines + refLine);
    const block = [
      `<!-- AUTODEV:section:${section.id}:begin:md5=${hash} -->`,
      `### ${section.label}`,
      rulesLines,
      refLine,
      `<!-- AUTODEV:section:${section.id}:end -->`,
    ].join('\n');
    parts.push(block);
  }

  let body = header + parts.join('\n\n') + '\n';

  // Append custom references
  const validCustom = customRefs.map(r => r.trim()).filter(r => r.length > 0);
  if (validCustom.length > 0) {
    body += '\n---\n\n## Custom References\n\n';
    body += validCustom.map(r => r.startsWith('@') ? r : `@${r}`).join('\n');
    body += '\n';
  }

  return body;
}
