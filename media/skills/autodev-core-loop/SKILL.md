---
name: autodev-core-loop
description: >-
  The non-negotiable autonomous batch execution loop. Use this skill at every
  session start, after every completed task, and whenever you feel uncertain
  about what to do next. This skill reinforces: NEVER STOP while tasks remain,
  mark [~] FIRST before any action, re-read TODO.md after every [x], and never
  ask questions - always decide and act. This is your primary operating loop.
---

# SKILL: AutoDev Core Loop — Never Stop Until Clear

**When to use:** Session start · After every `[x]` · Whenever uncertain about next step · When feeling like stopping

---

## ⚠️ CRITICAL: Never-Stop Rule

```
IF TODO.md contains ANY [ ] or [~] tasks:
  → YOU CANNOT END THE SESSION
  → YOU CANNOT STOP
  → YOU CANNOT PAUSE
  → YOU CANNOT ASK QUESTIONS
  
ONLY when TODO.md has ZERO [ ] and ZERO [~]:
  → Session may end
```

**After marking a task `[x]`:** DO NOT stop. DO NOT re-classify. DO NOT restart the loop. **Immediately execute Step 8 below** (re-read TODO.md and continue).

---

## The Execution Loop (exact sequence)

```
┌─────────────────────────────────────────────────────────────────────┐
│ SESSION START                                                        │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│ STEP 1: READ TODO.md                                                │
│ - Collect ALL [ ] tasks (pending)                                   │
│ - Collect ALL [~] tasks (in progress)                               │
│ - If BOTH are empty → session ends. Otherwise → continue to Step 2  │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│ STEP 2: PICK THE FIRST [ ] TASK (top to bottom)                     │
│ - Read the task line                                                │
│ - Read 3 lines above and 3 lines below for context                  │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│ STEP 3: MARK [~] IN TODO.md ← DO THIS FIRST, NO EXCEPTIONS         │
│ - Change `- [ ]` to `- [~]` for this task                           │
│ - Write TODO.md                                                      │
│ - Wait 1 second                                                      │
│ - Re-read TODO.md to confirm the [~] is present                     │
│ - ONLY AFTER THIS → proceed to Step 4                               │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│ STEP 4: THINK & PLAN (if task is non-trivial)                       │
│ - Answer the 6 questions (§1.6): Scope, Impact, Patterns, Risks,    │
│   Approach, Done criteria                                            │
│ - If 3+ steps / architectural / non-obvious verification:           │
│   write concrete plan in TODO.md as subtasks under the [~] parent   │
│ - For full checklist detail: see skill `thinking-checklist`         │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│ STEP 5: DISPATCH TO SUBAGENT                                        │
│ - Classify: feat/fix/refactor/test/docs/chore                       │
│ - Route: Code Agent | QA Agent | self                               │
│ - Provide full context from Step 4                                  │
│ - For dispatch rules: see skill `agent-routing`                     │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│ STEP 6: RECEIVE RESULT                                              │
│ - Subagent returns: files changed, change summary, verification cmd │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│ STEP 7: VERIFY                                                       │
│ - Run verification workflow (§4): tests + lint + build + browser    │
│ - If PASS → go to Step 7a                                           │
│ - If FAIL → go to Step 7b                                           │
│ - For full verification detail: see skill `verification-workflow`   │
└─────────────────────────────────────────────────────────────────────┘
         │
    ┌────┴────┐
    │         │
   PASS      FAIL
    │         │
    ▼         ▼
┌─────────┐ ┌──────────────────────────────────────────────────────┐
│ STEP 7a │ │ STEP 7b: FIX & RE-VERIFY                             │
│ MARK [x]│ │ - Send failure report back to implementing subagent  │
│         │ │ - Fix the issue                                       │
│         │ │ - Re-run Step 7 (max 3 rounds)                       │
│         │ │ - If 3 failures: escalate to Orchestrator, fix, retry│
└─────────┘ └──────────────────────────────────────────────────────┘
    │                       │
    │         ┌─────────────┘
    │         │
    ▼         ▼
┌─────────────────────────────────────────────────────────────────────┐
│ STEP 7a: MARK [x] YYYY-MM-DD IN TODO.md                             │
│ - Change `- [~]` to `- [x] 2026-05-25  ` (two spaces after date)   │
│ - Task text IDENTICAL to original                                   │
│ - Write TODO.md                                                      │
│ - Wait 1 second                                                      │
│ - Re-read TODO.md to confirm [x] is present                         │
│ - For exact format: see skill `todo-format`                         │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│ STEP 7c: GIT COMMIT                                                  │
│ - Conventional commit message: `feat:` / `fix:` / `refactor:` etc.  │
│ - One logical change per commit                                     │
│ - For commit rules: see skill `git-conventions`                     │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│ STEP 8: RE-READ TODO.md ← MANDATORY AFTER EVERY [x]                 │
│ - Read TODO.md fresh from disk                                      │
│ - Count [ ] tasks                                                    │
│ - Count [~] tasks                                                    │
│ - IF ([ ] count + [~] count) > 0:                                   │
│     → GO DIRECTLY TO STEP 2 (pick next task)                        │
│     → DO NOT STOP                                                    │
│     → DO NOT RE-CLASSIFY                                             │
│     → DO NOT RE-ORIENT                                               │
│     → DO NOT ASK QUESTIONS                                           │
│ - IF both counts are 0:                                             │
│     → Session ends (only now)                                        │
└─────────────────────────────────────────────────────────────────────┘
         │
         │ (if tasks remain)
         │
         └──────────── LOOP BACK TO STEP 2 ────────────────────┐
                                                                │
         ┌──────────────────────────────────────────────────────┘
         │
         ▼
    [Continue with next task...]
```

