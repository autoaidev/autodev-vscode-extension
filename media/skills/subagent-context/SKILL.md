---
name: subagent-context
description: >-
  Full protocol for subagent context management: the when-to-spawn decision tree,
  the CONTEXT.md template, the subagent briefing template, anti-patterns, and the
  context-handoff workflow. Load this whenever you're about to spawn a subagent for
  a complex/multi-step task, need to hand off a heavy context, or want the exact
  CONTEXT.md / brief format. The one-line rules live in profile §19; the full
  templates and decision tree live here.
---

# Subagent Context Management

## Critical Principle: You Own Context

**YOU (the Orchestrator) manage your own context.** Subagents are NOT for:
- Compacting your context (they compact theirs, not yours = infinite loop)
- Figuring out what to do next (you decide, then hand off)
- Running commands (tests, lints, builds)
- Reading files or parsing output

**Subagents ARE for:**
- Scoped implementation work with clean context
- Complex creative tasks that benefit from fresh context
- Parallel specialist work (Code, QA, Reviewer)

---

## When to Spawn a Subagent: Decision Tree

```
IS THE TASK...
  → A shell command that returns text?      → YOU RUN IT (no subagent)
  → Reading/parsing files or output?        → YOU DO IT (no subagent)
  → A judgment call or decision?            → YOU DECIDE (no subagent)
  → "Manage my context" / "compact"?        → YOU HANDLE (never subagent!)
  → Implementation (editing files)?         → Spawn Code Agent
  → Writing new test files?                 → Spawn QA Agent
  → Reviewing code/diff?                    → Spawn Reviewer Agent
  → Architectural design?                   → Spawn Architect Agent
  → Deep multi-step impl needing fresh ctx? → See "Context Handoff" below
  → else                                    → YOU DO IT DIRECTLY
```

---

## Context Handoff: When Your Context Is Unwieldy

### Signs You Need a Context Handoff
- You've been working on the same task for 20+ exchanges
- You're going in circles (repeating the same analysis)
- Your context is full of irrelevant exploration from earlier
- You need to implement a complex multi-file change
- You've made the key decisions and need clean context to execute

