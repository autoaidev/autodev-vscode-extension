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

### LESSONS.md — Correction Patterns & Guardrails

**Purpose:** A compact log of mistakes, user corrections, and durable rules that prevent the same error from happening again.

**Use this file when:**
- The user corrects the agent's behaviour, interpretation, or output.
- A verifier, reviewer, or test failure exposes a preventable mistake.
- The same class of mistake appears more than once across sessions.

**Project-path rule:** If the repository already standardises on `tasks/lessons.md`, update that file instead of creating a duplicate root-level `LESSONS.md`.

**Entry format (append, never overwrite):**
```markdown
## YYYY-MM-DD — <short lesson title>

- **Pattern:** What mistake or correction occurred.
- **Why it happened:** The incorrect assumption, shortcut, or missed verification step.
- **Prevention rule:** The concrete instruction to follow next time.
- **Applies when:** Task types, files, or situations where this lesson matters.
```

**Rule:** Review relevant lessons at session start before similar work. After any meaningful correction, add the lesson before the parent task is marked `[x]`.

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

---

### CONTRACTS.md — Agent Contact Directory & Communication Protocol

**Purpose:** The single source of truth for how agents contact the human and each other. Lists real email addresses, `@local` routing aliases, per-channel rules, and the escalation thresholds that must be met before the human is contacted. See **§0.5** for the full protocol.

**Update when:**
- A new agent or human contact is added to the project.
- An address, alias, or routing rule changes.
- An escalation threshold is revised.

**Rule:** Create `CONTRACTS.md` from the skeleton in §0.5 at the start of the first session if it does not exist. Never guess or invent contact addresses — leave blanks for the human to fill in. Mark removed contacts `[inactive]` rather than deleting them.

---

### `.autodev/issues/ISSUE-NNN-ISSUE_TITLE.md` — Per-Issue Living Documents

**Purpose:** A single aligned, append-only record for every issue, ticket, bug, or user story. Tracks the full evolution of the issue over time — user story, acceptance criteria, technical approach, work log, artifacts, related issues, and final resolution. Any agent reading it must understand the full story without looking at Jira, email, or any other source.

**Directory:** `.autodev/issues/` · **Filename format:** `ISSUE-{NUMBER}-{kebab-case-title}.md` — e.g. `ISSUE-123-user-login-timeout.md`. Use `0` as the number for local issues without an external ticket number.

**Create when:**
- A Jira ticket, GitHub issue, or user story is assigned or referenced.
- An email describes a problem or feature with an issue number.
- A multi-session problem is identified that needs a stable reference.

**Update when:**
- Work begins or progresses on the issue (append a Work Log entry).
- A new finding, decision, or blocker is reached.
- An artifact is produced (screenshot, log, report, diff).
- The issue is resolved (fill in the Resolution section and attach verification artifacts).

**Rule:** Create the file before doing any work on the issue. Never delete it — set `Status: Resolved` when done. See **§0.7** for the full skeleton and protocol.

---

### `.autodev/knowledgebase/KB-NNN-title.md` — Knowledge Base

**Purpose:** Reusable, project-level knowledge — architectural decisions, domain rules, recurring patterns, integration quirks, confirmed gotchas, and any insight that would otherwise be re-discovered repeatedly. Unlike issues (which track problems), KB entries are **evergreen reference material**.

**Directory:** `.autodev/knowledgebase/` · **Filename format:** `KB-{NUMBER}-{kebab-case-title}.md` — e.g. `KB-001-auth-token-refresh-flow.md`. Use `0` for local insights with no external reference.

**Create when:**
- An architectural decision is made that should not be re-litigated.
- A pattern applies across more than one part of the codebase.
- An integration quirk or external API behaviour is confirmed.
- A recurring question from a human or agent is answered definitively.
- A `JOURNAL.md` `keep` outcome produces transferable insight.
- A `TROUBLESHOOTING.md` entry reveals a class of problem worth preventing proactively.

**Update when:**
- The knowledge evolves — append a Change History entry and update the body in place.
- A related issue is opened or closed — cross-reference both files.
- The entry is superseded — mark `Status: Deprecated`, add a `Superseded by:` link.

**Rule:** Write the KB entry during the session the insight is confirmed — not later. Never delete. See **§0.8** for the full skeleton and protocol.


