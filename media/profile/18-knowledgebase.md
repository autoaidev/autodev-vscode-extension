## 0.8 Knowledge Base Protocol — `.autodev/knowledgebase/KB-NNN-title.md`

**The knowledge base captures reusable, project-level knowledge** — architectural decisions, domain rules, recurring patterns, integration quirks, gotchas, and any insight that would otherwise live only in someone's head or get re-discovered repeatedly. Unlike issues (which track problems and their resolution), KB entries are **reference material** that outlives any individual task.

A KB entry is written once and updated whenever the knowledge evolves. It is never deleted — it is superseded or marked deprecated with a link to the replacement.

---

### When to Create a KB Entry

Create a new KB entry when any of the following occurs:

- An architectural decision is made that should not be re-litigated.
- A pattern is discovered that applies across more than one part of the codebase.
- An integration quirk, external API behaviour, or environment constraint is confirmed that would surprise a future engineer or agent.
- A recurring question — from a human or agent — is answered definitively.
- A task in `JOURNAL.md` produces a `keep` outcome with transferable insight.
- A `TROUBLESHOOTING.md` entry reveals a class of problem worth preventing proactively.

**Rule:** Do not wait until the end of the session. Write the KB entry as soon as the insight is confirmed.

---

### File Location & Naming

```
.autodev/
  knowledgebase/
    KB-001-auth-token-refresh-flow.md
    KB-002-pagination-strategy.md
    KB-003-env-var-naming-convention.md
    KB-000-local-slug.md          ← unnumbered / local knowledge
```

- **Directory:** `.autodev/knowledgebase/`
- **Format:** `KB-{NUMBER}-{kebab-case-title}.md`
- Number is sequential within the project (check existing files to find the next available number). Use `0` for local insights with no external reference.
- Title is a short kebab-case slug — enough to identify the content at a glance.
- **Never delete** — mark deprecated entries `**Status: Deprecated**` with a `**Superseded by:**` link to the replacement.

---

### Skeleton

Create each KB entry with this skeleton. Fill in what is known. Leave blanks rather than inventing content.

```markdown
# KB-{NUMBER} — {One-line title}

**Status:** Active | Deprecated | Under Review
**Created:** YYYY-MM-DD
**Last updated:** YYYY-MM-DD
**Author:** {agent name or human name}
**Applies to:** {module / service / project-wide}
**Related issues:** {ISSUE-NNN-title — why it relates}
**Related KB:** {KB-NNN-title}

---

## Summary

{One to three sentences. A reader who only reads this should understand the core point.}

---

## Context & Background

{Why this knowledge matters. What problem it solves or what behaviour it explains.}

---

## Detail

{The full explanation — decision rationale, pattern description, gotcha walkthrough, etc.}
{Use sub-headings freely. Include code samples, diagrams, or command snippets as needed.}

---

## Examples

```
{Concrete example — code, config, command, or scenario.}
```

---

## Caveats & Edge Cases

- 
- 

---

## References & Artifacts

<!-- Screenshots, logs, links, ADR docs, external docs, Jira tickets, issue files. -->
<!-- Format: `- [label](path/or/url) — what it shows` -->

-

---

## Change History

<!-- Append-only. One entry per meaningful update. Never edit past entries. -->

### YYYY-MM-DD — Created
{Brief note on what triggered this entry.}
```

---

### Update Rules

| Event | Required update |
|---|---|
| Knowledge evolves or is refined | Add a **Change History** entry; update Detail section in place; update **Last updated** |
| A related issue is opened or closed | Add / update the **Related issues** list in both files |
| A KB entry is superseded | Set **Status: Deprecated**, add `**Superseded by:** [KB-NNN-title](…)` at the top, add Change History entry |
| A task references this KB entry | Add the KB file to **Artifacts** or **Related KB** in the issue file |
| A `TROUBLESHOOTING.md` entry generalises to a pattern | Create a KB entry and cross-link |

---

### Cross-Referencing

- **KB → Issue:** add `[ISSUE-NNN-title](.autodev/issues/ISSUE-NNN-title.md)` to **Related issues**.
- **Issue → KB:** add `[KB-NNN-title](.autodev/knowledgebase/KB-NNN-title.md)` to the issue's **Artifacts** or a dedicated **Related KB** field.
- **KB → KB:** link sibling entries in **Related KB** when two entries are tightly coupled.
- Always update **both** files when adding a cross-reference.

---

### On Session Start — KB Review

After reading `SOUL.md`, `SUMMARY.md`, and scanning open issues, scan `.autodev/knowledgebase/` for entries relevant to the day's tasks. Reading a KB entry before starting related work prevents re-discovering the same insight.

---

### Integration with Other Protocols

| Protocol | How it connects |
|---|---|
| **`.autodev/issues/`** | Issue files reference KB entries that explain relevant decisions or patterns. KB entries reference issues where the knowledge originated. |
| **JOURNAL.md** | A `keep` journal outcome with transferable insight triggers a new KB entry. Cross-link the journal row and KB file. |
| **TROUBLESHOOTING.md** | An error pattern that generalises beyond a single incident triggers a KB entry. Link from the `TROUBLESHOOTING.md` entry to the KB entry. |
| **PROJECT.md** | High-level architectural facts belong in `PROJECT.md`. Deep rationale, patterns, and edge cases belong in the KB. When in doubt: KB. |
| **CHANGELOG.md** | When a task produces a new KB entry, note `KB-NNN created` in the CHANGELOG entry. |

---

### Rules

- **Create before the insight fades** — write the KB entry during the session, not after.
- **One entry per concept** — do not merge unrelated knowledge. Cross-reference instead.
- **Self-contained** — a reader with no prior context must understand the entry from the file alone.
- **Append Change History, update Detail in place** — history is append-only; the body reflects current truth.
- **Artifacts are expected** — include code samples, links, or references. A KB entry with no examples or references is incomplete.
- **Never delete** — deprecate with a forward link. Old entries are historical evidence.
- **Status is always current** — `Active` means the knowledge is valid right now.

