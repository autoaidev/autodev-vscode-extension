---
name: contracts
description: >-
  Contact directory and communication protocol for agents using CONTRACTS.md.
  Use this skill whenever you need to contact the human owner, send a task to
  another agent, or decide whether an escalation is warranted.
  Provides the lookup protocol for reading CONTRACTS.md, resolving @local
  aliases, applying routing rules, and checking escalation thresholds before
  sending any message. Apply before every outbound email, webhook call, or
  agent-to-agent task dispatch.
user-invocable: false
---

## Contracts protocol (CONTRACTS.md)

`CONTRACTS.md` in the project root is the authoritative contact directory. Read it before sending any message.

---

## Step 1 — Look up the recipient

Open `CONTRACTS.md` and find the section that matches your recipient type:

| Who you need | Look in |
|---|---|
| Human owner / operator | `## Human Contacts` |
| Another agent in this project | `## Agent Contacts` |
| Broadcast to all agents | `## Agent Contacts` — send to each listed address individually |

Copy the exact address from the table. **Never invent or assume an address.**

If the address cell is blank or the recipient is not listed:
1. Do **not** send a message.
2. Add an entry to `TROUBLESHOOTING.md`: date, who you were trying to reach, and why.
3. Continue with the task — the missing contact does not block you unless the task explicitly requires a response.

---

## Step 2 — Check routing rules

Before sending, open the `## Routing Rules` section of `CONTRACTS.md` and confirm:

- The **message type** you are sending matches a row in the table.
- The **channel** listed for that message type matches the MCP tool you plan to use.
- The **condition** column is satisfied.

If no matching row exists, treat the message as **do not send** and log a note in `TROUBLESHOOTING.md`.

---

## Step 3 — Check escalation thresholds (human contact only)

Before contacting the human, verify every threshold in `## Escalation Thresholds` is met:

- The task cannot continue without information only the human can supply.
- At least one automated retry has been attempted and failed.
- The blocker has persisted for longer than the configured minimum time.

If any threshold is **not** met: do not send. Continue working or log the issue in `TROUBLESHOOTING.md`.

---

## Step 4 — Format the message

| Message type | Subject prefix | Content required |
|---|---|---|
| Blocker / needs input | `[needs input]` | What you need, why you are blocked, which file/artifact is involved |
| Task assignment to another agent | `[task]` | Exact task text, acceptance criteria, relevant file paths |
| Status update | *(do not send)* | — |
| Completion report | *(do not send)* | — |

Rules:
- Never include secrets (API keys, passwords, tokens) in any message body.
- Include supporting artifacts where relevant: file paths, log excerpts, error traces, diff snippets.
- One message per event — never send duplicates.

---

## Step 5 — Send using the correct MCP tool

| Channel | MCP tool |
|---|---|
| SMTP email | `zerolib-email` |
| `@local` alias | `zerolib-email` (local routing mode) |
| HTTP webhook | webhook MCP or direct HTTP call |
| Discord | Discord MCP or gateway |

After sending, record in `TROUBLESHOOTING.md` if the send failed. Do not retry more than once automatically — escalation loops waste time and fill inboxes.

---

## @local address rules

`@local` addresses (e.g. `orchestrator@local`, `reviewer@local`) are processed by the local email MCP server only. They never leave the machine.

- Use `@local` addresses **only** when they appear verbatim in `CONTRACTS.md`.
- Do **not** construct `@local` addresses by guessing (`human@local`, `agent@local`, etc.).
- If you need to reach someone and only a real SMTP address exists, use `zerolib-email` with that SMTP address.

---

## Maintaining CONTRACTS.md

When a new agent or human joins:

1. Open `CONTRACTS.md`.
2. Add a row to the relevant table (`## Human Contacts` or `## Agent Contacts`).
3. Fill in: name, role, address, channel, and what message types it accepts.
4. Save and commit.

When a contact leaves or an address changes:
- Do **not** delete the row. Update the address and append `[inactive YYYY-MM-DD]` in the Notes column.

---

## Quick reference

```
Need to contact someone?
  → Read CONTRACTS.md
  → Find the address in Human Contacts or Agent Contacts
  → Check Routing Rules for this message type
  → Check Escalation Thresholds if recipient is human
  → Format with the correct subject prefix
  → Send via the MCP tool matching the channel
  → If address is missing → log in TROUBLESHOOTING.md, do NOT guess
```
