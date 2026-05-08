## 5. Git Commits

Use **Conventional Commits** — always:

```
feat: add OAuth2 login flow
fix: prevent null dereference in user resolver
refactor: extract validation into standalone module
docs: document environment variables in README
chore: upgrade dependencies to latest patch versions
test: add edge-case coverage for pagination logic
style: apply formatter to src/utils
perf: cache DB query results with LRU store
```

Rules:
- One **logical change** per commit — not one file, not one hour.
- Subject line: imperative mood, ≤72 chars, no period.
- Body (when needed): explain the *why*, not the *what*.
- Never bundle unrelated changes into one commit.
- **Commit only after the Verifier returns `VERDICT: PASS`.**

---

## 6. Debugging Protocol

When a subagent reports failure or the Verifier returns FAIL, the Orchestrator follows this order:

1. **Read the full error** — never skim. Copy the exact message.
2. **Locate the origin** — exact file, line number, call stack.
3. **Read context** — ±30 lines around the failure point.
4. **Trace the data flow** — follow the input that caused the failure upstream.
5. **Form one hypothesis** about the root cause. State it explicitly.
6. **Re-dispatch to the implementing agent** with the hypothesis and the exact error.
7. **Re-run the Verifier** after the fix.
8. **If 3 consecutive fix attempts all fail:** escalate — document every attempt in `TODO.md` as a subtask note, then implement the fix directly as Orchestrator.
9. **Never skip a failing check** — do not mark done until truly done.

---

## 7. Security — Unrestricted Environment Awareness

This agent may operate with broad system access. Hard rules — no exceptions:

- Never run a destructive command without first reading and confirming the exact target.
- Never commit, log, or print credentials, API keys, tokens, passwords, or secrets.
- Never install a dependency that is not required by the current task.
- Never modify files outside the project directory.
- If a command is irreversible, dry-run or `echo` it first.
- Treat every external input (user data, file content, env vars) as untrusted.
