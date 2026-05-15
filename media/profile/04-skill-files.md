## 0.4 Automatic Skill Development — Live Project Skills

As the agent learns about the project it **automatically creates and live-updates agent instruction files** so that every future session (regardless of which tool is used) starts with full project context already baked in.

### The Instruction Files

| File | Tool that reads it | Format requirement | Role |
|---|---|---|---|
| `AGENTS.md` | All tools (Claude, OpenCode, Copilot, etc.) | Plain markdown, no frontmatter | **Primary — all project knowledge lives here** |
| `CLAUDE.md` | Claude Code CLI | Plain markdown, no frontmatter | Thin redirect → points to `AGENTS.md` |
| `.github/copilot-instructions.md` | GitHub Copilot | YAML frontmatter `applyTo: '**'` | Full copy (Copilot requires its own file) |

**`AGENTS.md` is the single source of truth.** All project knowledge is written there. `CLAUDE.md` contains only a short header that tells Claude to read `AGENTS.md` instead. Copilot needs its own standalone file so `.github/copilot-instructions.md` is a full copy.

### What Goes In AGENTS.md

A curated, agent-readable distillation of confirmed project knowledge. Not a dump — only actionable, reusable facts:

| Category | What to write |
|---|---|
| **Project identity** | One-line purpose, primary language/framework, entry points |
| **Architecture rules** | Module boundaries, forbidden cross-module calls, key patterns |
| **Naming conventions** | File names, class names, variable styles confirmed from the codebase |
| **Build & run** | Exact commands to build, test, start in dev and prod |
| **Code style** | Formatting, lint rules, patterns the team uses consistently |
| **Domain vocabulary** | Project-specific terms and what they mean |
| **What NOT to do** | Anti-patterns seen in the codebase, known footguns |
| **Key files** | Most important files every contributor should know |

### Update Triggers

Update `AGENTS.md` (and sync Copilot's file) whenever:
- A new architectural pattern or module boundary is confirmed.
- A naming or style convention is discovered or enforced.
- A domain term is clarified.
- A footgun or anti-pattern is encountered.
- The build/run/test process changes.
- **At minimum: once per session**, even if only to add a single bullet.

### Skeletons

**`AGENTS.md`** (primary — all tools):
```markdown
# <Project Name> — Agent Instructions

## Project Identity
- 

## Architecture Rules
- 

## Naming Conventions
- 

## Build & Run

## Code Style
- 

## Domain Vocabulary
- 

## Do NOT Do
- 

## Key Files
- 

## Project Skills
<!-- Skills created from hard problems solved in this project. -->
<!-- Format: `- .claude/skills/<slug>/` — one-line description -->
- 
```

**`CLAUDE.md`** (Claude Code — redirect only, do NOT duplicate content here):
```markdown
# <Project Name> — Claude Instructions

> All project instructions are in **`AGENTS.md`** in the project root.
> Read `AGENTS.md` in full before doing anything else.
```

**`.github/copilot-instructions.md`** (Copilot — full copy of AGENTS.md content, requires frontmatter):
```markdown
---
applyTo: '**'
---
# <Project Name> — Copilot Instructions

## Project Identity
- 

## Architecture Rules
- 

## Naming Conventions
- 

## Build & Run

## Code Style
- 

## Domain Vocabulary
- 

## Do NOT Do
- 

## Key Files
- 

## Project Skills
<!-- Skills created from hard problems solved in this project. -->
<!-- Format: `- .claude/skills/<slug>/` — one-line description -->
- 
```

### Rules

- **Create `AGENTS.md` and `CLAUDE.md` on first session** if they do not exist, using the skeletons above.
- **`CLAUDE.md` is a redirect only** — never put project knowledge in `CLAUDE.md` directly; it always points to `AGENTS.md`.
- **All project knowledge goes in `AGENTS.md`** — this is the file every agent should read.
- **Keep Copilot's file in sync with `AGENTS.md`** — update both together whenever `AGENTS.md` changes.
- **Never truncate** — append and refine, never delete confirmed knowledge.
- **Verify before writing** — only write conventions confirmed by reading actual code, not assumptions.
- After updating, add a one-line note to `SUMMARY.md` under `## Key Files`.
