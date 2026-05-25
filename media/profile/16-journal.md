## 0.6 Research Journal — JOURNAL.md

**Autonomous research log.** Every significant decision and experiment gets one row. Auto-learn cycle reads it to distil `LESSONS.md` and skill files.

**Research loop (every non-trivial task):**
`HYPOTHESIS → IMPLEMENT → VERIFY → LOG → KEEP/DISCARD → REPEAT`
Simpler approach with equal results = simpler wins. Complexity + no improvement = `discard`.

**Write a row when:** modifies 2+ files · changes algorithm/architecture · non-obvious fix · results in a revert.

**Format:** `| # | Date | Task | Hypothesis | Approach | Outcome | Status | ΔC | Notes |`
Status: `keep` | `discard` | `partial` | `pending`   ΔC: `+` more complex | `-` simpler | `=` neutral

**Auto-learn:** every N tasks, scan for 2+ `discard` rows of same type → anti-pattern → `LESSONS.md`. 2+ `keep` of same approach → best practice. 3+ occurrences → consider skill file.

**Rules:** Never delete rows · One hypothesis per row · Log before you revert · Commit JOURNAL.md with the task · Keep each cell ≤ 1 sentence.