### Signs You DON'T Need a Context Handoff
- You just need to run a test (`npm test` → run it yourself)
- You need to decide what to do next (you decide, don't delegate)
- You want to "compact" your context (manage it yourself)
- The task is 1-3 simple file edits (do it yourself or use Code Agent)
- You haven't decided on the approach yet (decide first, then hand off)

### How to Do a Context Handoff
**BEFORE spawning:** (1) Update CONTEXT.md (template below) with goal, key decisions, files/modules, status, what remains. (2) Decide the EXACT next action — never hand off "figure out what to do". (3) Write a detailed brief (template below). (4) Spawn with a scoped task — "implement X using Y", not "do everything".
**AFTER it returns:** (1) Update CONTEXT.md with what was completed. (2) Verify the result yourself (run tests, check diffs). (3) Continue or mark `[x]`.

---

## CONTEXT.md Template

Create `CONTEXT.md` in the workspace root when starting complex multi-step tasks:

```markdown
# CONTEXT.md — Main Task Tracking
> Purpose: keep the main goal in view and prevent getting lost in deep subtasks.
> Update: after every major decision, subagent spawn, or context shift.

## Main Task
Goal: [one sentence]
Status: [Not Started / In Progress / Blocked / Completed]
TODO.md line: - [~] feat: ...

## Key Decisions Made
1. [when] Decision: [what] — Reasoning: [why] — Rejected: [alt + why]

## Architecture / Approach
[high-level approach]
Files/Modules: `src/...` — [role]
Patterns/Conventions: [e.g. JWT, existing error pattern in src/errors/]

## Progress Tracker
Completed: - [x] YYYY-MM-DD  ...
In Progress: - [~] ...
Remaining: - [ ] ...

## Subagent Spawns
Spawn N: [type] — [task] | when | brief-ref | result | verified ✅/pending

## Blockers / Issues
[when] Blocker: [desc] — Status: open/resolved — Resolution: ...

## Context Checkpoints
1. Can you state the main goal in one sentence?
2. Do you know the next concrete action?
3. Have you strayed into unrelated work?
4. Is there a clearer path than the current approach?

## Notes / Learnings
[discoveries, gotchas]
```

---

## Subagent Briefing Template

```markdown
# Subagent Brief: [Agent Type] — [Task Summary]

## MISSION (one sentence)
[exactly what this subagent must accomplish]

## CONTEXT
Only the RELEVANT context — not your entire history.
Main Task: [the overall goal]
Decisions Already Made: [key decisions]
Files/Modules Relevant to This Subtask: `path` — [why]

## WHAT TO IMPLEMENT
Goal: [specific]
Approach: [exact, no ambiguity — Step 1/2/3]
Files to Edit: 1. `file1.ts` — Add/Modify [what], Use pattern [ref]
Patterns to Follow: error handling / testing / imports
DO: follow existing style; JSDoc public fns; type-safe (no `any`); explicit errors
DON'T: change unrelated code; add libs without checking stack; skip edge cases; leave TODOs

## DONE CRITERIA
This subtask is complete when: [criterion 1..N]; all edits syntactically valid.

## AFTER YOU'RE DONE — return
1. Files changed (paths)  2. Summary (2-3 sentences)  3. Any issues/decisions
DO NOT: run tests / linters / verify the full feature / update TODO.md (orchestrator does these).
```

---

## Anti-Patterns: NEVER Do These

- ❌ **Spawn a subagent to compact context.** It starts EMPTY and compacts its own empty context, not yours → infinite loop. ✅ YOU decide what to keep → update CONTEXT.md → then spawn a scoped task.
- ❌ **Spawn a subagent to decide the next step.** YOU are the orchestrator; subagents execute scoped tasks. ✅ Re-read CONTEXT.md → decide → then spawn with a specific task.
- ❌ **Spawn a subagent to run tests.** Deterministic shell command → run it yourself, analyze output yourself, then spawn a Code Agent to fix.
- ❌ **Vague brief** ("implement the feature, figure out the approach"). The subagent lacks your context and re-explores everything. ✅ YOU decide the approach + files + pattern → then spawn with the detailed brief above.

---

## Workflow: Managing Context in Complex Tasks

1. **CREATE CONTEXT.md** — write the main goal, set up the Progress Tracker.
2. **RESEARCH & DECIDE** — read files, explore, make key decisions, update CONTEXT.md.
3. **BREAK DOWN** — write subtasks in TODO.md, update the Progress Tracker.
4. **FOR EACH SUBTASK:** (4a) Can I do this directly (1-3 edits)? → yes: do it. (4b) else write a detailed brief. (4c) spawn scoped. (4d) update CONTEXT.md. (4e) receive result. (4f) YOU verify (tests/lint/build). (4g) update the Progress Tracker.
5. **CHECKPOINT** — review CONTEXT.md: still on track? strayed? approach still valid?
6. **COMPLETE** — mark the main task `[x]`, archive CONTEXT.md → `DONE_CONTEXT_YYYY-MM-DD.md`, commit.

---

## Quick Reference: Subagent Dispatch Rules

| Task Type | Who Does It |
|---|---|
| Run tests / eslint / build | **YOU** — never a subagent for shell commands |
| Read/grep/parse files or output | **YOU** — use the tools directly |
| Decide what to do next / manage context | **YOU** — never delegate decisions or your own compaction |
| Edit 1-3 files (simple) | **YOU** — direct edits are faster |
| Edit 5+ files / multi-file refactor | **Code Agent** — detailed brief |
| Write new test files | **QA Agent** — spec + patterns |
| Review code/diff | **Reviewer Agent** — after changes complete |
| Architectural design | **Architect Agent** — requirements + constraints |
| Context handoff | **Code Agent** — when YOUR context is unwieldy + decisions made |

---

## Success Metrics
Right: subagents get detailed specific briefs; you update CONTEXT.md before/after spawns; you never spawn for commands/reads; you verify all subagent work yourself; you stay on the main goal; subagents work scoped with clean context; you decide, they execute.
Wrong: spawning to "compact my context" or "figure out what to do" or "run tests"; vague briefs; losing the main goal after deep subtasks; forgetting CONTEXT.md; repeating research you already did.

## Integration with the Core Loop
Integrates with **autodev-core-loop**: before/at THINK&PLAN, create+update CONTEXT.md and make decisions; at DISPATCH, use the briefing template for complex tasks; after RECEIVE, update CONTEXT.md; at VERIFY, check the main goal is still on track; after re-reading TODO.md, review CONTEXT.md before the next task. **Never let subagent management override the core loop — the loop is primary.**
