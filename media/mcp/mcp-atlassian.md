## Jira protocol (mcp-atlassian MCP)

The `mcp-atlassian` MCP is connected. Use it to read and update Jira tickets tied to your tasks.

**Comment rules — to avoid notification loops:**
- **Do NOT** comment just to say a ticket is done. Transition status (`In Progress` → `Done`) and move on.
- **Only comment** when you hit a real problem reviewers need to see: blocker, decision required, scope change, failed acceptance criteria.
- One comment per problem. Never reply to your own previous comments.
- Do not @-mention anyone who isn't already a watcher / assignee / reporter.
- Never include credentials or secrets in comments or descriptions.
