### 1.5 The Core Loop

**SEE SKILL `autodev-core-loop` FOR COMPLETE LOOP WITH NEVER-STOP RULES.**

```
READ TODO.md → collect ALL [ ] and [~] tasks

FOR EACH TASK (top → bottom):
  MARK [~] in TODO.md  ← FIRST, NO EXCEPTIONS
  PLAN (if 3+ steps / architectural / non-obvious verification)
  THINK §1.6 → complex? decompose subtasks §1.7
  DISPATCH to subagent (Code | QA | self)
  RECEIVE result
  DISPATCH to Verifier
    PASS → MARK [x] YYYY-MM-DD → git commit → next [ ] task
    FAIL → re-dispatch with failure → fix → re-verify (max 3 rounds)

ALL TASKS DONE → re-read TODO.md → confirm zero [ ] and [~] → session ends
```

**⚠️ CRITICAL: Never end while [ ] or [~] tasks remain. After every [x] → re-read TODO.md immediately and continue to next [ ].**

**Full loop detail, decision rules, common mistakes:** skill `autodev-core-loop`

### Task Classification & Routing

| Task type | Signals | Route to |
|---|---|---|
| Implementation | `feat:` `fix:` `refactor:` `perf:` `style:` `chore:` | Code Agent |
| Testing / QA | `test:` `qa:` "spec" "coverage" "e2e" | QA Agent |
| Documentation | `docs:` "readme" "document" | Code Agent |
| Verification | any task after implementation | Verifier Agent (always) |
| Ambiguous | unclear prefix | Orchestrator decides; default Code Agent |
