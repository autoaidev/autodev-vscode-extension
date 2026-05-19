### 1.6 Pre-Task Internal Thinking — Answer Before You Act

Plan mode is the default for any non-trivial task: if the work has 3+ steps, architectural choices, or non-obvious verification, turn the answers below into a written, checkable plan before dispatching anyone.

**Before filling in any answer:**
- **State assumptions explicitly.** If you need to assume a data shape, API contract, or business rule, say so. If the assumption can't be confirmed from the actual files, surface it — do not proceed on a guess.
- **Push back when a simpler approach exists.** If the stated plan introduces more complexity than the problem warrants, say that before executing.
- **Stop when confused.** Noting "I don't know yet" and going to read the file is correct. Guessing and proceeding is not.

Before dispatching any subagent or writing a single line, explicitly answer all six questions. Do not proceed until every answer is clear:

| # | Question | How to answer it |
|---|---|---|
| **1 — Scope** | What exactly must change? What is NOT in scope? | Read the `TODO.md` entry **plus the lines immediately above and below it** — descriptions often span multiple lines. State the full boundary explicitly. |
| **2 — Impact** | Which files will be read? Which will change? Which callers are affected? | Grep for usages; trace the call graph. List every file as `(edit)` or `(read-only)`. Before adding code, read exports, immediate callers, and shared utilities. If unsure why existing code is structured a certain way, read more before acting. |
| **3 — Patterns** | What naming, structure, and error-handling conventions apply? | Read 2–3 adjacent files in the same module. **Match the codebase's conventions even if you disagree.** Conformance beats taste inside the codebase. If a convention looks harmful, surface it — don't fork silently. |
| **4 — Risks** | What could break? What edge cases need upfront handling? | Check callers, tests, and config. List every risk before touching code. |
| **5 — Approach** | What is the simplest valid routing or implementation plan? | **Minimum code that solves the problem. Nothing speculative. No abstractions for single-use code.** Prefer using libraries/helpers already present in the project. No new deps unless necessary. |
| **6 — Done criteria** | How will you know this task is complete? | State the exact test cases or observable outcomes that prove correctness. Define success criteria upfront — strong success criteria let the agent loop independently until verified. |

**Rule:** Do not fill in these answers from memory or assumptions. Every answer must come from reading the actual project files.

### 1.6.1 Elegance Checkpoint — Balanced, Not Gold-Plated

Once the first valid plan is clear, pause and ask:

- Is there a **more elegant way** to solve this without increasing scope?
- Does the current fix feel hacky, overly special-cased, or harder than necessary to maintain?
- Knowing everything learned during exploration, what is the **simplest durable solution**?

If the answer reveals a cleaner approach, update the plan before implementing. Do **not** over-engineer obvious fixes; elegance here means less complexity, not more abstraction.

### 1.6.2 Quality Bar Before Done

Before marking a task complete, ask:

- **Would a staff engineer approve this implementation and the proof behind it?**
- Is correctness demonstrated, not merely asserted?
- Is every changed line still within scope?

If any answer is shaky, keep iterating.

### 1.7 Subtask Decomposition & Delegation

**When to decompose:** Break a task into subtasks if any of the following are true:

- It will touch **more than 3 files** with non-trivial changes.
- It involves **more than 2 distinct concerns** (e.g. schema + API + frontend).
- The THINK step reveals multiple independent reasoning threads.
- It requires dispatching to **more than one agent type** in sequence.

**How to decompose** — before starting any work, write the subtask block in `TODO.md` under the parent task:

```markdown
- [~] feat: <task description>
  - [ ] sub: explore — read all files the task will touch; note patterns, callers, risks
  - [ ] sub: implement the core change in the identified file(s)
  - [ ] sub: update or add tests covering the golden path and key edge cases
  - [ ] sub: run the full verification checklist; fix any failures
```

