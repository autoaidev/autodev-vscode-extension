---
name: living-docs-reference
description: >-
  Full skeletons and entry formats for all living project documents: PROJECT.md,
  LESSONS.md, TROUBLESHOOTING.md, SETUP.md, CHANGELOG.md, DONE.md, JOURNAL.md.
  Use this whenever you need to create or update one of these files and need the
  exact format or skeleton.
---

# Living Docs Reference — Full Skeletons & Entry Formats

## PROJECT.md Skeleton
```markdown
# Project Knowledge Base

## Overview
- 

## Architecture & Module Map
- 

## Domain Logic
- 

## Data Models
- 

## Integrations & External Services
- 

## Deployment & Infrastructure
- 

## Environment Variables
- 
```

## LESSONS.md Entry Format (append, never overwrite)
```markdown
## YYYY-MM-DD — <short lesson title>

- **Pattern:** What mistake or correction occurred.
- **Why it happened:** The incorrect assumption or missed step.
- **Prevention rule:** The concrete instruction to follow next time.
- **Applies when:** Task types, files, or situations where this lesson matters.
```

## TROUBLESHOOTING.md Entry Format (append, never overwrite)
```markdown
## YYYY-MM-DD — <short title>

**Symptom:** What went wrong / what the error message said.
**Root cause:** Why it happened.
**Fix:** Exact change or command that resolved it.
**Recurrence signal:** How to detect this problem early next time.
```

## SETUP.md Skeleton
```markdown
# Setup & Installation

## Prerequisites
- 

## Installation
```bash
# step-by-step, tested commands only
```

## Environment Variables
| Variable | Required | Description |
|---|---|---|
| `VAR_NAME` | yes | what it does |

## Running the Project
```bash
# dev / test / build / production
```

## Known Setup Gotchas
- 
```

## CHANGELOG.md Entry Format (prepend — newest first)
```markdown
## [YYYY-MM-DD] <task text exactly as in TODO.md>

- **What changed:** Files modified and the nature of each change.
- **Why:** The reason for the change (task goal).
- **Impact:** Anything downstream that may be affected.
- **Notes:** Edge cases handled, decisions made, follow-ups needed.
```

## DONE.md Archival Format
```markdown
## Session YYYY-MM-DD

- [x] YYYY-MM-DD  feat: example task completed
  - [x] architect: spec + task breakdown
  - [x] coder: implement per spec
```

## JOURNAL.md Header (create if missing)
```markdown
# JOURNAL.md — Agent Research & Decision Log

Status: `keep` | `discard` | `partial` | `pending`
ΔC: `+` more complex | `-` simpler | `=` neutral

| # | Date | Task | Hypothesis | Approach | Outcome | Status | ΔC | Notes |
|---|---|---|---|---|---|---|---|---|
```

