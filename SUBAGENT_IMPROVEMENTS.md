# Subagent Orchestration & Context Management Improvements

## Summary

This update significantly enhances the subagent orchestration logic and adds comprehensive context management to prevent the orchestrator from losing track of the main task when dealing with deep, complex work.

## What Was Added

### 1. Comprehensive Subagent Context Management Guide
**File:** `media/profile/19-subagent-context-management.md`

This new profile section provides:

#### A. Decision Tree for When to Spawn Subagents
- Clear flow chart showing when to use subagents vs. doing work directly
- Explicitly covers all edge cases (shell commands, file reading, decisions, context management)
- Maps task types to specific agents (Code, QA, Reviewer, Architect)

#### B. Context Handoff Protocol
- Signs you NEED a context handoff (20+ exchanges, going in circles, context full of irrelevant exploration)
- Signs you DON'T need one (simple tasks, haven't decided approach yet, just need to run tests)
- Step-by-step procedure: Update CONTEXT.md → Decide exact action → Write detailed brief → Spawn subagent

#### C. CONTEXT.md Template and Usage
- Structured template for tracking:
  - Main task goal (one sentence)
  - Key decisions made (with reasoning and alternatives)
  - Architecture/approach and files involved
  - Progress tracker (completed/in-progress/remaining)
  - Subagent spawn log (when, what, result, verified)
  - Blockers and issues
  - Context checkpoints (4 questions to verify still on track)
  - Notes and learnings

#### D. Detailed Subagent Briefing Template
When spawning a subagent for complex work, the brief must include:
- **MISSION:** One-sentence goal
- **CONTEXT:** Relevant context only (not entire history)
- **WHAT TO IMPLEMENT:** Specific approach, files to edit, patterns to follow
- **DO / DON'T:** Clear guidelines
- **DONE CRITERIA:** Specific completion criteria
- **AFTER YOU'RE DONE:** What to return (files changed, summary, issues)

#### E. Anti-Patterns Section
Explicitly shows WRONG vs. RIGHT examples:
- ❌ Spawning subagent to compact context → ✅ You manage context yourself
- ❌ Spawning subagent to decide next step → ✅ You decide, then spawn with specific task
- ❌ Spawning subagent to run tests → ✅ You run tests directly
- ❌ Vague brief "implement feature X" → ✅ Detailed brief with files, approach, patterns

#### F. Complete Workflow Diagram
Shows the full workflow for managing context in complex tasks:
1. Create CONTEXT.md
2. Research & decide
3. Break down into subtasks
4. For each subtask: Check if can do directly → Write brief → Spawn → Update CONTEXT.md → Verify → Update tracker
5. Checkpoint: Review CONTEXT.md
6. Complete: Mark [x] → Archive CONTEXT.md → Commit

#### G. Quick Reference Table
Maps every task type to who does it (YOU vs. which agent) with notes

### 2. CONTEXT.md Template File
**File:** `media/templates/CONTEXT.md.template`

Ready-to-use template that agents can copy when starting complex multi-step tasks. Contains all sections with inline instructions.

### 3. Updated Profile Builder
**File:** `src/profileBuilder.ts`

Added the new section to the profile builder array with key rules:
- Create CONTEXT.md for complex multi-step tasks
- Subagents NEVER for: running tests/lints/builds, reading files, deciding what to do, or "compacting YOUR context"
- Before spawning subagent: decide approach, write detailed brief

### 4. Updated Core Rules
**File:** `media/profile/06-core-rules.md`

Enhanced section 1.3.3 to reference the new guide:
- Added note about creating CONTEXT.md for complex multi-step tasks
- Added reference to §1.9 for full decision tree, briefing template, and workflow

### 5. Updated Core Loop Skill
**File:** `media/skills/autodev-core-loop/SKILL.md`

Enhanced in two places:
- **Step 4 (THINK & PLAN):** Added reminder to create CONTEXT.md for context-heavy multi-step tasks
- **Subagent Usage Section:** Added prominent reference to §1.9 for detailed guidance

## Key Improvements

### 1. Prevents Context Loss
- CONTEXT.md provides a persistent record of main goal, decisions, and progress
- Context checkpoints help orchestrator verify they're still on track
- Explicit workflow prevents "getting lost in deep subtasks"

### 2. Ensures Detailed Subagent Briefs
- Template ensures all critical information is included
- Forces orchestrator to decide approach BEFORE spawning subagent
- Specifies exact files, patterns, done criteria
- Prevents vague briefs like "implement feature X"

### 3. Clear Subagent Spawning Criteria
- Decision tree covers all cases
- Explicitly lists what subagents are NEVER for:
  - Running tests, lints, builds
  - Reading/parsing files
  - Making decisions
  - Managing YOUR context (infinite loop!)
- Maps task types to specific agent types

### 4. Anti-Pattern Protection
- Explicit WRONG vs. RIGHT examples
- Explains WHY each anti-pattern is wrong
- Prevents common mistakes (spawning subagent to compact context, run tests, etc.)

### 5. Integration with Existing System
- References fit naturally into existing skill system
- Works with TODO.md workflow
- Integrates with core loop at appropriate steps
- Doesn't override existing rules, just enhances them

## Usage for Orchestrator

### When to Create CONTEXT.md
Create it when:
- Task has 3+ major steps
- Task touches 5+ files
- Task requires complex decision-making
- You anticipate needing subagents
- Task will take 20+ exchanges

### When to Update CONTEXT.md
Update after:
- Making a key decision
- Spawning a subagent
- Completing a major subtask
- Discovering a blocker
- Shifting approach

### When to Check CONTEXT.md
Check it:
- Before picking next subtask
- When feeling lost or uncertain
- After receiving subagent result
- Before marking main task [x]
- If going in circles

### When to Spawn Subagent
Only when:
- Task is implementation (file editing)
- Task is writing new tests
- Task is code review
- Task is architectural design
- Your context is unwieldy AND you've decided the approach

Never when:
- Task is running a shell command
- Task is reading/parsing files
- Task is making a decision
- Task is "managing your context"
- You haven't decided the approach yet

## File Structure

```
media/
├── profile/
│   ├── 00-identity.md
│   ├── ...
│   ├── 18-knowledgebase.md
│   └── 19-subagent-context-management.md  ← NEW
├── templates/
│   └── CONTEXT.md.template  ← NEW
└── skills/
    └── autodev-core-loop/
        └── SKILL.md  ← UPDATED

src/
└── profileBuilder.ts  ← UPDATED
```

## Next Steps

1. **Test the new guidance:** Create a complex multi-step task and verify CONTEXT.md helps maintain focus
2. **Refine templates:** Based on real usage, adjust the CONTEXT.md and briefing templates
3. **Add examples:** Consider adding example CONTEXT.md files from real tasks
4. **Monitor effectiveness:** Track whether context loss incidents decrease

## Benefits

✅ **Prevents context loss** during deep multi-step tasks  
✅ **Ensures detailed briefs** so subagents have proper context  
✅ **Clear spawning criteria** prevent misuse of subagents  
✅ **Anti-patterns document** prevents common mistakes  
✅ **Integrated workflow** fits naturally into existing system  
✅ **Template-driven** makes it easy to do the right thing  
✅ **Checkpoint system** helps orchestrator stay on track  

## Key Principles Reinforced

1. **YOU manage YOUR context** — subagents don't compact your context (they compact theirs = infinite loop)
2. **YOU make decisions** — subagents execute scoped tasks
3. **YOU run tests/lints/builds** — subagents edit files
4. **Decide → Brief → Spawn** — never spawn before deciding approach
5. **Track main goal** — CONTEXT.md prevents getting lost in subtasks

