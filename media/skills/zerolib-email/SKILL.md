---
name: zerolib-email
description: >-
  Email communication and task intake protocol using the zerolib-email MCP server.
  Email is the PRIMARY agent-to-agent and agent-to-human communication medium.
  Use this skill whenever receiving task instructions by email, replying to
  stakeholders about blockers, delegating tasks to other agents, or notifying
  any agent of a task update or status change.
  Provides the 5-step deep-analysis intake protocol that prevents skipping
  detail on large tasks and enforces proper decomposition into subtasks.
  Apply even if the task looks simple — small emails often imply large changes.
user-invocable: false
---

## Email protocol (zerolib-email MCP)

> **Email is the primary agent-to-agent communication medium.**
> Jira comments, TODO.md edits, and log entries are NOT notifications — they are records.
> If another agent must act on something, **you must send them an email.** There is no other way to guarantee they are notified.

The `zerolib-email` MCP is connected. Use it to communicate with stakeholders and other agents.

**Reply rules — to avoid email loops:**
- **Do NOT** send a reply just to confirm a task is completed. Mark the TODO item done and move on.
- **Only reply** when you hit a real problem the sender needs to know about: blocker, missing info, ambiguity, failed dependency, permissions issue.
- One reply per problem. Never reply to your own outgoing messages.
- Do not CC, forward, or escalate to anyone the original sender did not include.
- Subject line: prefix problem replies with `[needs input]`. Keep it short.
- Never include credentials, API keys, or secrets in email bodies.
- Every outbound email must include supporting artifacts when relevant: screenshots/images, logs, error traces, reports, repro steps, or diff snippets.
- If a file cannot be attached through the MCP tool, include the exact workspace path and a short note describing why that artifact matters.

**Agent-to-agent notification rules:**
- **Always send an email to notify another agent of a task assignment, task update, or status change** — even if a Jira ticket or TODO.md entry already reflects the update. Those records are visible but not delivered; only email guarantees the agent is notified.
- Look up the recipient agent's address in `CONTRACTS.md`. **Do not invent addresses.**
- Subject prefix for task assignments: `[task]`. Subject prefix for task updates: `[status]`.
- Include in every agent notification: what changed, which ticket/task ID, what the receiving agent is expected to do next, and any relevant artifacts (logs, screenshots, paths).

---

## Task intake from email

When an email arrives that contains a task, request, or instruction, treat it as a first-class work item and follow the full analysis and execution protocol below. **Never skim, summarise and discard, or silently skip detail.**

### Step 1 — Full email read

Read the entire email thread, not just the latest message:
- Read every message in the thread from oldest to newest.
- Note the sender, all recipients, and the date/time of each message.
- Extract every explicit instruction, requirement, acceptance criterion, and constraint.
- Extract every implicit expectation (e.g. tone, urgency, referenced prior work).
- If attachments are present, read or parse them before forming any plan.
- **If the email includes artifacts** (screenshots, logs, error dumps, reports, design files, repro recordings): save them to the workspace before starting work. Reference their paths in your `TODO.md` subtask notes. These artifacts are evidence — use them to narrow the problem and include them in any follow-up replies or agent notifications.

### Step 2 — Task analysis

Before writing a single line of code or updating any file, answer these questions explicitly:

| # | Question | How to answer |
|---|---|---|
| **1** | What is the exact deliverable the sender expects? | Quote the key sentence(s) from the email. |
| **2** | What is the acceptance criterion — how will the sender know it is done? | Derive from the email; if absent, state your assumption. |
| **3** | What files, systems, or services are involved? | Grep/search the codebase; do not guess. |
| **4** | Are there dependencies or blockers that must be resolved first? | List them. If any are unresolvable, reply with `[needs input]` before proceeding. |
| **5** | Is this a single atomic task or does it decompose? | Apply the decomposition rule below. |

### Step 3 — Decomposition rule

**Do not skip detail by collapsing multi-part work into one vague task.**

If the email task meets any of the following criteria, it **must** be broken into subtasks before any work begins:
- It touches more than 3 files with non-trivial changes.
- It involves more than 2 distinct concerns (e.g. backend + frontend + config).
- It requires more than one type of agent (implementation + testing + review).
- It would take more than one "implement + verify" cycle to complete safely.

**How to decompose:**
1. Write the parent task into `TODO.md` as `- [ ] <email subject / summary>`.
2. Under it, write every subtask as `- [ ] sub: <specific action>` (never omit the `[ ]` tag).
3. Add a `- [ ] sub: explore — read all files the task will touch` subtask **first** if more than one module is involved.
4. Include a `- [ ] sub: verify — run tests and verification checklist` subtask **last**.
5. Start no subtask until the decomposition is fully written and saved.

Example:
```markdown
- [~] feat: add pagination to the orders API (from email: alice@example.com 2026-05-08)
  - [x] sub: explore — read orders controller, serialiser, and route tests
  - [~] sub: implement page/limit query params in OrdersController
  - [ ] sub: update serialiser to include pagination metadata
  - [ ] sub: add/update integration tests for paginated response
  - [ ] sub: verify — run full test suite; confirm acceptance criteria
```

### Step 4 — Subagent delegation

For each subtask, dispatch to the correct subagent — do not implement everything in a single monolithic pass:

| Subtask type | Agent |
|---|---|
| Explore / read / research | Orchestrator reads directly |
| Implementation (code change) | Code Agent |
| Tests / QA | QA Agent |
| Verification / diff review | Verifier Agent |
| Multi-file refactor | Code Agent, one file at a time |

- Run subtasks **sequentially** — do not start the next until the current is `[x]`.
- The parent task is marked `[x]` only when **every** subtask is `[x]`.
- If a subtask reveals new sub-subtasks, add them to `TODO.md` before starting them.
- **Attach artifacts to the task as evidence.** If the task produced or consumed any artifact (screenshot, log file, test report, diff, recording), attach it to the reply email or include the exact workspace path. If a Jira ticket is linked, also attach or reference the artifact there. The goal: anyone picking up the task thread from the email alone must find the evidence without hunting for it.

### Step 5 — Never truncate or shortcut

- **Do not summarise away detail.** If the email lists 10 requirements, all 10 must appear as tracked subtasks or explicit acceptance criteria.
- **Do not assume small means simple.** A one-line email request can imply significant changes — always explore before estimating.
- **Do not mark the parent task done while any subtask is open.** The email sender's expectation is only met when every subtask is `[x]` and verification passes.
- **Do not send context-free problem emails.** Attach or reference concrete artifacts so another agent can quickly narrow and solve the problem.
- **Do not complete a task without attaching its evidence.** Every finished task must have at least one attached or path-referenced artifact proving the result is correct. If nothing was produced, state explicitly why no artifact exists.
