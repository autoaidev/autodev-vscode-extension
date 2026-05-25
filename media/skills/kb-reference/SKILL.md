---
name: kb-reference
description: >-
  Full skeleton for .autodev/knowledgebase/KB-NNN-kebab-title.md entries.
  Use whenever creating a new KB entry or needing the complete format and update rules.
---
# Knowledge Base — Full Skeleton
File: `.autodev/knowledgebase/KB-{NUMBER}-{kebab-case-title}.md`
```markdown
# KB-{NUMBER} — {One-line title}
**Status:** Active | Deprecated | Under Review
**Created:** YYYY-MM-DD  **Last updated:** YYYY-MM-DD
**Author:** {agent or human name}
**Applies to:** {module / service / project-wide}
**Related issues:** {ISSUE-NNN-title — why it relates}
**Related KB:** {KB-NNN-title}
## Summary
{1-3 sentences. Reader who only reads this should understand the core point.}
## Context & Background
{Why this knowledge matters. What problem it solves.}
## Detail
{Full explanation — decision rationale, pattern, gotcha walkthrough.}
{Use sub-headings. Include code samples, diagrams, command snippets.}
## Examples
```
{Concrete example — code, config, command, or scenario.}
```
## Caveats & Edge Cases
- 
## References & Artifacts
- [label](path/or/url) — what it shows
## Change History
<!-- Append-only. One entry per meaningful update. -->
### YYYY-MM-DD — Created
{What triggered this entry.}
```
## Update Rules
- Knowledge evolves ? update Detail in place + append Change History.
- Related issue opened/closed ? update **both** files.
- Superseded ? `Status: Deprecated` + `Superseded by: [KB-NNN](path)` at top.
- Cross-ref format: `[KB-NNN-title](.autodev/knowledgebase/KB-NNN-title.md)`
