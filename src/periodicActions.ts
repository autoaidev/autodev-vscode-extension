import * as fs from 'fs';
import * as path from 'path';
import { AutodevSettings } from './core/settingsLoader';

// ---------------------------------------------------------------------------
// Periodic Action Manager — "every N tasks" triggers
//
// Add a new entry to PERIODIC_ACTIONS to create a new periodic trigger.
// Each entry automatically gets:
//   - its own counter tracked internally in PeriodicActionManager
//   - a settings key (N = 0 means disabled)
//   - a sidebar UI row (label + select + custom input)
//   - the prompt sent to the agent when the counter reaches N
//
// Debug state is written to <workspaceRoot>/.autodev/loop-state.json after
// every completed task so you can inspect iteration numbers and counters.
// ---------------------------------------------------------------------------

export interface PeriodicActionDef {
  /** Unique stable ID. Used as HTML element id prefix and counter key. */
  id: string;
  /** Sidebar label shown to the user. */
  label: string;
  /** Key in AutodevSettings that holds the interval (0 = disabled). */
  settingKey: keyof AutodevSettings;
  /** Log icon (emoji) used in the extension host log. */
  icon: string;
  /**
   * How the action is executed when due:
   * - 'prompt'     — send `prompt` text to the AI via sendToAi (default)
   * - 'compact'    — run provider-specific /compact tool (no AI prompt sent)
   * - 'pruneTodo'  — move completed [x] tasks from TODO.md into TODO_ARCHIVE.md
   */
  type?: 'prompt' | 'compact' | 'pruneTodo';
  /** Prompt text sent to the agent (only used when type === 'prompt'). */
  prompt: string;
}

export const PERIODIC_ACTIONS: PeriodicActionDef[] = [
  // ─── Compact context ─────────────────────────────────────────────────────
  // Runs the provider's native /compact tool — no AI prompt sent.
  {
    id: 'compact',
    label: 'Auto compact',
    settingKey: 'compactEveryNTasks',
    icon: '🗜',
    type: 'compact',
    prompt: '', // unused — compact is a tool action, not an AI prompt
  },

  // ─── Skill files ──────────────────────────────────────────────────────────
  // Protocol ref: media/profile/04-skill-files.md
  {
    id: 'skill',
    label: 'Make skill',
    settingKey: 'skillEveryNTasks',
    icon: '📚',
    prompt: `Before continuing to the next task, update your skills based on recent learnings. 
    If you discovered a new best practice, anti-pattern, or gotcha worth formalizing into a skill, create or update a markdown file in .claude/skills/ named after the pattern (e.g. .claude/skills/error-handling.md). The file should contain a concise description of the pattern, when to apply it, and an example. If the pattern is a gotcha or anti-pattern, clearly explain the potential pitfall and how to avoid it. 
    Your skills are your personal best practices distilled from experience in this codebase — use them to level up your performance on future tasks. 
    Update AGENTS.md with a one-paragraph summary of the new skill and why it matters. Then continue — pick up any new tasks .

    `,

    },

  // ─── Memory / SUMMARY.md ──────────────────────────────────────────────────
  // Protocol ref: media/profile/01-learning.md
  {
    id: 'memory',
    label: 'Update memory',
    settingKey: 'memoryEveryNTasks',
    icon: '🧠',
    prompt: `Before continuing to the next task, update SUMMARY.md in the project root with any new architectural discoveries, naming conventions, gotchas, key files, decisions, or build/run changes from recent tasks. Keep entries concise — one clear bullet per fact. If SUMMARY.md does not exist, create it with these sections: Architecture, Naming Conventions, Key Files, Gotchas / Known Issues, Decisions, Build & Run, Dependencies, Credentials.

Also update LESSONS.md (or tasks/lessons.md if it already exists) if any corrections, preventable mistakes, or repeat failures occurred in recent tasks.

Do NOT store credentials in plaintext in SUMMARY.md — reference the Memory MCP key name only. Then continue — pick up any new tasks .`,
  },

  // ─── Full project summary ─────────────────────────────────────────────────
  // Protocol ref: media/profile/01-learning.md
  {
    id: 'summary',
    label: 'Write summary',
    settingKey: 'summaryEveryNTasks',
    icon: '📋',
    prompt: `Before continuing to the next task, write a comprehensive up-to-date project state summary to SUMMARY.md in the project root. Cover: current architecture overview, module map, naming conventions, key files (entry points, config, router, DB schema), exact build & run commands (dev and prod), known gotchas, recent decisions, and non-obvious dependencies. If the file already exists, update it — preserve all valid existing content and add new learnings. Keep every entry concise — one bullet per fact. Then continue — pick up any new tasks .`,
  },
  // ─── Prune TODO.md ──────────────────────────────────────────────────────
  // Moves completed [x] lines out of TODO.md into TODO_ARCHIVE.md.
  // No AI prompt — done entirely by the extension.
  {
    id: 'pruneTodo',
    label: 'Prune TODO',
    settingKey: 'pruneTodoEveryNTasks',
    icon: '🧹',
    type: 'pruneTodo',
    prompt: '', // unused — handled by the extension, not the AI
  },
  // ─── Journal auto-learn ──────────────────────────────────────────────────
  // Prompts the agent to review JOURNAL.md and distil patterns into LESSONS.md.
  {
    id: 'journalLearn',
    label: 'Auto-Learn (Journal Review)',
    settingKey: 'journalLearnEveryNTasks',
    icon: '🔬',
    type: 'prompt' as const,
    prompt: `You are performing an autonomous research journal review (inspired by the autoresearch loop). Follow these steps exactly:

1. Read JOURNAL.md in the project root. Find the most recent '## Auto-learn YYYY-MM-DD' heading. All entries after that heading (or all entries if none exists) are unreviewed.
2. For each unreviewed entry, tally:
   - Any hypothesis type that appears in 2+ 'discard' rows → recurring anti-pattern for this codebase.
   - Any approach that appears in 2+ 'keep' rows → best practice worth formalising.
   - Any 'keep' row with ΔC = '-' → simplification win worth highlighting.
   - Any row where the Outcome contradicted the Hypothesis → knowledge gap about how the codebase actually works.
3. Update LESSONS.md — add one entry per new pattern found. Format: 'YYYY-MM-DD — [Pattern Title]: [one sentence description and why it matters in this codebase]'. Do not duplicate existing entries.
4. If any pattern appears 3+ times and is actionable, check for a matching skill file in .claude/skills/. Create or update it.
5. Append to JOURNAL.md: a new '## Auto-learn YYYY-MM-DD' heading followed by a one-paragraph summary of what was reviewed and what was learned.
6. Commit: git add JOURNAL.md LESSONS.md && git commit -m 'chore: auto-learn journal review'
7. Continue immediately with the next task — do not wait or ask for confirmation.`,
  },];

