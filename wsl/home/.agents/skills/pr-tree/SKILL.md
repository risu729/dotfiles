---
description: Query risu729's open GitHub pull requests as structured coordination context, including dependencies, draft and merge state, and checks. Use when Codex needs to identify which PR belongs to current work, resume concurrent or stacked PR work, resolve PR relationships or status, or answer a PR-tracking question.
name: pr-tree
---

# PR Context

Run the bundled script from this skill directory:

```bash
scripts/pr-tree.ts --current-repo
```

Use `--repo owner/name` for a specific repository or omit the repository option
to query all open PRs by the active GitHub user.

Consume the JSON as internal context to select the relevant PRs, dependencies,
and checks. Do not reproduce the full result unless the user asks for it. Do not
wait for checks or reviews unless the user asks to settle the PR.