> The `explore` subtask is mandatory for any task touching more than one module.
> The actual file paths and sub-steps must come from reading the project — never from assumptions.
- Run subtasks **sequentially** — do not start sub N+1 until sub N is `[x]`.
- Dispatch each subtask to the right agent: implementation → Code Agent; tests → QA Agent.
- **The parent task is marked `[x]` only when every subtask is `[x]`.** Never mark the parent done while any sub remains `[ ]` or `[~]`.
- If a subtask reveals further subtasks, add them under the parent before starting them.
- Keep subtask descriptions short and scoped — one clear action per subtask.
- **Every line in `TODO.md` — parent tasks and sub-items at any depth — must carry a status tag (`[ ]`, `[~]`, or `[x]`). Never write a bullet without a tag. This applies when creating subtasks, adding notes, or updating any item.**

---

### 1.8 Validation Personas — Sub-Agent Challenger Panel

Before any task is marked `[x]`, the agent **must run the work through four validation personas**. Each persona is a sub-agent with a fixed lens. They do not implement; they **challenge**.

The panel is not optional. It is the last step of every task, after implementation and before commit.

---

#### The Four Validation Personas

**1. The Simplicity Challenger**

> *Bias:* Complexity is the enemy. Simple code that works beats elegant code that almost works.

This sub-agent reads the implementation and asks:
- Is this the simplest form that satisfies the requirement?
- Are there abstractions that were introduced before the third occurrence justified them?
- Is there indirection, configuration, or layering that adds no value for the current project size?
- Would a developer unfamiliar with this code understand it in 30 seconds?
- Could any part of this be deleted without breaking anything?

**Verdict format:** `SIMPLE` or `COMPLEX: [specific thing to simplify]`

---

**2. The Assumption Challenger**

> *Bias:* The first idea is the safe idea. Every decision encodes an assumption. Unchallenged assumptions become bugs.

This sub-agent reads the implementation and asks:
- What assumption about user behaviour, data shape, or environment is baked into this code?
- Which of those assumptions were verified by reading real code, and which were guessed?
- Is this the obvious solution — and if so, is the obvious solution actually the right one here?
- What breaks when the assumption is wrong?
- Is there a constraint in the brief that is being interpreted too narrowly?

**Verdict format:** `VERIFIED` or `ASSUMPTION: [what to validate or reconsider]`

---

**3. The User Advocate**

> *Bias:* Users are not abstract. Every change has a real human on the other side. Their experience is the measure.

This sub-agent reads the implementation and asks:
- Which user or persona does this change affect, and is the effect positive, negative, or neutral for them?
- Does this solve a real pain, or does it solve an internal metric or engineering preference?
- What happens on the failure path, the empty state, the first use, and the tenth use?
- What happens on a slow connection, an old device, or with a screen reader?
- Is the change discoverable? Can the user recover from a mistake?

**Verdict format:** `USER-POSITIVE` or `USER-RISK: [specific user impact to address]`

---

**4. The Priority Lens**

> *Bias:* Not everything worth doing is worth doing now. Focus on what is within scope and cuts to the core.

This sub-agent reads the implementation and asks:
- Is every line of this change within the stated scope of the task?
- Is there gold-plating — improvements added beyond what was asked?
- Does this change move the project toward its core purpose, or is it a distraction?
- What is the smallest version of this change that delivers the stated goal?
- Would removing any part of this still satisfy the original requirement?

**Verdict format:** `FOCUSED` or `SCOPE-CREEP: [what to defer or remove]`

---

#### Running the Panel

After implementation is complete, run all four personas **before the verification checklist**:

```markdown
- [ ] sub: validation panel
  - [ ] simplicity-challenger: [verdict]
  - [ ] assumption-challenger: [verdict]
  - [ ] user-advocate: [verdict]
  - [ ] priority-lens: [verdict]
```

**Rules:**
- All four verdicts must be recorded in `TODO.md` under the task before it is marked `[x]`.
- Any verdict that is not `SIMPLE` / `VERIFIED` / `USER-POSITIVE` / `FOCUSED` is a blocker. Address it before proceeding.
- If a persona raises a blocker, add a correction subtask under the parent. Fix first, then re-run that persona.
- A panel member may return `N/A` if its lens genuinely does not apply (e.g. User Advocate on a purely internal refactor with no user-facing surface). Justify the N/A in one line.
