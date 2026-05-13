## 0.6 Research Journal Protocol — JOURNAL.md

**`JOURNAL.md` is your autonomous research log.** Every significant decision, experiment, or implementation approach gets one row. Over time it becomes a dataset of what works in this codebase — and the auto-learn periodic action reads it and distils the patterns into `LESSONS.md` and skill files.

Inspired by Karpathy's [autoresearch](https://github.com/karpathy/autoresearch): agents loop forever, try hypotheses, keep improvements, discard failures, and never stop.

---

### The Research Loop — How to Work

Every non-trivial task follows this loop, mirroring autoresearch's experiment cycle:

```
LOOP FOR EVERY TASK:
  1. HYPOTHESIS   — Before touching code, write a one-line hypothesis in JOURNAL.md.
                    What do you expect this change to do?
  2. IMPLEMENT    — Make the change. One idea at a time. Small diffs, reviewable commits.
  3. VERIFY       — Run tests, linter, build. Measure the outcome.
  4. LOG          — Add the result row to JOURNAL.md (see format below).
  5. KEEP/DISCARD — Did it work? Keep (commit + mark [x]). Didn't work? Revert + log "discard".
  6. REPEAT       — Pick the next task. Never stop. Never ask the human to confirm.
```

**Simplicity criterion** (directly from autoresearch): when two approaches achieve equal results, the simpler one wins. A refactor that adds complexity for zero improvement is a `discard`. Removing code and getting the same or better result is a `keep` — that is a win.

---

### JOURNAL.md Format

One row per experiment. Create the file with this header if it does not exist:

```markdown
# JOURNAL.md — Agent Research & Decision Log

Each row records one hypothesis and its outcome.
Status: `keep` | `discard` | `partial` | `pending`
Complexity delta: `+` more complex | `-` simpler | `=` neutral

| # | Date | Task | Hypothesis | Approach | Outcome | Status | ΔC | Notes |
|---|---|---|---|---|---|---|---|---|
```

**Column definitions:**

| Column | What to write |
|---|---|
| `#` | Sequential entry number (1, 2, 3 …) |
| `Date` | ISO date `YYYY-MM-DD` |
| `Task` | Short task label or TODO.md task ID |
| `Hypothesis` | One sentence: "I expect this to …" |
| `Approach` | What you actually did (file + method, no more than ~10 words) |
| `Outcome` | What happened — test result, error, measured improvement |
| `Status` | `keep` / `discard` / `partial` / `pending` |
| `ΔC` | Complexity delta: `+` / `-` / `=` |
| `Notes` | Optional: why you kept or discarded, follow-up ideas |

**Example rows:**

```
| 1  | 2026-05-13 | Fix login timeout  | Increasing token TTL to 30min will fix user complaints | Changed JWT_EXPIRY env var in auth.ts | All auth tests pass, no new failures | keep    | = | Consider making TTL configurable |
| 2  | 2026-05-13 | Reduce bundle size | Removing lodash in favour of native ES2022 will cut 40KB | Replaced 3 lodash calls in utils.ts | Bundle -38KB, all tests pass         | keep    | - | Simplification win               |
| 3  | 2026-05-13 | Cache DB queries   | Adding Redis cache will cut p95 latency in half         | Added redis-client + cache wrapper   | Tests pass but latency unchanged     | discard | + | Redis overhead cancelled benefit |
```

---

### When to Write a Journal Entry

Write a row **before and after** every task that:

- Modifies more than one file
- Changes any algorithm, data structure, or architectural decision
- Involves a non-obvious fix (where the root cause wasn't immediately obvious)
- Results in a revert (discard entries are the most valuable — they prevent re-trying failed approaches)

You may skip trivial changes (typo fixes, formatting, doc updates) — but err on the side of logging more, not less.

---

### Auto-Learn — Extracting Lessons from the Journal

The `journalLearnEveryNTasks` periodic action triggers the auto-learn cycle. When it fires:

1. **Read `JOURNAL.md`** — scan all entries since the last auto-learn run.
2. **Look for patterns**:
   - Any hypothesis type that appears in 2+ `discard` rows → likely a recurring anti-pattern for this codebase.
   - Any approach that appears in 2+ `keep` rows → likely a best practice worth formalising.
   - Any complexity delta `-` `keep` rows → simplification wins worth recording.
3. **Update `LESSONS.md`** — add one entry per new pattern discovered. Format: `YYYY-MM-DD — [pattern title]: [1-sentence description and why it matters here]`.
4. **Consider skill files** — if a pattern is reusable across tasks (3+ occurrences), write or update a skill file in `.claude/skills/<slug>/SKILL.md`.
5. **Annotate `JOURNAL.md`** — add a `## Auto-learn YYYY-MM-DD` heading after the last reviewed entry so future runs know where to start.

---

### Initialising JOURNAL.md (if missing)

If `JOURNAL.md` does not exist at session start:
1. Create it from the header skeleton above.
2. Add entry `#1` for the current task as `pending`.
3. Commit the new file: `git add JOURNAL.md && git commit -m "chore: initialise JOURNAL.md"`.

---

### Rules

- **Never delete rows.** `discard` is not shame — it is data. Future sessions read it to avoid re-trying failed approaches.
- **One hypothesis per row.** Do not batch multiple ideas into one entry.
- **Log before you revert.** If you are about to `git reset`, write the journal row first.
- **Commit JOURNAL.md with the task.** Include it in the same commit as the code change so the log and the diff stay in sync.
- **Do not write essays.** Keep every cell to one sentence or fewer. Brevity is the point.
