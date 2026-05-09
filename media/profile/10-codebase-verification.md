## 3. Codebase Orientation

Before dispatching any tasks, orient yourself:

```bash
# Visualize structure
tree -L 3 --gitignore

# Find entry points
grep -rn "main\|__main__\|app\(\|listen\|start" --include="*.{js,php,ts,py,go,rs,rb}" . | head -30

# Find config files
find . -name "*.env*" -o -name "*.config.*" -o -name "*.toml" -o -name "*.yaml" -o -name "*.json" | grep -v node_modules | grep -v ".git"

# Find test files
find . -type f | grep -E "(test|spec)\.(js|ts|py|go|rs|rb)" | grep -v node_modules

# Detect browser test suites
find . -name "playwright.config.*" -o -name "cypress.config.*" -o -name "wdio.config.*" | grep -v node_modules

# Find dependency manifests
find . -maxdepth 2 -name "package.json" -o -name "requirements*.txt" -o -name "go.mod" -o -name "Cargo.toml" | grep -v node_modules
```

Record what you find:
- **Entry point(s)** — where execution begins
- **Has browser UI?** — yes/no — this determines whether §4.3 is mandatory
- **Browser test suite?** — Playwright / Cypress / WebdriverIO / other — note the run command
- **Local test suite** — runner and run command
- **Core logic** — the main modules/services/classes
- **Configuration** — env files, config objects, constants

---

## 4. Verification Workflow (Verifier Agent)

Never mark a task complete without **proving** it works. Verification must produce evidence — test output, runtime checks, logs, screenshots, or reproduced before/after behavior — not confidence statements.

When relevant, compare the changed behavior against the previous behavior so the improvement is demonstrated rather than assumed.

Before the final `[x]`, ask: **Would a staff engineer sign off on this change and its verification record?** If not, gather stronger proof.

### 4.1 Local Test Suite (always mandatory)

```bash
# Run with coverage; treat any failure as a blocker
<test-runner> --coverage

# Per-stack commands:
# Node/TypeScript:  npx jest --coverage  |  npx vitest run --coverage
# Python:           pytest --cov=. --cov-report=term-missing
# Go:               go test ./... -v -cover
# Rust:             cargo test
# Ruby:             bundle exec rspec
# PHP:              ./vendor/bin/phpunit --coverage-text
```

A task is **not done** if any test fails. Fix before marking.

### 4.2 Lint, Type-Check, Build (always mandatory)

| Stack | Lint | Type-check | Build |
|---|---|---|---|
| Node/TypeScript | `eslint .` | `tsc --noEmit` | `npm run build` |
| Python | `ruff check .` / `flake8` | `mypy .` | `python -m py_compile **/*.py` |
| Go | `go vet ./...` | (built-in) | `go build ./...` |
| Rust | `cargo clippy -- -D warnings` | (built-in) | `cargo build` |
| Ruby | `rubocop` | `srb tc` | — |
| PHP | `php -l` on each file | `phpstan analyse` | — |

### 4.3 Browser Verification (mandatory if the app has any UI)

**If the project has a browser-based UI, the Verifier Agent MUST use browser automation to verify every task.** Static analysis alone is not sufficient. A task that touches UI code is not verified until a real browser has exercised it.

**Preferred tool:** Playwright MCP. Fall back to Playwright CLI, Laravel Dusk, Cypress, or any available browser control tool that is present.

**Minimum browser verification steps:**

```
1. START the application (dev server or built artifact)
2. OPEN the app in a browser via Playwright MCP or equivalent
3. EXERCISE the golden path for the changed feature:
   - Navigate to the relevant page/view
   - Perform the primary user action (click, fill, submit, etc.)
   - Assert the expected outcome is visible in the DOM/UI
4. CHECK for console errors — zero JS errors on the golden path
5. CHECK for network errors — no failed API calls on the golden path
6. EXERCISE at least one edge case (empty state, error state, boundary input)
7. SPOT-CHECK two unrelated features for regressions:
   - Navigate to them and confirm they still work as expected
8. REPORT: screenshot or assertion log for each step above
```

**Playwright MCP usage pattern:**
```
mcp__playwright__navigate(url)
mcp__playwright__click(selector)
mcp__playwright__fill(selector, value)
mcp__playwright__screenshot()
mcp__playwright__evaluate(expression)   ← check console errors
```

**If Playwright MCP is not available:** use `npx playwright test` CLI, or Cypress (`npx cypress run`), or Laravel Dusk (`php artisan dusk`), or any browser automation tool present in the project, or other available.

**A browser task CANNOT be marked `[x]` until browser verification has passed.**

### 4.4 Browser Test Suite (run if available)

```bash
# Detect and run whatever browser test suite exists:

# Playwright
npx playwright test

# Cypress
npx cypress run

# WebdriverIO
npx wdio run wdio.config.ts

# Puppeteer-based custom suite
node tests/e2e/run.js
```

Run the full browser test suite after every task that touches UI code. A single failure blocks the task.

### 4.5 Security Scan (always run before commit)

```bash
# No secrets staged
git diff --cached | grep -iE "password|secret|api_key|token|private_key|credentials"

# No leftover debug artifacts
grep -rn "console\.log\|debugger\|print(\|var_dump\|binding\.pry\|TODO\|FIXME\|HACK" \
  --include="*.{js,ts,py,rb,go,rs,php}" .
```
