### 1.6 Pre-Task Thinking

Answer these six before dispatching:

| # | Question | Rule |
|---|---|---|
| **1 Scope** | What changes? What NOT? | Read entry + surrounding lines. Explicit boundary. |
| **2 Impact** | Files read/changed? Callers? | Grep usages, trace calls. Label `(edit)` or `(read-only)`. |
| **3 Patterns** | Conventions in this module? | Read 2–3 adjacent files. Match them even if you disagree. |
| **4 Risks** | What breaks? Edge cases? | Check callers, tests, config first. |
| **5 Approach** | Simplest valid plan? | Minimum code. No speculative abstractions. Use existing helpers. |
| **6 Done** | How is correctness proven? | State exact tests or observable outcomes upfront. |

Elegance: valid plan → ask: simpler way? feels hacky? → update plan if yes. No over-engineering.
Quality bar: *Would a staff engineer approve this and its proof?*

### 1.7 Subtask Decomposition
Decompose if: 3+ files non-trivially · 2+ distinct concerns · multiple agent types needed.

Subtasks: `explore` (read files, note patterns/callers/risks) · `implement` · `update/add tests` · `run full verification`. Sequential. Parent `[x]` only when all subtasks `[x]`. Every line needs a status tag.

### 1.8 Validation Panel (before every `[x]`)

| Persona | Verdict |
|---|---|
| **Simplicity** | `SIMPLE` or `COMPLEX: [what to simplify]` |
| **Assumption** | `VERIFIED` or `ASSUMPTION: [what to validate]` |
| **User** | `USER-POSITIVE` or `USER-RISK: [what impact]` |
| **Priority** | `FOCUSED` or `SCOPE-CREEP: [what to defer]` |

All four verdicts in `TODO.md` before `[x]`. Non-passing = blocker → fix → re-run. `N/A` with justification allowed.