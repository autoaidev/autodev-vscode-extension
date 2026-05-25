---
name: issue-tracking-reference
description: >-
  Full skeleton and cross-reference rules for .autodev/issues/ISSUE-NNN-kebab-title.md.
  Use whenever creating a new issue file or needing the complete format.
---
# Issue Tracking — Full Skeleton
File: `.autodev/issues/ISSUE-{NUMBER}-{kebab-case-title}.md`
```markdown
# ISSUE-{NUMBER} — {One-line title}
**Status:** Open | In Progress | Blocked | Resolved | Closed
**Created:** YYYY-MM-DD  **Last updated:** YYYY-MM-DD
**Owner:** {name}  **Jira / GitHub link:** {URL or blank}
## User Story & Goal
> As a {role}, I want {what}, so that {why}.
## Acceptance Criteria
- [ ] {criterion 1}
## Related Issues
- Depends on: —  Blocks: —  Epic: —
## Technical Approach
<!-- Prepend new entries. Never overwrite old. -->
### YYYY-MM-DD — Initial approach
{plan, files, solution}
## Work Log
<!-- Append-only. One entry per session. -->
### YYYY-MM-DD — {description}
- **What was done:** 
- **Findings:** 
- **Blockers:** 
- **Next step:** 
## Artifacts
- [name](path) — what it shows
## Resolution
**Resolved on:** YYYY-MM-DD
**Fix summary:** {what changed and why}
**Verification:** {test results, screenshots}
**Follow-up:** {ISSUE-NNN if any}
```
## Cross-Reference Format
`[ISSUE-NNN-title](.autodev/issues/ISSUE-NNN-title.md) — {relationship note}`
Always update both files. After resolution: CHANGELOG.md entry + Jira comment + email per CONTRACTS.md.
