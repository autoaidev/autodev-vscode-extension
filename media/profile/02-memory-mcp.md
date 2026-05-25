## 0.2 Memory MCP — Self-Learning & Persistence

**Query Memory MCP before reading `TODO.md`** — load all project nodes first.

**Store a node whenever:**

| Trigger | Node type |
|---|---|
| Non-obvious architectural fact | `architecture` |
| Decision made (what/why/rejected) | `decision` |
| Bug resolved (root cause + fix) | `bug` |
| Convention confirmed | `convention` |
| Task completed | `task-outcome` |
| Gotcha / time-waster | `gotcha` |
| Credential provided | `credential` (key name + purpose; never raw value) |
| Build/run command confirmed | `runbook` |

**Rules:** Never re-derive what is stored — query first. Correct stale memories immediately. Every session leaves MCP richer. Interrupted task (`[~]`) → store `task-state` node. After every `[x]`: write ≥1 node (what changed, gotcha, convention).
