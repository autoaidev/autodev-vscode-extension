## 0.2 Memory MCP — Self-Learning & State Persistence

**The Memory MCP server is your long-term brain.** Use it continuously — not occasionally. Every insight, decision, failure, and resolved problem must be captured so future sessions start smarter, not from scratch.

### On Every Session Start

1. Query the Memory MCP for all nodes related to this project (search by project name, repo path, or domain).
2. Load and review all stored nodes before reading `TODO.md` or touching any file.
3. Cross-reference with `SUMMARY.md` — Memory MCP holds the live, granular detail; `SUMMARY.md` holds the curated overview.

### What to Store in Memory MCP

Store a new memory node whenever you:

| Trigger | What to capture | Node type |
|---|---|---|
| Discover a non-obvious architectural fact | Module relationships, data flow, entry points | `architecture` |
| Make a decision | What you chose, what you rejected, why | `decision` |
| Resolve a bug or error | Root cause, fix applied, how to detect recurrence | `bug` |
| Learn a project convention | Naming, patterns, error handling, test style | `convention` |
| Complete a task | What changed, what to watch for in related tasks | `task-outcome` |
| Encounter a gotcha | Anything that wasted time or caused confusion | `gotcha` |
| Receive or store a credential | Key name + purpose (never the raw value) | `credential` |
| Discover build/run commands | Exact commands that work in this environment | `runbook` |

### Memory Node Format

Every node must include:
- **name** — short, searchable identifier (e.g. `auth-middleware-flow`, `db-migration-pattern`)
- **type** — one of the node types above
- **observations** — bullet list of concrete, factual statements (no vague summaries)
- **project** — the project name or repo path for scoping

### Self-Learning Rules

- **Never re-derive what is already stored.** Before exploring a module, query Memory MCP first.
- **Correct stale memories.** If a stored observation is wrong or outdated, update it immediately — do not leave incorrect nodes.
- **Build on previous sessions.** Each session must leave the Memory MCP richer than it found it. If you read a file and learned something, store it.
- **Propagate discoveries.** If a bug fix reveals a root cause that affects other modules, create nodes for each affected area.
- **State continuity.** If a task is interrupted (`[~]` in `TODO.md`), store a `task-state` node describing exactly what was done and what remains — so the next session can resume without re-reading everything.

### After Every Task

Before marking `[x]` and committing, write at minimum one Memory MCP node capturing:
- What changed and in which files.
- Any gotcha or non-obvious detail encountered.
- Any convention or pattern confirmed or established.
