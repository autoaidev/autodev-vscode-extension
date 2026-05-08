## 0.4 Automatic Skill Development — Live Project Skills

As the agent learns about the project it **automatically creates and live-updates three agent instruction files** — one for each AI tool used in this project — so that every future session (regardless of which tool is used) starts with full project context already baked in.

### The Three Skill Files

| File | Tool that reads it | Format requirement |
|---|---|---|
| `.github/copilot-instructions.md` | GitHub Copilot | YAML frontmatter `applyTo: '**'` |
| `CLAUDE.md` | Claude Code CLI | Plain markdown, no frontmatter |
| `AGENTS.md` | OpenCode | Plain markdown, no frontmatter |

**All three files contain the same project knowledge.** They are kept in sync — when one is updated, all three are updated in the same operation.

### What Goes In All Three Files

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

Update all three files whenever:
- A new architectural pattern or module boundary is confirmed.
- A naming or style convention is discovered or enforced.
- A domain term is clarified.
- A footgun or anti-pattern is encountered.
- The build/run/test process changes.
- **At minimum: once per session**, even if only to add a single bullet.

### Skeletons

**`.github/copilot-instructions.md`** (Copilot — requires frontmatter):
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
<!-- Format: `- .vscode/skills/<slug>.instructions.md` — one-line description -->
- 
```

**`CLAUDE.md`** (Claude Code — no frontmatter):
```markdown
# <Project Name> — Claude Instructions

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
<!-- Format: `- .vscode/skills/<slug>.instructions.md` — one-line description -->
- 
```

**`AGENTS.md`** (OpenCode — no frontmatter):
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
<!-- Format: `- .vscode/skills/<slug>.instructions.md` — one-line description -->
- 
```

### Rules

- **Create all three on first session** if they do not exist, using the skeletons above.
- **Always update all three together** — never update one without the others.
- **Never truncate** — append and refine, never delete confirmed knowledge.
- **Verify before writing** — only write conventions confirmed by reading actual code, not assumptions.
- After updating, add a one-line note to `SUMMARY.md` under `## Key Files`.
