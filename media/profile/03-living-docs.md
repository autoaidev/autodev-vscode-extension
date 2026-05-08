## 0.3 Continuous Self-Improvement — Living Project Docs

Beyond `SUMMARY.md` and Memory MCP, the agent maintains four **living documents** in the project root. These are never deleted — they grow with every session.

---

### PROJECT.md — Project Knowledge Base

**Purpose:** Deep, evergreen knowledge about this project — architecture, domain logic, module map, data models, integrations, deployment topology.

**Update when:**
- A new module, service, or integration is added or understood.
- The data model or API contract changes.
- Infrastructure or deployment details are discovered or modified.
- Any fact is learned that future developers would need to understand the system.

**Format:**
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

**Rule:** Create `PROJECT.md` at the start of the first session if it does not exist. Add at least one new entry per session.

---

### TROUBLESHOOTING.md — Failure & Fix Register

**Purpose:** A searchable record of every error, failure, and gotcha encountered — with root cause and fix. Prevents the same problem from consuming time twice.

**Update when:**
- Any error, exception, test failure, or build break is resolved.
- A confusing behaviour is explained.
- A workaround is applied (document the real fix too, if known).

**Entry format (append, never overwrite):**
```markdown
## YYYY-MM-DD — <short title>

**Symptom:** What went wrong / what the error message said.
**Root cause:** Why it happened.
**Fix:** Exact change or command that resolved it.
**Recurrence signal:** How to detect this problem early next time.
```

**Rule:** Create `TROUBLESHOOTING.md` if it does not exist. Every resolved error must get an entry before the task is marked `[x]`.

---

### SETUP.md — Installation & Onboarding Guide

**Purpose:** Exact, tested steps to get the project running from scratch on a clean machine. Updated every time the setup process changes.

**Update when:**
- A new dependency or tool is required.
- An environment variable is added or renamed.
- The build, test, or start commands change.
- A prerequisite (runtime version, service, credentials) is discovered.

**Format:**
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
# dev
# test
# build
# production
```

## Known Setup Gotchas
- 
```

**Rule:** Create `SETUP.md` if it does not exist. Commands in `SETUP.md` must be verified to actually work — never copy-paste without testing.

---

### CHANGELOG.md — Completed Work Log

**Purpose:** A permanent, human-readable record of every task completed. Written at the moment a task is marked `[x]` in `TODO.md`.

**Rule: Every task completion MUST produce a CHANGELOG.md entry.** This is not optional. The entry is written before the git commit.

**Entry format (prepend — newest first):**
```markdown
## [YYYY-MM-DD] <task text exactly as it appeared in TODO.md>

- **What changed:** Files modified and the nature of each change.
- **Why:** The reason for the change (task goal).
- **Impact:** Anything downstream that may be affected.
- **Notes:** Edge cases handled, decisions made, follow-ups needed.
```

**Skeleton (create if missing):**
```markdown
# Changelog

All completed tasks are recorded here in reverse-chronological order.

---
```

**Rule:** Create `CHANGELOG.md` if it does not exist. Never edit or delete past entries. The Done section of `TODO.md` is a status list; `CHANGELOG.md` is the detailed record.
