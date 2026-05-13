## 0.5 Agent Contracts — CONTRACTS.md

**`CONTRACTS.md` is the project's contact directory and communication protocol.** It tells every agent exactly how to reach the human owner, any other agents in the system, and what channel to use for each type of message. Read it before sending any message, email, or notification.

---

### On Session Start — Read After SUMMARY.md

After reading `SUMMARY.md`, immediately check for `CONTRACTS.md` in the project root:

- **If `CONTRACTS.md` exists:** read it in full. Every entry is authoritative — use the addresses, aliases, and protocols listed there. Never guess or invent contact details.
- **If `CONTRACTS.md` does not exist:** create it now using the skeleton below. Do **not** fill in placeholder values — leave them blank; the human will supply real values. Commit the empty skeleton so future sessions find it.

---

### What CONTRACTS.md Contains

| Section | What to record |
|---|---|
| **Human contacts** | Name, email address(es), preferred channel, when to escalate vs. stay silent |
| **Agent contacts** | Each agent's name, role, and `@local` or SMTP email address it receives tasks on |
| **Routing rules** | Which type of message goes to which address (tasks, blockers, status, errors) |
| **Reply rules** | When to reply, when to stay silent, reply format per channel |
| **Escalation thresholds** | Conditions that must be met before contacting the human at all |

---

### Reading the Contracts

When you need to contact someone:

1. Open `CONTRACTS.md`.
2. Identify the **recipient** (human, specific agent, broadcast).
3. Find the **address** listed under that recipient.
4. Check the **routing rules** — confirm the message type is allowed on that channel.
5. Check the **escalation threshold** — do not contact the human unless the threshold is met.
6. Send using the MCP tool that matches the channel (`zerolib-email` for email, webhook for HTTP, etc.).

**Never invent or guess an email address.** If the address for a recipient is blank in `CONTRACTS.md`, leave a note in `TROUBLESHOOTING.md` explaining you could not contact them, and continue with the task.

---

### @local Email — What It Is and When to Use It

`@local` addresses (e.g. `agent@local`, `human@local`) are internal routing aliases used when a proper SMTP address is not yet configured. They are processed by the local email MCP server only — they do not leave the machine.

**Rules:**
- Use `@local` addresses only if they are explicitly listed in `CONTRACTS.md`.
- Do **not** invent `@local` addresses (e.g. `human@local`) — if it is not in `CONTRACTS.md`, it does not exist.
- If you need to reach someone and no `@local` address is listed, **do not send** — file a note in `TROUBLESHOOTING.md` instead.

---

### Communication Rules — Universal

These rules apply regardless of channel (email, webhook, Discord, etc.):

- **Email is the primary agent-to-agent communication medium.** It is the only channel that guarantees delivery. All other records (Jira comments, TODO.md edits, logs, changelogs) are audit trails — they are NOT notifications.
- **Jira comments and status transitions do NOT notify agents.** If an agent must act on a Jira ticket update, you must send them an email. Always. No exceptions.
- **Do NOT send a message just to report a task is done.** Mark `[x]` in `TODO.md` and continue.
- **Only contact the human when** at least one of the escalation thresholds in `CONTRACTS.md` is met.
- **Only contact another agent when** you have a specific, actionable item for that agent to act on.
- **One message per event.** Never send the same information twice.
- **Never include secrets** (API keys, passwords, tokens) in any message body.
- **Subject / title line:** prefix problem messages with `[needs input]`; prefix task assignments with `[task]`; prefix status updates with `[status]`.
- **Be specific.** Every outbound message must contain: what happened, what you need, and which file or artifact is relevant.

---

### Updating CONTRACTS.md

Update `CONTRACTS.md` whenever:
- A new agent is added to the project (add its role, address, and routing rules).
- A human's contact details change.
- A routing rule is revised.
- A new escalation threshold is agreed.

Never remove a contact entry — mark it `[inactive]` instead so history is preserved.

---

### CONTRACTS.md Skeleton (create if missing)

```markdown
# Agent Contracts

> Last updated: YYYY-MM-DD
> Read this file before sending any email, message, or notification.

---

## Human Contacts

| Name | Role | Email | Channel | Notes |
|---|---|---|---|---|
|  |  |  |  |  |

---

## Agent Contacts

| Agent name | Role | Address | Channel | Accepts |
|---|---|---|---|---|
|  |  |  |  |  |

*Address format: `user@example.com` for SMTP; `alias@local` for local MCP routing.*

---

## Routing Rules

| Message type | Send to | Channel | Condition |
|---|---|---|---|
| Task assignment (to another agent) |  | **email** | always — email is the only guaranteed notification channel |
| Task update / status change (to another agent) |  | **email** | whenever another agent must act; Jira/TODO updates alone are NOT enough |
| Blocker / needs input |  | **email** | threshold met (see below) |
| Error / failure report |  | **email** | threshold met |
| Status update (no action required) |  | — | do NOT send |

---

## Escalation Thresholds

Contact the human only when ALL of the following are true:

- [ ] The task cannot proceed without information only the human can provide.
- [ ] At least one automated retry has been attempted and failed.
- [ ] The blocker has been present for more than N minutes: **N = ___**

---

## Reply Rules

- Reply with subject prefix `[needs input]` when blocked.
- Reply with subject prefix `[task]` when delegating to another agent.
- Do NOT reply to confirm task completion.
- Do NOT CC anyone not already in the thread.
```
