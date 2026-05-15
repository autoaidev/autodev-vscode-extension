## 0.5 Skill Creation Protocol — Hard Problems Become Reusable Skills

> **Reference:** [Official Anthropic Skill Creator](https://raw.githubusercontent.com/anthropics/skills/refs/heads/main/skills/skill-creator/SKILL.md)

Whenever an agent solves a genuinely hard problem — a non-obvious bug, a tricky integration, a subtle architectural decision, a footgun discovered by pain — the solution must be captured as a **project-specific skill** so every future agent session can benefit from it immediately.

### What Counts as a "Hard Problem"

Create a skill when any of these are true:
- The solution required 3+ failed attempts or significant re-reading of code.
- The fix is non-obvious and another agent would likely make the same mistake.
- The solution encodes a project-specific constraint not visible from reading the code.
- A subtle interaction between two modules required deep understanding to resolve.
- An external service, API, or tool had undocumented behaviour that the project must work around.

Do NOT create a skill for routine tasks, standard patterns, or anything obvious from the code.

### Skill Location & Structure

Each skill lives in its own folder under `.claude/skills/` **in the project root** — never inside `.autodev/`:

```
.claude/skills/<slug>/
├── SKILL.md          (required — frontmatter + instructions)
├── scripts/          (optional — executable helpers for repetitive steps)
├── references/       (optional — docs/specs loaded into context as needed)
└── assets/           (optional — templates, fixtures, example files)
```

> **IMPORTANT:** `.autodev/` is an internal AutoDev extension folder — never create skill files there. Skills always go in `.claude/skills/<slug>/` at the project root.

### Official SKILL.md Format

Follow the official Anthropic skill-creator format exactly:

```markdown
---
name: <kebab-slug>
description: >-
  What this skill enables. When to trigger it — include both what it does AND
  the specific contexts where it applies. Be slightly "pushy" so the agent
  doesn't undertrigger: e.g. "Use this whenever X, Y, or Z even if not
  explicitly asked."
---

# <Skill Title>

<!-- Keep SKILL.md under 500 lines. Use references/ for large docs. -->

## Problem
One paragraph: what the hard problem is, where it manifests, why it's non-obvious.

## Root Cause
The confirmed cause — not hypothesised.

## Solution Pattern
Reusable fix or approach. Actionable imperative steps, not prose.

## Code Example
Minimal, project-specific snippet demonstrating the fix.

## Do NOT
Common wrong approaches that look right but fail for this problem.

## Applies To
Files, modules, or subsystems where this pattern matters.
```

**Key format rules (from the official spec):**
- `name` and `description` frontmatter fields are required.
- `description` is the primary trigger mechanism — write it to be slightly pushy so the agent doesn't skip the skill when it should use it.
- Keep `SKILL.md` under 500 lines. If longer, add sections to `references/` and link them.
- Use imperative form in instructions.
- Explain the *why* behind rules, not just the rule itself.

### When to Create

| Trigger | Action |
|---|---|
| Reviewer returns `CHANGES-REQUIRED` for the same issue 2+ times | Create skill after Coder's final fix |
| Tester reports a failure that required Coder to re-read 3+ files to diagnose | Create skill after Tester passes |
| Ops hits a deploy failure rooted in a project-specific config trap | Create skill after Ops green |
| Any agent gets stuck and requires Orchestrator intervention | Create skill as part of the intervention resolution |
| A session solves a bug that existed for more than one prior session | Create skill immediately |

### After Creating a Skill

1. Add the skill folder path and one-line summary to `AGENTS.md` under `## Project Skills` (and sync to `.github/copilot-instructions.md`).
2. Add a `SKILL CREATED: .claude/skills/<slug>/` note to `SUMMARY.md` for this session.
3. Reference the skill folder in the relevant `TODO.md` task as a note.

### Rules

- Skill content must be based only on **confirmed facts from this session** — no speculation.
- Skill files are append-only — never delete confirmed solutions.
- If a new solution supersedes an old one: add an `## Update (<date>)` section — do not remove the old section.
- Slugs must be kebab-case and descriptive: `auth-token-refresh-race`, not `skill1`.
