### 1.5 The Core Loop — Never Deviate

```
READ TODO.md            — collect ALL unfinished tasks as the current batch
                          (read each task with surrounding lines — descriptions may span multiple lines)
CLASSIFY each task      — code / qa / docs / chore (see §1.5)
  ↓
┌──────────────────────────────────────────────────────────────────┐
│  FOR EACH TASK in batch (top → bottom):                          │
│                                                                  │
│  STEP 1 ► MARK [~] in TODO.md   ← DO THIS FIRST, NO EXCEPTIONS  │
│    ↓                                                             │
│  STEP 1.5 ► THINK & PLAN        — §1.6 checklist (6 questions)  │
│             ↳ complex task?  → decompose into subtasks (§1.7)   │
│    ↓                                                             │
│  STEP 2 ► DISPATCH to subagent  — Code Agent | QA Agent | self  │
│    ↓                                                             │
│  STEP 3 ► RECEIVE result        — implementation / test output  │
│    ↓                                                             │
│  STEP 4 ► DISPATCH to Verifier Agent                            │
│    ↓                                                             │
│  ┌── PASS? ──────────────────────────────────────────────────┐  │
│  │  YES → MARK [x] YYYY-MM-DD → git commit                   │  │
│  │        → pick NEXT [ ] task → back to STEP 1              │  │
│  │  NO  → send failure report back to implementing agent     │  │
│  │        → fix → re-verify (max 3 rounds, then escalate)    │  │
│  └───────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
  ↓
ALL TASKS DONE               — batch complete
  ↓
RE-READ TODO.md              — confirm zero [ ] and [~] tasks remain
  ↓
IF any [ ] or [~] found      — loop back to top; do NOT stop
  ↓
ZERO remaining tasks         — session ends (only now)
```

### 1.5 Task Classification & Routing

Classify each task before dispatching. Use the task prefix and description as signals:

| Task type | Signals | Route to |
|---|---|---|
| **Implementation** | `feat:`, `fix:`, `refactor:`, `perf:`, `style:`, `chore:` | **Code Agent** |
| **Testing / QA** | `test:`, `qa:`, keywords "test", "spec", "coverage", "e2e" | **QA Agent** |
| **Documentation** | `docs:`, keywords "readme", "document", "comment" | **Code Agent** (docs are code) |
| **Verification** | any task after implementation | **Verifier Agent** (always) |
| **Ambiguous** | unclear prefix | Orchestrator decides; default to Code Agent |

One task may require **both** Code Agent and QA Agent in sequence — implement first, then test.
