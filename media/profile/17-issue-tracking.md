## 0.7 Issue Tracking Protocol — `.autodev/ISSUE-NNN-ISSUE_TITLE.md`

**Each issue gets its own living document.** When any issue, ticket, bug report, or user story is assigned or referenced, the agent creates `.autodev/ISSUE-NNN-ISSUE_TITLE.md` immediately. This file is the single aligned record of that issue's full life — from first description through every decision, implementation detail, test result, artifact, and final resolution.

It is **never a snapshot**. It grows with the issue. Anyone — human or agent — reading it at any point in time must be able to understand the full context without looking elsewhere.

---

### On Session Start — Check for open issues

After reading `SOUL.md` and `SUMMARY.md`, scan `.autodev/` for any `ISSUE-*.md` files whose status is not `Resolved` or `Closed`. Re-read each one before starting work so context is fully loaded.

---

### When to Create a New Issue File

Create `.autodev/ISSUE-NNN-ISSUE_TITLE.md` the moment any of the following happens:

- A Jira ticket / GitHub issue is assigned or referenced in a task.
- An email arrives describing a bug, feature request, or user story with an issue number.
- The human mentions an issue number explicitly.
- A new problem is identified that will take more than one session to resolve.

If no external issue number exists, use `0` as the number and a descriptive slug title (e.g. `ISSUE-0-login-timeout-bug`) and treat it the same way.

**Create the file before doing any work on the issue.**

---

### File Location & Naming

```
.autodev/
  ISSUE-123-user-login-timeout.md      ← number + kebab-case title
  ISSUE-456-add-pagination-to-list.md
  ISSUE-0-local-login-bug.md           ← local issues without an external number
```

- Format: `ISSUE-{NUMBER}-{kebab-case-title}.md`
- Number is the Jira / GitHub issue number (use `0` if none).
- Title is a short kebab-case slug derived from the issue title — enough to identify it at a glance.
- Never delete an issue file — mark it `Resolved` and leave it as a historical record.

---

### Skeleton

Create the file with this skeleton, then fill in what is known immediately. Unknown fields are left blank — do NOT invent values.

```markdown
# ISSUE-{NUMBER} — {One-line title}

**Status:** Open | In Progress | Blocked | Resolved | Closed
**Created:** YYYY-MM-DD
**Last updated:** YYYY-MM-DD
**Owner:** {agent name or human name}
**Jira / GitHub link:** {URL or blank}

---

## User Story & Goal

> As a {role}, I want {what}, so that {why}.

{Expand with any additional context from the ticket, email, or conversation.}

---

## Acceptance Criteria

- [ ] {criterion 1}
- [ ] {criterion 2}

---

## Related Issues & Context

<!-- Reference other issues that this one depends on, blocks, or is part of. -->
<!-- Format: [ISSUE-NNN-title](.autodev/ISSUE-NNN-title.md) — one-line relationship note -->

- Depends on: —
- Blocks: —
- Part of epic: —

---

## Technical Approach

<!-- Evolving section — update as understanding grows. -->
<!-- Do NOT overwrite old entries; prepend new thinking with a date. -->

### YYYY-MM-DD — Initial approach
{What the plan is, what files are involved, what the proposed solution is.}

---

## Work Log

<!-- Append-only. One entry per session or significant state change. -->
<!-- Format below. Never edit past entries. -->

### YYYY-MM-DD — {Short description of what happened}

- **What was done:** 
- **Findings / decisions:** 
- **Blockers / open questions:** 
- **Next step:** 

---

## Artifacts

<!-- Attach or reference every artifact produced for this issue. -->
<!-- Screenshots, logs, error dumps, test reports, diff snippets, recordings. -->
<!-- Format: `- [artifact name](path/or/url) — what it shows` -->

-

---

## Resolution

<!-- Fill in when the issue is closed. -->

**Resolved on:** YYYY-MM-DD
**Fix summary:** {What was changed and why it solves the problem.}
**Verification:** {How correctness was confirmed — test results, screenshots, Verifier output.}
**Follow-up issues opened:** {ISSUE-NNN-title if any}
```

---

### Update Rules

| Event | Required update |
|---|---|
| Starting work on the issue | Set **Status** to `In Progress`; add a **Work Log** entry |
| New findings or decisions | Prepend a new block to **Technical Approach**; never overwrite |
| Each session that touches the issue | Append a **Work Log** entry with date, findings, next step |
| Artifact produced (screenshot, log, report) | Add to **Artifacts** section immediately |
| Blocker discovered | Set **Status** to `Blocked`; log in Work Log; send notification email per `CONTRACTS.md` |
| Jira/GitHub ticket updated | Update **Last updated** and log the change in Work Log |
| Issue resolved | Fill in **Resolution**; set **Status** to `Resolved`; attach verification artifacts |

**Never edit past Work Log entries.** Append only. The log must reflect the real history.

---

### Cross-Referencing Issues

When one issue depends on, blocks, or relates to another:

1. Add the relationship to the **Related Issues & Context** section of **both** files.
2. Use the format: `[ISSUE-NNN-title](.autodev/ISSUE-NNN-title.md) — {one-line relationship note}`.
3. When the relationship changes (e.g. a blocker is resolved), update both files.

This ensures any agent reading a single issue file can navigate the full user story without external lookups.

---

### Integration with Other Protocols

| Protocol | How it connects |
|---|---|
| **TODO.md** | Task lines may include the issue reference: `- [~] [ISSUE-123-login-timeout] fix: login timeout`. The issue file is the detailed record; `TODO.md` is the status signal. |
| **Jira / `mcp-atlassian`** | After updating a Jira ticket, update the corresponding issue file. After updating the issue file with a resolution, add a Jira comment with a link to the file and attach artifacts. |
| **Email / `zerolib-email`** | When an issue transitions state (blocked, resolved, needs review), email the relevant agent or human per `CONTRACTS.md`. Include the issue file path and key artifacts in the email. |
| **CHANGELOG.md** | When an issue is resolved, add a `CHANGELOG.md` entry that references the issue file. |
| **JOURNAL.md** | Non-trivial experiments or research done for an issue get a `JOURNAL.md` row. Cross-reference the issue file name in the Journal row. |

---

### Rules

- **Create before working** — the issue file exists before any code, comment, or email is written for that issue.
- **One file per issue** — do not merge multiple issues into one file. Cross-reference instead.
- **Append, never overwrite** — Work Log and Artifact entries are permanent. Status and Technical Approach may be updated but prior content must not be deleted.
- **Self-contained** — anyone reading the file alone must understand the full story. Do not rely on Jira, email, or memory to fill in gaps.
- **Artifacts are mandatory** — every resolved issue must have at least one artifact (screenshot, log, test output, or diff) proving the fix works.
- **Related issues are bidirectional** — always update both files when adding a relationship.
- **Status is always current** — an agent reading `Status: Open` means the issue is genuinely open right now.
