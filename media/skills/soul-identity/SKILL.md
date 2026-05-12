# SKILL: Soul Identity — Recognising Yourself and Your Messages

**When to use this skill:** Any time a message arrives (email, Discord, webhook, task dispatch), or when you need to update your identity file, or when you feel uncertain about who you are in this session.

---

## Step 1 — Ground Yourself (Read SOUL.md)

Before processing any incoming message, confirm your identity:

```
1. Read `SOUL.md` in the project root.
2. Note your `## My Identity` → **Name**, **Role**, and **Agent ID**.
3. Note every address listed in `## My Contact Addresses`.
4. You are now grounded — proceed with confidence.
```

If `SOUL.md` is missing, create it from the skeleton in **§0.0** of your AGENT_PROFILE.md before doing anything else.

---

## Step 2 — Verify the Message Was Meant for You

```
Incoming message has:
  - To / recipient field  →  compare against ## My Contact Addresses
  - Subject / topic       →  check ## Communication History

If recipient does NOT match any of my addresses:
  → Do not act. Log in TROUBLESHOOTING.md:
    "Received message not addressed to me: <subject> from <sender>"
    Continue with other tasks.

If recipient MATCHES one of my addresses:
  → Proceed to Step 3.
```

---

## Step 3 — Recognise the Thread

```
Search ## Communication History for a row where:
  - Thread matches the subject/topic, OR
  - Participants includes the sender's address

CASE A — Thread found:
  - You know this person and this conversation.
  - Read the "Summary" column for context.
  - Do NOT re-introduce yourself.
  - Do NOT ask who they are or why they're contacting you.
  - Treat the message as a continuation of an ongoing relationship.

CASE B — Thread not found:
  - This is new. Add a row to ## Communication History:
    | <next #> | <subject> | <sender> | <today> | received | open | <one-line summary> |
  - If the sender is listed in CONTRACTS.md, greet them by name.
  - If the sender is unknown, respond professionally and ask for their role
    only if it is necessary to route or complete the task.
```

---

## Step 4 — Process the Message

Handle the message according to its type:

| Message type | How to handle |
|---|---|
| **Task assignment** (`[task]` prefix) | Add to `TODO.md`, mark `[ ]`, process in normal task loop |
| **Question / needs input** (`[needs input]` prefix) | Answer directly and update `## Communication History` |
| **Status update** (`[status]` prefix) | Acknowledge, update relevant docs (`SUMMARY.md`, `CHANGELOG.md`), no reply needed unless asked |
| **Unknown type** | Treat as informational; log receipt in `TROUBLESHOOTING.md`; no action unless explicit |

---

## Step 5 — Reply (if a reply is warranted)

Before replying, check `CONTRACTS.md` for the sender's preferred reply channel and format.

Reply format:
```
Subject: Re: <original subject>

Hi <Name>,

<Direct answer or action taken — one paragraph maximum>

<If next step is needed: what you will do and by when>

— <My Name> (<My Role>)
```

After sending, update `## Communication History`:
- Change `Direction` to `both` (or `sent` if you initiated)
- Update `Last Date` to today
- Update `Status` (open / closed / waiting)
- Update `Summary` to reflect the latest exchange

---

## Step 6 — Commit SOUL.md

After any update to `SOUL.md`, commit it immediately:

```bash
git add SOUL.md
git commit -m "chore: update SOUL.md communication history [<thread topic>]"
```

Do **not** batch SOUL.md updates across multiple tasks — commit after each one so the file is always in sync with actual history.

---

## Quick Reference

| Situation | Action |
|---|---|
| Received an email I don't recognise | Read SOUL.md → check addresses → check thread history → add new row |
| Agent acts confused about who it is | Read `SOUL.md ## My Identity` — it is authoritative |
| SOUL.md is missing | Create from §0.0 skeleton in AGENT_PROFILE.md |
| New address assigned to me | Add row to `## My Contact Addresses` in SOUL.md; commit |
| Thread no longer active | Mark status `closed` — never delete the row |
| Received message not for me | Do not act; log in TROUBLESHOOTING.md |
