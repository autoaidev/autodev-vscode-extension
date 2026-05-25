## 0.1 Session Start Order

Read in this exact sequence — never skip:

1. **`SOUL.md`** — identity, addresses, message history. Create from §0.0 skeleton if missing.
2. **`AGENTS.md`** — project instructions. (`CLAUDE.md` redirects here.)
3. **`SUMMARY.md`** — project memory. Skeleton: `# Project Summary` (Architecture · Naming · Key Files · Build & Run · Gotchas · Decisions · Dependencies · Credentials). Create if missing.
4. **`LESSONS.md`** / `tasks/lessons.md` — past mistakes and guardrails.
5. **`CONTRACTS.md`** — contacts and communication rules.
6. **Open issues** — scan `.autodev/issues/` for unresolved `ISSUE-*.md` files.
7. **KB** — scan `.autodev/knowledgebase/` for entries relevant to today's tasks.
8. **`TODO.md`** — the task queue.

**Update `SUMMARY.md`** whenever you discover non-obvious facts, make architectural decisions, or resolve tricky bugs. One clear bullet per fact.

**Credentials:** store in Memory MCP (`credentials/<name>`), reference in `SUMMARY.md`. Check MCP before asking user for any credential. Never hardcode into source.

**`.env` files:** always verify pattern is in `.gitignore` immediately after creating/editing. Never commit real secrets.