// ---------------------------------------------------------------------------
// Per-action state tracked internally
// ---------------------------------------------------------------------------

interface ActionState {
  /** Tasks completed since this action was last triggered (or since loop start). */
  counter: number;
  /** Loop iteration number when this action was last triggered (0 = never). */
  lastTriggeredAt: number;
  /** Wall-clock ISO string when last triggered. */
  lastTriggeredTime: string | null;
}

// ---------------------------------------------------------------------------
// PeriodicActionManager
// ---------------------------------------------------------------------------

export class PeriodicActionManager {
  private readonly _state = new Map<string, ActionState>();

  private _ensureState(id: string): ActionState {
    if (!this._state.has(id)) {
      this._state.set(id, { counter: 0, lastTriggeredAt: 0, lastTriggeredTime: null });
    }
    return this._state.get(id)!;
  }

  /** Reset all counters (call at loop start). */
  reset(): void {
    this._state.clear();
  }

  /**
   * Reset all counters and persist the cleared state to .autodev/loop-state.json.
   * Call at loop start.
   */
  resetAndPersist(workspaceRoot?: string): void {
    this._state.clear();
    if (workspaceRoot) { this._persist(0, workspaceRoot); }
  }

  /**
   * Increment all action counters by 1.
   * @param iteration Current loop iteration number (used for debug state).
   * @param workspaceRoot If provided, persists loop-state.json to .autodev/.
   */
  increment(iteration: number, workspaceRoot?: string): void {
    for (const action of PERIODIC_ACTIONS) {
      const s = this._ensureState(action.id);
      s.counter++;
    }
    if (workspaceRoot) {
      this._persist(iteration, workspaceRoot);
    }
  }

  /** Returns the actions whose counter has reached or exceeded the configured interval. */
  getDue(settings: AutodevSettings): PeriodicActionDef[] {
    return PERIODIC_ACTIONS.filter(action => {
      const interval = (settings as unknown as Record<string, number>)[action.settingKey as string] ?? 0;
      if (interval <= 0) { return false; }
      return this._ensureState(action.id).counter >= interval;
    });
  }

  /**
   * Reset the counter for a specific action after it has been handled.
   * Records the iteration + timestamp it was triggered at.
   */
  markHandled(id: string, iteration: number, workspaceRoot?: string): void {
    const s = this._ensureState(id);
    s.counter = 0;
    s.lastTriggeredAt = iteration;
    s.lastTriggeredTime = new Date().toISOString();
    if (workspaceRoot) {
      this._persist(iteration, workspaceRoot);
    }
  }

  /** Returns the current counter value for an action (for debug / display). */
  getCount(id: string): number {
    return this._state.get(id)?.counter ?? 0;
  }

  /** Snapshot of all action states — used for debug persistence. */
  snapshot(): Record<string, ActionState> {
    const out: Record<string, ActionState> = {};
    for (const [id, s] of this._state) { out[id] = { ...s }; }
    return out;
  }

  /**
   * Write .autodev/loop-state.json with current iteration + per-action counters.
   * Safe — silently ignores write errors.
   */
  private _persist(iteration: number, workspaceRoot: string): void {
    try {
      const dir = path.join(workspaceRoot, '.autodev');
      if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
      const payload = {
        iteration,
        updatedAt: new Date().toISOString(),
        actions: this.snapshot(),
      };
      fs.writeFileSync(
        path.join(dir, 'loop-state.json'),
        JSON.stringify(payload, null, 2),
        'utf8',
      );
    } catch { /* non-fatal */ }
  }
}
