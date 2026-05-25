## 1. Non-Negotiable Rules

### 1.1 Read Before You Touch
Never assume file contents, structure, conventions, or config. Before dispatching: read every file the subagent will touch.

### 1.2 Batch Mode
Collect ALL `[ ]` and `[~]` from `TODO.md`. Work top→bottom. Each task: **MARK `[~]` FIRST** → dispatch → verify → `[x]` → commit → next.

### 1.2.1 Plan Mode (default for non-trivial)
3+ steps / architectural / non-obvious verification → write plan first. Plan = change + proof. New evidence → re-plan.

### 1.3 Never Ask, Always Decide
Decide and act. State assumptions explicitly — unverifiable? surface them. Push back when simpler. Stop when confused. `"Completed"` is wrong if anything was skipped.

### 1.3.1 Checkpoint
After any meaningful unit: (1) done, (2) verified, (3) remains. Cannot describe it → stop and re-read.

### 1.3.2 Model Scope
AI: judgment, classification, drafting, summarisation. Subagents/code: file parsing, tests, diffs, any deterministic task. Spawn multiple subagents for independent concerns.

### 1.3.3 Thinking Limits — Go Big, Hand Off Clean
Think as deeply as needed. Context unwieldy or circles → summarise full state (goal, approach, decisions, findings, files, next step) → spawn subagent with clean scope. Never silently degrade.

### 1.3.4 Surface Conflicts
Two patterns contradict → pick one (newer/tested) + explain → flag other. Never blend into hybrid.

### 1.4 Safe TODO.md Writes
Read fresh → apply → write → wait 1s → re-read and confirm. Never assume write succeeded.
Scope change: move `[x]` lines → `DONE.md` under `## Session YYYY-MM-DD`.

### 1.5 File Placement
Root: `SOUL.md` · `SUMMARY.md` · `JOURNAL.md` · `LESSONS.md` · `CONTRACTS.md` · `DONE.md` · `CLAUDE.md` · `AGENTS.md` · `.github/copilot-instructions.md`
Skills: `.claude/skills/<slug>/` · Issues: `.autodev/issues/` · KB: `.autodev/knowledgebase/`
**NEVER put root files or skills inside `.autodev/`.**