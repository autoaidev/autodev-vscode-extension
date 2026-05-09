## 8. TODO.md Format

`TODO.md` is the single source of truth for task state. Keep it accurate at all times.

```markdown
## Todo

- [ ] feat: add pagination to the list endpoint
- [ ] fix: handle timeout errors from the upstream API
- [ ] [task-2026-04-23-a3f9k2] feat: support task-id prefixes in incoming tasks
- [ ] test: add unit tests for the auth middleware
- [ ] docs: document all environment variables

## In Progress

- [~] refactor: extract shared validation into a utility module
- [~] [task-2026-04-23-b19e7a] chore: align attachment folders with task id

## Done

- [x] 2026-02-28  chore: initialize project scaffold
- [x] 2026-04-23  [task-2026-04-23-c8d1f4] feat: accept optional task-id in TODO lines
- [x] 2026-02-27  feat: implement user registration endpoint
- [x] 2026-02-26  fix: normalize email before uniqueness check
```

Status rules:
- `[ ]` = not started
- `[~]` = in progress — mark this **as soon as you begin** the task; move to `[x]` the moment verification passes
- `[x]` = done — include the completion date
- Optional task id prefix is supported and should be preserved when present: `[task-YYYY-MM-DD-xxxxxx]`
- Never delete done items mid-session. At **end-of-session**, archive all `[x]` items to `DONE.md` per §1.4.1 — then remove them from `TODO.md`. The `## Done` section header stays.
- **Progressive marking is required:** `TODO.md` must reflect actual state at all times. An observer reading it mid-batch should see exactly which tasks are done, which is active, and which are queued.
- Update `TODO.md` in two steps per task: `[ ]` → `[~]` when dispatching, `[~]` → `[x] YYYY-MM-DD` when Verifier passes.
- For any non-trivial task, add a **checkable plan/subtask list** immediately under the parent item after marking it `[~]`.
- The plan must include a final **verification/review** subtask. Implementation is never the last unchecked step.
- If the plan becomes stale because new evidence appears, rewrite the checklist before continuing instead of blindly following it.

---

## ⚠️ CRITICAL — Marking Tasks Done in TODO.md

**This is the most important step. Never skip it. Never forget it.**

After the Verifier returns `VERDICT: PASS` for a task, immediately update `TODO.md`:

1. Find the task line — it will look like `- [~] your task text` or `- [~] [task-YYYY-MM-DD-xxxxxx] your task text`
2. Replace it **exactly** with one of:
  - `- [x] YYYY-MM-DD  your task text`
  - `- [x] YYYY-MM-DD  [task-YYYY-MM-DD-xxxxxx] your task text`
   - Use today's ISO date (e.g. `2026-04-18`)
   - Two spaces between the date and the task text
  - If an id prefix exists, keep it unchanged
  - The task text must be **identical** to the original

**Mandatory exact format:**
```
- [x] 2026-04-18  feat: add pagination to the list endpoint
- [x] 2026-04-18  [task-2026-04-18-a3f9k2] feat: add pagination to the list endpoint
```

**Common mistakes to avoid:**
- ❌ `- [x] task text` — missing date
- ❌ `- [x] 2026-04-18 task text` — only one space after the date (need two)
- ❌ `- [X] 2026-04-18  task text` — uppercase X
- ❌ Marking done before Verifier has passed
- ❌ Editing the wrong line or leaving the `[~]` marker in place

**Do this BEFORE committing, BEFORE stopping, BEFORE anything else.**
