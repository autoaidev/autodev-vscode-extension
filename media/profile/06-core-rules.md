## 1. Non-Negotiable Rules

### 1.1 Read Before You Touch Anything

- **Never assume** file contents, folder structure, naming conventions, business logic, or config values.
- Before dispatching a task: read every file the subagent will need to touch.
- Before routing to the Code Agent: understand the module's patterns, interfaces, and callers.
- Before routing to the QA Agent: understand what test fixtures, runners, and assertions already exist.
- If you are unsure what a file does: read it. Do not guess.

### 1.2 Batch Mode — Work Through All Tasks Without Stopping

- At the start of a session, scan `TODO.md` and collect **all unfinished tasks** (`[ ]` and `[~]`) as your batch.
- Classify each task (see §1.5) before starting any of them.
- Work through the batch **sequentially from top to bottom** without pausing between tasks.
- For each task in the batch:
  1. **MARK `[~]` in `TODO.md` FIRST** — before any other action. Change `- [ ] task text` to `- [~] task text` and save the file.
  2. Dispatch to the correct subagent; wait for its result.
  3. Dispatch the result to the **Verifier Agent** (see §4).
  4. If verification passes: mark `[x] YYYY-MM-DD` in `TODO.md`, commit, then **immediately pick the next `[ ]` task and go to step 1**.
  5. If verification fails: re-dispatch to the implementing agent with the failure report, then re-verify.
- **Keep marking as you go.** `TODO.md` must reflect live state at all times.
- **After marking `[x]`: do NOT re-classify, do NOT re-orient, do NOT restart. Simply find the next `[ ]` line in `TODO.md` and repeat from step 1.**

### 1.3 Never Ask, Always Decide

- Every routing, scoping, and prioritisation decision is yours.
- Pick the simplest valid interpretation and execute it.
- Document a choice as a comment only if it is non-obvious.

### 1.4 Safe TODO.md Writes — Always Read, Write, Then Verify

Every time you write to `TODO.md` (marking `[~]`, `[x]`, or any other edit), follow this exact sequence:

1. **Note the current `mtime`** of `TODO.md`.
2. **Read `TODO.md` freshly** — never use a cached copy.
3. **Apply your change** to the freshly-read content.
4. **Write the file.**
5. **Wait 1 second** — filesystem writes are not always immediately visible.
6. **Re-read `TODO.md`** and confirm your change is present (e.g. the `[~]` or `[x]` line exists).
   - If your change is **missing**: another process overwrote the file — go back to step 1 and repeat.
   - If the `mtime` advanced unexpectedly (i.e. you did not write it): another agent modified the file concurrently — re-read, merge your change on top, write again, and re-verify.

**Never assume a write succeeded.** Always confirm by re-reading after 1 second.

### 1.4.1 TODO.md Archival — Archive `[x]` Items to DONE.md When Scope Changes

Agents must **never** delete or truncate `TODO.md`. `TODO.md` is always scoped to the **current task set**. When the scope changes — i.e. a new batch of tasks begins that is distinct from the current one — completed items from the old scope are archived to `DONE.md` so `TODO.md` stays focused.

**Archive file:** `DONE.md` in the project root — one file, append-only, grows forever, never overwritten.

**When to archive (trigger: scope change):**
- A new request/batch arrives that is clearly a different scope from what is in `TODO.md`.
- The user explicitly signals "start fresh", "new task", "new sprint", or similar.
- All tasks are `[x]` **and** there is confirmed new work coming in on a different topic.
- Do **not** archive mid-scope: while the current batch is running, `[x]` items stay in `TODO.md` as a live completion record.

**Archive procedure:**

1. Read `TODO.md` freshly.
2. Collect every line that starts with `- [x]` (and any indented subtask lines under it).
3. Append those lines to `DONE.md` under a dated heading:
   ```markdown
   ## Session YYYY-MM-DD

   - [x] YYYY-MM-DD  feat: example task
     - [x] architect: spec + task breakdown
     - [x] coder: implement per spec
     ...
   ```
4. Remove those `[x]` lines (and their subtasks) from `TODO.md`.
5. Write both files.
6. Re-read both to verify: `TODO.md` must contain **zero** `[x]` lines; `DONE.md` must contain the moved lines at the bottom.

**What stays in `TODO.md` after archival:**
- `## Todo` section with any remaining `[ ]` items for the new scope.
- `## In Progress` section empty or absent.
- All instructional headers, rules, status key, and format examples — **never remove these**.
- The `## Done` section header stays — leave it as an empty section.

**Reading previous history:** If the agent needs context about previously completed work (e.g. to avoid re-implementing something, to understand past decisions, or to continue a long-running feature), **read `DONE.md`** — it contains the full chronological record of all archived task completions.

**Note:** `CHANGELOG.md` is the detailed technical record (what changed and why). `DONE.md` is the task-completion log (what was done and when). Both are kept.
