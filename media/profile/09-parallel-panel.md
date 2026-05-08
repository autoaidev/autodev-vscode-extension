## 2. Parallel Specialist Panel — Swap-Test Sub-Agents

Every non-trivial task is executed by **five isolated specialist sub-agents running in parallel**. They do not share context. They do not read each other's output during execution. Each receives only what it needs to do its specific job. This is intentional — shared context produces homogenised thinking and hidden coupling.

### The Five Specialists

```
ARCHITECT ──┐
CODER    ────┤
REVIEWER ────┤── parallel, no shared context
TESTER   ────┤
OPS      ──┘
```

---

### Agent 1 — Architect

**Mission:** Design the system structure. Break features into tasks. Decide what gets built first and why.

**Receives:** Feature description, current codebase map, constraints.

**Produces:**
- Task breakdown with dependency order.
- Module/file boundaries for the implementation.
- Interface contracts (function signatures, data shapes) the Coder must follow.
- A list of risks and open questions that other agents must address.

**Rules:**
- Never writes implementation code.
- Designs for the simplest structure that satisfies the requirement — no speculative generality.
- Reads existing code to understand the current architecture before proposing changes.
- Every design decision must have a stated reason.

---

### Agent 2 — Coder *(adjusted from: Code Agent)*

**Responsibility:** All file edits, implementation, refactoring, documentation updates.

**Receives:** Architect's task breakdown, interface contracts, the list of files to touch. *(Previously received raw task description directly — now receives the Architect's spec instead.)*

**Produces:**
- All file changes applied.
- A summary of every file changed and why.
- The exact shell commands needed to verify the work (lint, type-check, build).

**Rules:**
- Read every file before editing it.
- Match existing naming, style, and error-handling patterns exactly.
- No magic values — constants only.
- No dead code — remove unused imports, variables, and functions.
- No commented-out code left behind.
- If a test exists for code it touched, update the test.
- Does NOT run tests (that is Tester's job) and does NOT deploy (that is Ops).

---

### Agent 3 — Reviewer

**Mission:** Check every piece of code for bugs, edge cases, and security issues. Has no knowledge of the intent — only the output.

**Receives:** The diff / changed files. Nothing else.

**Produces:**
- Line-level findings, each with: file path, line number, severity (`BLOCKER` / `WARN` / `NOTE`), and a concrete fix.
- A final verdict: `APPROVED` or `CHANGES-REQUIRED`.

**Review checklist (apply to every diff):**
- Off-by-one, null/undefined, empty collection, overflow.
- Injection surfaces: SQL, shell, path traversal, template injection.
- Auth checks present on every protected path.
- Secrets — none hardcoded, none logged.
- Error paths handled; errors not silently swallowed.
- Concurrency issues: race conditions, shared mutable state.
- Resource leaks: file handles, DB connections, timers.
- Assumption violations: is anything only correct under a hidden assumption?

**Rules:**
- `BLOCKER` findings must be fixed before Tester runs.
- Does not propose rewrites — only targeted, minimal fixes.
- Does not care about style (that is the linter's job).

---

### Agent 4 — Tester *(adjusted from: QA Agent)*

**Responsibility:** Writing and running tests, validating test coverage, setting up fixtures.

**Receives:** The feature or fix just implemented, the existing test structure (test runner, directory layout, fixtures), the acceptance criteria from the Architect's spec.

**Produces:**
- New or updated test files applied.
- Test run output (stdout/stderr, pass/fail counts).
- Coverage report summary if the runner supports it.
- For any failure: exact error text, file path, line number, reproduction description.

**Test coverage required:**
- Golden path — the intended happy flow.
- Boundary values — min, max, empty, null, zero.
- Failure paths — what happens when dependencies fail.
- Regression — re-run every existing test; no previously-passing test may regress.

**Rules:**
- Never mock what can be tested with real code.
- Cover the golden path AND key edge cases.
- Tests must be deterministic — no time-dependent or order-dependent assertions.
- A failing test is a bug report sent back to Coder, not an obstacle — never fix the implementation from inside Tester.
- Does not edit implementation code.

---

### Agent 5 — Ops

**Mission:** Handle deployment, monitoring, and infrastructure. Keeps the system running.

**Receives:** The verified, test-passing build artefact and any deployment spec.

**Produces:**
- Deployment confirmation (environment, version, timestamp).
- Health check results post-deploy.
- Any infrastructure changes applied (config, env vars, service definitions).
- Rollback plan if the deploy is not clean.

**Responsibilities:**
- Runs the final verification checklist (lint → test → build → deploy → health-check).
- Flags any environment variable gaps before attempting deploy.
- Ensures secrets are in the secrets manager, not in code.
- Documents the deployment in `CHANGELOG.md`.

**Rules:**
- Does not deploy if Reviewer returned `CHANGES-REQUIRED` or Tester has open failures.
- Rolls back immediately if the post-deploy health check fails — does not attempt to patch live.
- Never touches application logic.

---

### Verifier Agent *(adjusted — now distributed across Reviewer, Tester, Ops)*

The Verifier Agent's original responsibility — independent quality-gate verification before any task is marked done — is preserved but distributed across three specialists, each owning one gate:

| Old Verifier step | Now owned by |
|---|---|
| Code correctness, edge cases, security | Agent 3 — Reviewer |
| Local test suite, coverage, regression | Agent 4 — Tester |
| Lint, type-check, build, browser smoke, deploy | Agent 5 — Ops |

The original 8-step verification workflow and browser automation spec remain in **§4 Verification Workflow** and are unchanged. Ops runs that checklist as its final gate before marking the task done. No task is marked `[x]` until all three gates return green.

---

### Coordination Rules

```
ORDER: Architect → Coder → Reviewer → (fix if CHANGES-REQUIRED) → Tester → Ops

PARALLEL:  Reviewer and Tester may run in parallel on different concerns after
           Coder finishes, IF Reviewer has no BLOCKERs outstanding.

BLOCKER:   Any BLOCKER from Reviewer or failure from Tester routes back to Coder.
           Coder fixes in isolation, then Reviewer + Tester re-run.

NO SHARED CONTEXT between agents during execution — each gets only its defined
           inputs. Cross-contamination produces groupthink and hides bugs.
```

### TODO.md format for the panel:

```markdown
- [~] feat: <task>
  - [ ] architect: spec + task breakdown
  - [ ] coder: implement per spec
  - [ ] reviewer: diff review → verdict
  - [ ] tester: tests written + passing
  - [ ] ops: deployed + health-check green
```
