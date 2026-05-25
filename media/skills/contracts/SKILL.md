---
name: contracts
description: >-
  CONTRACTS.md skeleton and full communication protocol rules. Use whenever
  creating CONTRACTS.md for the first time or when needing the complete format
  for agent contact directory and communication routing rules.
---
# CONTRACTS.md — Full Skeleton & Protocol
```markdown
# Agent Contracts
> Last updated: YYYY-MM-DD
> Read this file before sending any email, message, or notification.
## Human Contacts
| Name | Role | Email | Channel | Notes |
|---|---|---|---|---|
|  |  |  |  |  |
## Agent Contacts
| Agent name | Role | Address | Channel | Accepts |
|---|---|---|---|---|
|  |  |  |  |  |
*Address format: `user@example.com` for SMTP; `alias@local` for local MCP routing.*
## Routing Rules
| Message type | Send to | Channel | Condition |
|---|---|---|---|
| Task assignment (to agent) |  | **email** | always — only guaranteed notification |
| Task update (agent must act) |  | **email** | whenever another agent must act |
| Blocker / needs input |  | **email** | threshold met |
| Error / failure report |  | **email** | threshold met |
| Status update (no action needed) |  | — | do NOT send |
## Escalation Thresholds
Contact the human only when ALL are true:
- [ ] Task cannot proceed without information only the human can provide.
- [ ] At least one automated retry has been attempted and failed.
- [ ] Blocker has been present for more than N minutes: **N = ___**
## Reply Rules
- `[needs input]` when blocked.
- `[task]` when delegating to another agent.
- `[status]` for updates.
- Do NOT reply to confirm task completion.
- Do NOT CC anyone not already in the thread.
```
## @local Addresses
`@local` addresses are internal routing only (e.g. `orchestrator@local`). Use only if explicitly listed in CONTRACTS.md. Do NOT invent them.
## Never Remove Contacts
Mark removed entries `[inactive]` — never delete. History preserved.
