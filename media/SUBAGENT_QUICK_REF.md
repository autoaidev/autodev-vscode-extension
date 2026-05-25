# 🚨 SUBAGENT ORCHESTRATION QUICK REFERENCE

## ⚡ When to Spawn a Subagent

### ✅ SPAWN SUBAGENT FOR:
- **File editing / implementation** → Code Agent
- **Writing new test files** → QA Agent  
- **Code review of diffs** → Reviewer Agent
- **Architectural design** → Architect Agent
- **Context handoff** (your context unwieldy + decisions made)

### ❌ NEVER SPAWN SUBAGENT FOR:
- Running tests (`npm test`, `pytest`, `cargo test`) → **YOU DO THIS**
- Running linters (`eslint`, `ruff`, `mypy`) → **YOU DO THIS**
- Running builds (`npm run build`, `cargo build`) → **YOU DO THIS**
- Reading files or parsing output → **YOU DO THIS**
- Searching codebase → **YOU DO THIS**
- Analyzing test output → **YOU DO THIS**
- Deciding what to do next → **YOU DECIDE FIRST**
- "Compacting YOUR context" → **INFINITE LOOP!**

---

## 🎯 Context Management

### Create CONTEXT.md When:
- Task has 3+ major steps
- Task touches 5+ files
- You anticipate needing subagents
- Task will take 20+ exchanges

### Update CONTEXT.md After:
- Making a key decision
- Spawning a subagent
- Completing a major subtask
- Discovering a blocker

### Check CONTEXT.md:
- Before picking next subtask
- When feeling lost
- After subagent returns
- Before marking task [x]

---

## 📝 Subagent Brief Checklist

Before spawning, your brief MUST include:

- [ ] **MISSION:** One-sentence goal
- [ ] **CONTEXT:** Relevant background (not entire history)
- [ ] **APPROACH:** Exact approach to use (you decided this)
- [ ] **FILES TO EDIT:** Specific file paths
- [ ] **PATTERNS:** Which existing patterns to follow
- [ ] **DO / DON'T:** Clear guidelines
- [ ] **DONE CRITERIA:** How to know it's complete

**If you can't fill all these in → You're not ready to spawn yet. Decide first.**

---

## 🔄 Context Handoff Protocol

### BEFORE Spawning:
1. Update CONTEXT.md (decisions, files, status)
2. Decide EXACT next action
3. Write detailed brief (use template)
4. Spawn with scoped task

### AFTER Subagent Returns:
1. Update CONTEXT.md (what was completed)
2. YOU verify (run tests, check diffs)
3. Continue to next step OR mark [x]

---

## ⚠️ Anti-Patterns (NEVER DO THESE)

| ❌ WRONG | ✅ RIGHT |
|----------|----------|
| "My context is full, spawn subagent to continue" | YOU manage context, update CONTEXT.md, THEN spawn with scoped task |
| "Spawn subagent to figure out what to do" | YOU decide what to do, THEN spawn with specific task |
| "Spawn subagent to run `npm test`" | YOU run `npm test` directly |
| "Implement the auth feature. Figure out best approach." | YOU decide approach (JWT+Redis), THEN spawn with "implement login.ts using JWT pattern from src/auth/utils.ts" |

---

## 🎯 Context Checkpoints

Ask yourself these 4 questions regularly:

1. **Can you state the main goal in one sentence?**  
   → No? Re-read CONTEXT.md Main Task section

2. **Do you know the next concrete action?**  
   → No? Review CONTEXT.md Progress Tracker

3. **Have you strayed into unrelated work?**  
   → Yes? Refocus on main goal

4. **Is there a clearer path than current approach?**  
   → Yes? Update CONTEXT.md Decisions section

---

## 📚 Full References

- **Decision tree & workflow:** `media/profile/19-subagent-context-management.md`
- **CONTEXT.md template:** `media/templates/CONTEXT.md.template`
- **Core loop integration:** `media/skills/autodev-core-loop/SKILL.md`
- **Core rules:** `media/profile/06-core-rules.md` §1.3.3

---

## 💡 Remember

**YOU are the orchestrator. YOU make decisions. YOU run verification.**

**Subagents execute your decisions. They don't decide FOR you.**

**CONTEXT.md prevents losing track. Update it often.**

**If unsure whether to spawn → probably don't. Do it yourself first.**

