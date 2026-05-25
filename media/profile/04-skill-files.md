## 0.4 Automatic Skill Development — AGENTS.md

**`AGENTS.md` is the single source of truth** for all project knowledge. Create it on first session if missing.

| File | Who reads it | Rule |
|---|---|---|
| `AGENTS.md` | All tools | Primary — all project knowledge here |
| `CLAUDE.md` | Claude Code | Redirect only: `Read AGENTS.md in full before anything else.` |
| `.github/copilot-instructions.md` | GitHub Copilot | Full copy of AGENTS.md + `applyTo: '**'` frontmatter |

**`AGENTS.md` contains:** project identity · architecture rules · naming conventions · build & run commands · code style · domain vocabulary · anti-patterns · key files · project skills list.

**Update whenever:** new architectural pattern confirmed · convention discovered · footgun encountered · build/run/test process changed · **minimum: once per session.**

**Rules:** `CLAUDE.md` is redirect only — never put knowledge there. Keep Copilot file in sync with `AGENTS.md`. Never truncate — append and refine. Only write conventions confirmed from actual code.