---

## Common Mistakes & Corrections

| ❌ WRONG | ✅ CORRECT |
|---|---|
| Stopping after one task to "check in" | Continue to next [ ] immediately after [x] |
| Asking "Should I continue?" | Re-read TODO.md; if tasks remain, continue |
| Re-classifying tasks after every [x] | Classification done once at session start |
| Forgetting to mark [~] before starting | FIRST action is always mark [~] |
| Marking [x] before Verifier passes | [x] only after PASS verdict |
| Ending session with [~] tasks present | NEVER end with [~] — finish or revert |
| Writing `- [X]` (uppercase) | Always lowercase: `- [x]` |
| One space after date in [x] line | Two spaces: `- [x] 2026-05-25  task` |

---

## Decision Rules (Never Ask, Always Decide)

When you encounter:

| Situation | Action |
|---|---|
| **Ambiguous task wording** | Pick the simplest valid interpretation and execute it. State assumption in commit message. |
| **Missing context** | Read relevant files to fill in gaps. Do not ask unless files don't exist. |
| **Multiple valid approaches** | Pick the simplest one (least code, least abstraction). Document why. |
| **Unclear priority** | Work top-to-bottom in TODO.md. Top = highest priority. |
| **Bug with no repro steps** | Read recent changes, check logs, form hypothesis, test it. |
| **Test failure** | Debug → fix → re-verify. Do not skip. |
| **Uncertain about "done"** | Check done criteria from Step 4. If criteria met → done. |
| **Feeling stuck** | Re-read the task + 3 lines above/below. Read relevant code. Form hypothesis. Try it. |

**NEVER stop to ask "What should I do?" → Re-read TODO.md and execute Step 2.**

---

## Autonomy Checklist (use before every session)

Before starting any session, confirm:

- [ ] I will NOT ask permission or wait for confirmation
- [ ] I will mark [~] FIRST before any other action on each task
- [ ] I will re-read TODO.md after every [x] to check for remaining tasks
- [ ] I will NOT end the session while [ ] or [~] tasks remain
- [ ] I will decide on ambiguities and state assumptions explicitly
- [ ] I will verify every task (tests + lint + build + browser if UI)
- [ ] I will commit only after Verifier passes
- [ ] I will use skills for detailed protocols (reference by name)

---

## Quick Reference

| Action | When | Skill for details |
|---|---|---|
| Mark task [~] | FIRST action on every task | `todo-format` |
| Think & plan | Before dispatching (if non-trivial) | `thinking-checklist` |
| Dispatch subagent | After marking [~] and planning | `agent-routing` |
| Run verification | After receiving implementation | `verification-workflow` |
| Mark task [x] | After Verifier PASS only | `todo-format` |
| Git commit | After marking [x] | `git-conventions` |
| Re-read TODO.md | After every [x], before stopping | — (this skill) |
| Check if done | After re-reading TODO.md | If zero [ ] and [~] → done |

---

## Integration with Other Skills

This core loop is the "control flow" — other skills provide the "implementation details":

- **Thinking & planning:** Use skill `thinking-checklist` for Step 4
- **Verification:** Use skill `verification-workflow` for Step 7
- **TODO format:** Use skill `todo-format` for Steps 3, 7a, 8
- **Git commits:** Use skill `git-conventions` for Step 7c
- **Agent routing:** Use skill `agent-routing` for Step 5
- **Issue tracking:** Use skill `issue-tracking-reference` when task references ISSUE-NNN
- **Living docs:** Update PROJECT.md, TROUBLESHOOTING.md, CHANGELOG.md per skill `living-docs-reference`

**Keep this skill (autodev-core-loop) as your primary reference for "what to do next."**

---

## Emergency Recovery

If you ever feel lost or uncertain:

1. **Read this skill from the top.**
2. **Execute Step 1** (re-read TODO.md).
3. **If tasks remain:** execute Step 2 (pick first [ ]).
4. **If no tasks remain:** session ends.

**Do not overcomplicate. Follow the loop. Use skills for details.**

