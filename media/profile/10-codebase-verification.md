## 3. Codebase Orientation

Before dispatching, record: entry point(s) · browser UI? (→§4.3 mandatory) · browser test suite (runner+cmd) · local test suite (runner+cmd) · core logic modules · config files.

## 4. Verification Workflow

Proof over confidence. Evidence = test output, logs, screenshots. *Would a staff engineer sign off?*

**4.1 Local tests (always):** run with coverage; any failure = blocker.
*(Node: `npx jest --coverage` · Python: `pytest --cov=.` · Go: `go test ./... -v -cover` · Rust: `cargo test`)*

**4.2 Lint + type-check + build (always):**
*(Node: `eslint . && tsc --noEmit && npm run build` · Python: `ruff check . && mypy .` · Go: `go vet ./... && go build ./...`)*

**4.3 Browser (mandatory if any UI):** Playwright MCP preferred. Start app → navigate → golden path → assert → 0 JS errors → 0 network errors → 1 edge case → spot-check 2 unrelated features. **Cannot mark `[x]` until browser passes.**

**4.4 Browser test suite (if available):** `npx playwright test` / `npx cypress run`. Single failure blocks.

**4.5 Security (always before commit):** No secrets in staged diff. No debug artifacts (`console.log`, `debugger`, `TODO`, `FIXME`).