---
name: mcp-atlassian
description: >-
  Jira ticket intake and comment protocol using the mcp-atlassian MCP server.
  Use this skill whenever a Jira ticket is assigned or linked to current work,
  when adding comments to tickets, or when transitioning ticket status.
  Provides the 5-step deep-analysis intake protocol that prevents skipping
  acceptance criteria and enforces proper subtask decomposition before coding.
  Apply even for simple-looking tickets — a one-line ticket often implies
  significant cross-cutting changes.
user-invocable: false
---

## Jira protocol (mcp-atlassian MCP)

The `mcp-atlassian` MCP is connected. Use it to read and update Jira tickets tied to your tasks.

**Comment rules — to avoid notification loops:**
- **Do NOT** comment just to say a ticket is done. Transition status (`In Progress` → `Done`) and move on.
- **Only comment** when you hit a real problem reviewers need to see: blocker, decision required, scope change, failed acceptance criteria.
- One comment per problem. Never reply to your own previous comments.
- Do not @-mention anyone who isn't already a watcher / assignee / reporter.
- Never include credentials or secrets in comments or descriptions.

---

## Task intake from Jira tickets

When a Jira ticket is assigned or linked to your current work, treat it as a first-class work item and follow the full analysis and execution protocol below. **Never skim, summarise and discard, or silently skip detail.**

### Step 1 — Full ticket read

Read the entire ticket before forming any plan:
- Read the title, description, acceptance criteria, and all comments from oldest to newest.
- Read any linked tickets, attachments, or referenced documents.
- Note the ticket type (Story, Bug, Task, Sub-task), priority, assignee, and reporter.
- Extract every explicit requirement, constraint, and definition of done.

### Step 2 — Task analysis

Before writing a single line of code or updating any file, answer these questions explicitly:

| # | Question | How to answer |
|---|---|---|
| **1** | What is the exact deliverable the ticket describes? | Quote the acceptance criteria or description. |
| **2** | What is the definition of done? | Use the ticket's AC; if absent, state your assumption. |
| **3** | What files, systems, or services are involved? | Grep/search the codebase; do not guess. |
| **4** | Are there blockers or dependencies? | Check linked tickets; if unresolvable, add a comment with `[blocker]` before proceeding. |
| **5** | Is this a single atomic task or does it decompose? | Apply the decomposition rule below. |

### Step 3 — Decomposition rule

**Do not collapse multi-part ticket work into one vague task.**

If the ticket meets any of the following criteria, break it into subtasks before any work begins:
- It touches more than 3 files with non-trivial changes.
- It involves more than 2 distinct concerns (e.g. backend + frontend + config).
- It requires more than one type of agent (implementation + testing + review).
- It would take more than one "implement + verify" cycle to complete safely.

**How to decompose:**
1. Write the parent task into `TODO.md` as `- [ ] <ticket-id>: <ticket summary>`.
2. Under it, write every subtask as `- [ ] sub: <specific action>` (never omit the `[ ]` tag).
3. Add `- [ ] sub: explore — read all files the task will touch` **first** if more than one module is involved.
4. Include `- [ ] sub: verify — run tests and verification checklist` **last**.
5. Start no subtask until the decomposition is fully written and saved.

### Step 4 — Subagent delegation

For each subtask, dispatch to the correct subagent:

| Subtask type | Agent |
|---|---|
| Explore / read / research | Orchestrator reads directly |
| Implementation (code change) | Code Agent |
| Tests / QA | QA Agent |
| Verification / diff review | Verifier Agent |

- Run subtasks **sequentially** — do not start the next until the current is `[x]`.
- The parent task is marked `[x]` only when **every** subtask is `[x]`.
- Transition the Jira ticket to `In Progress` when the first subtask starts; transition to `Done` only when all subtasks are `[x]` and verification passes.

### Step 5 — Never truncate or shortcut

- **Do not summarise away detail.** If the ticket has 10 acceptance criteria, all 10 must be tracked as subtasks or explicit verification checks.
- **Do not assume small means simple.** A one-line ticket can imply significant changes — always explore before proceeding.
- **Do not mark the parent task done while any subtask is open.**
