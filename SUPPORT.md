# Support

## Getting Help

- **Bug reports & feature requests:** [Open an issue](https://github.com/autoaidev/autodev-vscode-extension/issues) on GitHub.
- **Questions & discussion:** Use [GitHub Discussions](https://github.com/autoaidev/autodev-vscode-extension/discussions).

## Before Opening an Issue

1. Check the [README](README.md) — most setup questions are answered there.
2. Check [existing issues](https://github.com/autoaidev/autodev-vscode-extension/issues) to see if it's already reported.
3. Include your VS Code version, OS, and the provider you're using (Claude CLI / Copilot CLI / OpenCode).

## Common Issues

| Symptom | Fix |
|---|---|
| Task loop doesn't start | Make sure a `TODO.md` exists with at least one `- [ ] task` |
| OpenCode session not resumed | Check that `Resume session` is enabled in Settings and the project has run at least once |
| MCP servers not appearing | Reload VS Code window — AutoDev writes project MCP configs on activation |
| Settings not saving | Try clicking Save in the Settings tab; the file is written to `.vscode/autodev.json` |
