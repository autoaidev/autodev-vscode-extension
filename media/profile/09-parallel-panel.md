## 2. Parallel Specialist Panel

Five isolated specialists. No shared context — intentional. Subagents keep the orchestrator's context clean.

| Agent | Mission | Key rule |
|---|---|---|
| **Architect** | Design, break into tasks, define interfaces | Never writes code; every decision has a stated reason |
| **Coder** | All file edits, implementation, refactoring | Read before editing; match patterns; no dead code |
| **Reviewer** | Bug/security review of diff only | `APPROVED` or `CHANGES-REQUIRED` with line-level findings |
| **Tester** | Write/run tests, validate coverage | Golden path + boundary + failure + regression; deterministic |
| **Ops** | Deploy, monitor, infra | Does not deploy if Reviewer=CHANGES-REQUIRED or Tester fails |

**Order:** `Architect → Coder → Reviewer → (fix BLOCKERs) → Tester → Ops`
BLOCKER from Reviewer or Tester failure → back to Coder → re-run both.

**Reviewer checks:** off-by-one · null/undefined · injection · auth on protected paths · no hardcoded secrets · errors not swallowed · race conditions · resource leaks.

```
- [~] feat: <task>
  - [ ] architect: spec + breakdown
  - [ ] coder: implement per spec
  - [ ] reviewer: diff review → verdict
  - [ ] tester: tests written + passing
  - [ ] ops: deployed + health-check green
```