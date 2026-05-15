## 0.1 Learning Protocol — SUMMARY.md

**`SUMMARY.md` is your persistent project memory.** It survives across sessions and accumulates hard-won knowledge about this specific codebase.

### On Session Start — Full Reading Order

Every session must begin with the following files, in this exact order:

1. **`SOUL.md`** — your identity anchor. Read it first. It tells you your name, your contact addresses, and your message history. See **§0.0** for the full soul protocol. If it does not exist, create it before doing anything else.
2. **`AGENTS.md`** — primary project instructions (architecture, conventions, build commands, known footguns). **All tools read this file.** `CLAUDE.md` is only a redirect to it.
3. **`SUMMARY.md`** — project memory (this section).
4. **`LESSONS.md`** / `tasks/lessons.md` — past mistakes and corrections.
5. **`CONTRACTS.md`** — contact addresses and communication rules.
6. **`TODO.md`** — the task queue.

**Never skip SOUL.md or AGENTS.md.** Without them you have no stable identity and no project context.

---

### SUMMARY.md — Read Before TODO.md

Before reading `TODO.md`, before exploring the codebase, check for `SUMMARY.md` in the project root:

- **If `SUMMARY.md` exists:** read it in full before doing anything else. Treat every entry as authoritative — it captures decisions and discoveries made in prior sessions that are not obvious from the code.
- **If `SUMMARY.md` does not exist:** create it now using the skeleton below, then fill it in as you orient yourself.

Immediately after `SUMMARY.md`, check for a lessons log:

- **If `LESSONS.md` exists in the project root:** read the entries relevant to the current task before planning.
- **If the project uses `tasks/lessons.md` instead:** treat that as the canonical lessons log and read it at session start.
- **If neither exists yet:** create the project's canonical lessons log the first time a meaningful correction, preventable mistake, or repeat failure occurs.

Immediately after the lessons log, check for `CONTRACTS.md`:

- **If `CONTRACTS.md` exists:** read the `## Human Contacts` and `## Agent Contacts` sections now so you know who to reach and how before any work begins. Never rely on memory for contact addresses.
- **If `CONTRACTS.md` does not exist:** create it from the skeleton in §0.5 (blank — do not fill in addresses yourself; leave them for the human to complete), then continue.

### What Belongs in SUMMARY.md

Capture anything project-specific that would take future sessions time to rediscover:

| Category | Examples |
|---|---|
| **Architecture** | "Frontend is a React SPA; API lives at `/api`"; "Auth uses JWT in httpOnly cookies" |
| **Naming Conventions** | "Service classes: `*Service.ts`; repositories: `*Repo.ts`"; "Tests co-located as `*.test.ts`" |
| **Key Files** | Entry point, config loader, router, DB schema, env template |
| **Gotchas / Known Issues** | "`npm test` hangs without `--forceExit`"; "ORM requires raw SQL for bulk inserts" |
| **Decisions** | "Chose X over Y because Z"; "Deprecated: do not use `oldHelper()`" |
| **Build & Run** | Exact commands to build, test, lint, and start (dev and production) |
| **Dependencies** | Non-obvious third-party libraries and why they exist |
| **Credentials** | API keys, tokens, passwords, connection strings provided by the user |

### Credentials — Save Once, Reuse Always

If the user provides any credential during a session (API key, token, password, connection string, secret, etc.):

1. **Store it immediately** in the Memory MCP server (key: `credentials/<name>`, e.g. `credentials/openai_api_key`).
2. **Add a reference** to `SUMMARY.md` under `## Credentials` — record the key name and what it is for (never the raw value in plaintext where avoidable; store the actual secret only in the Memory MCP).
3. **On future sessions**, before asking the user for any credential, query the Memory MCP first. If a stored value exists, use it silently without prompting the user again.
4. **Never hardcode** credentials into source files. If a config file requires a value, read it from the Memory MCP at runtime or inject it via an environment variable.

### .env Files — Safety Rules

- **Any time you create or edit a `.env` file** (`.env`, `.env.local`, `.env.production`, etc.), immediately verify that the filename pattern is present in `.gitignore`. If it is missing, add it before doing anything else.
- **Use Memory MCP credentials when populating `.env` files** — look up stored keys (`credentials/<name>`) and write them into the file rather than leaving placeholders or asking the user.
- **For tests** that require credentials: read them from the Memory MCP and inject via environment variables in the test runner config (e.g. `process.env`, `.env.test`). Never commit real secrets in test fixtures.
- **Never commit a `.env` file** containing real secrets. If a committed `.env.example` is needed, populate it with placeholder values only (e.g. `YOUR_API_KEY_HERE`).

### When to Update SUMMARY.md

Update it whenever you:
- Discover something non-obvious during codebase orientation.
- Make an architectural or convention decision that future sessions must honour.
- Resolve a tricky bug whose root cause could recur.
- Complete a task that changes how the project is built, run, or structured.

Keep entries concise — one clear bullet per fact. No filler.

### Lessons Learned — Review Early, Update After Corrections

- Treat every user correction, verifier rejection, or repeatable self-inflicted mistake as a signal to improve future behaviour.
- After the issue is resolved, append the pattern, root cause, and prevention rule to `LESSONS.md` or `tasks/lessons.md`.
- Keep lesson entries action-oriented: what went wrong, how to spot it sooner, and the concrete guardrail that prevents recurrence.
- Review relevant lessons at the start of future sessions before taking similar work.

### SUMMARY.md Skeleton (create if missing)

```markdown
# Project Summary

## Architecture
- 

## Naming & Conventions
- 

## Key Files
- 

## Build & Run
- 

## Gotchas & Known Issues
- 

## Decisions
- 

## Dependencies (non-obvious)
- 

## Credentials
- <!-- key name → what it is for (actual values stored in Memory MCP only) -->
```
