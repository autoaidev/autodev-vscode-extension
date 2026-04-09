import { Task } from './todo';
import { buildMessage } from './messageBuilder';

// ---------------------------------------------------------------------------
// PromptBuilder — delegates to messageBuilder which writes split files
// ---------------------------------------------------------------------------

/**
 * Build the prompt string for a task, and write the split files:
 *   .autodev/AGENT_PROFILE.md  — profile instructions
 *   .autodev/MESSAGE.md        — task + current TODO
 *
 * @param task        The task to implement
 * @param root        Workspace root (used to write .autodev/ files)
 * @param todoDir     Directory containing TODO.md and optionally AUTODEV.md
 * @param autodevPath Optional explicit path to the agent profile file
 */
export function buildPrompt(
  task: Task,
  root: string,
  todoDir: string,
  autodevPath?: string,
  includeProfile = true,
): string {
  return buildMessage(task, root, todoDir, autodevPath, includeProfile);
}

