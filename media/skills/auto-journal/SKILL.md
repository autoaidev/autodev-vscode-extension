# SKILL: Auto-Journal — Hypothesis Loop & Research Log

**When to use this skill:** Starting any non-trivial task; after completing a task; when reverting a change; when the `journalLearnEveryNTasks` periodic action fires.

---

## The Loop (run for every task)

```
LOOP FOREVER — one iteration = one task:

  ┌─ 1. HYPOTHESIZE ─────────────────────────────────────────────────────┐
  │  Before touching code:                                               │
  │  a. Read the task from TODO.md.                                      │
  │  b. Form a one-sentence hypothesis: "I expect X to achieve Y."       │
  │  c. Open JOURNAL.md. Add a new row with status = pending.            │
  │  d. Mark task [~] in TODO.md.                                        │
  └──────────────────────────────────────────────────────────────────────┘
           │
           ▼
  ┌─ 2. IMPLEMENT ───────────────────────────────────────────────────────┐
  │  Make the smallest change that tests the hypothesis.                 │
  │  One idea at a time. Prefer readable, reversible diffs.             │
  │  git commit the change (even if experimental).                       │
  └──────────────────────────────────────────────────────────────────────┘
           │
           ▼
  ┌─ 3. VERIFY ──────────────────────────────────────────────────────────┐
  │  Run tests, linter, build.                                           │
  │  Measure the outcome: did the hypothesis hold?                       │
  │  Record the measured result (pass/fail, error message, metric).      │
  └──────────────────────────────────────────────────────────────────────┘
           │
      ┌────┴────┐
      │         │
     YES        NO
   (improved  (no improvement,
   or correct)  crash, or worse)
      │         │
      ▼         ▼
  ┌─ 4a. KEEP ──┐   ┌─ 4b. DISCARD ──────────────────────────────────────┐
  │  Update     │   │  Write JOURNAL.md row NOW, before reverting.        │
  │  JOURNAL.md │   │  git reset --hard <last-good-commit>                │
  │  status=keep│   │  Update JOURNAL.md row: status=discard              │
  │  Mark [x]   │   │  Notes: why it failed / what to try instead         │
  │  in TODO.md │   │  Do NOT mark [x] — put task back as [ ] if needed  │
  └─────────────┘   └─────────────────────────────────────────────────────┘
           │                   │
           └─────────┬─────────┘
                     │
                     ▼
  ┌─ 5. COMMIT JOURNAL.md ───────────────────────────────────────────────┐
  │  git add JOURNAL.md                                                  │
  │  git commit -m "chore: journal entry #<N> [<task>] — <status>"      │
  └──────────────────────────────────────────────────────────────────────┘
           │
           ▼
        REPEAT — pick next [ ] task from TODO.md. NEVER STOP.
```

---

## Simplicity Criterion

Before deciding `keep` vs `discard`, apply the simplicity check:

```
IF outcome_is_equal OR outcome_is_better:
    IF approach adds net complexity (ΔC = +):
        → weigh the benefit against the complexity cost
        → a tiny gain + ugly code = discard
        → a meaningful gain + ugly code = partial (note for later cleanup)
    IF approach removes complexity (ΔC = -):
        → ALWAYS keep — simplification wins are the best wins
    IF approach is neutral (ΔC = =):
        → keep if outcome improved, discard if no improvement
ELSE (outcome is worse):
    → always discard, regardless of complexity
```

---

## Auto-Learn Cycle (when journalLearnEveryNTasks fires)

The periodic action sends you this prompt. When you receive it, follow these steps:

### Step 1 — Scope the review
Find the most recent `## Auto-learn YYYY-MM-DD` heading in `JOURNAL.md`.
All entries *after* that heading (or all entries if none exists) are "unreviewed".

### Step 2 — Scan for patterns

Read each unreviewed row. Build a mental tally:

| Signal | What to look for |
|---|---|
| 2+ `discard` rows with similar Hypothesis or Approach | Anti-pattern — add to LESSONS.md |
| 2+ `keep` rows with similar Approach | Best practice — add to LESSONS.md or update skill |
| 3+ occurrences of either | Create or update a skill file |
| Any `keep` row with ΔC = `-` | Simplification win — highlight in LESSONS.md |
| Any row where Outcome contradicts the Hypothesis | Knowledge gap — note what the codebase actually does |

### Step 3 — Update LESSONS.md

Add one entry per pattern. Format:
```
YYYY-MM-DD — [Pattern Title]: [What it is and why it matters in this codebase]
```

Example:
```
2026-05-13 — Redis caching overhead: Adding Redis cache in this project
consistently adds more latency than it removes due to the low-latency
local DB. Do not introduce Redis unless load testing shows sustained
>500 concurrent requests.
```

### Step 4 — Consider skill files

If a pattern has appeared 3+ times and is actionable:
- Check if `.claude/skills/<relevant-slug>/SKILL.md` already exists.
- If it does: add a note or update the relevant step.
- If it doesn't: create it with the pattern as the first rule.

### Step 5 — Mark the review in JOURNAL.md

Append a heading at the current position:
```markdown
## Auto-learn 2026-05-13

*Reviewed entries #N–#M. Patterns distilled: [brief summary]*
```

Then commit:
```bash
git add JOURNAL.md LESSONS.md
git commit -m "chore: auto-learn journal review [entries #N–#M]"
```

---

## Initialising JOURNAL.md (if missing)

```markdown
# JOURNAL.md — Agent Research & Decision Log

Each row records one hypothesis and its outcome.
Status: `keep` | `discard` | `partial` | `pending`
Complexity delta: `+` more complex | `-` simpler | `=` neutral

| # | Date | Task | Hypothesis | Approach | Outcome | Status | ΔC | Notes |
|---|---|---|---|---|---|---|---|---|
```

After creating it:
```bash
git add JOURNAL.md
git commit -m "chore: initialise JOURNAL.md"
```

---

## Quick Reference

| Situation | Action |
|---|---|
| Starting a task | Write hypothesis row (pending) in JOURNAL.md first |
| Change worked | Update row to `keep`, mark `[x]` in TODO.md |
| Change failed / worse | Write row (`discard`), revert BEFORE next task |
| About to `git reset` | Write journal row first — then reset |
| Two equal approaches | Pick the simpler one (ΔC = `-` wins) |
| journalLearn fires | Run auto-learn cycle (steps 1–5 above) |
| JOURNAL.md missing | Create from skeleton above, commit |
| Recurring failure pattern | Add to LESSONS.md immediately (don't wait for auto-learn) |
