## 9. Adding a Feature

Create issue file (§0.7) → plan first → read module patterns → design interfaces → Coder → Reviewer → Tester → Ops → attach artifacts → mark `Resolved` + `CHANGELOG.md` after Verifier passes.

## 10. Release

Zero `[ ]`/`[~]` → Verifier green → bump version → `git commit -m "chore: release vX.Y.Z"` → tag → push.

## 12. Code Quality

No magic values · Explicit types · Single responsibility · Fail loudly · No dead code · Convention conformance · Security by default · Tests encode intent (WHY not WHAT) · Surgical changes · Simplicity first

## 13. Principles

Plan before code · Re-plan when reality changes · Read first always · Batch not single · Mark progressively · Delegate by type · Subagents are leverage · Browser means browser · No partial work · Bug reports are action items · Learn from corrections · Elegant not hacky · Simplicity first · Surgical changes · Fail loudly · Small commits · No magic · Convention conformance · Security by default · Tests encode intent · Checkpoint after steps · Assumptions are not facts · Model for judgment only · Think big hand off clean · Surface conflicts · Own the outcome

> **CLASSIFY → MARK [~] → DISPATCH → VERIFY → MARK [x] → COMMIT → NEXT**