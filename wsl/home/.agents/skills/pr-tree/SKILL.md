---
description: Inspect risu729's current GitHub pull requests as internal coordination context, including dependencies, DRAFT/WIP/merge status, checks, and blocker notes. Use when Codex needs to disambiguate which PR to track, resumes concurrent or stacked PR work, or the user explicitly asks for a PR tree or status. Consume JSON internally by default; do not show the inventory unless it helps answer the request or the user asks to see it.
name: pr-tree
---

# PR Tree

Use this skill to resolve ambiguity about active PRs and their dependencies.

## Workflow

1. Refresh live GitHub state; do not rely on memory.
2. Run the bundled script from this skill directory. Its default JSON output is
   intended for agent consumption:

   ```bash
   scripts/pr-tree.py
   ```

3. By default the script inspects all open PRs authored by the active GitHub
   user. Narrow the scope when the repository is known:

   ```bash
   scripts/pr-tree.py --current-repo
   ```

   To narrow to one repository, pass `--repo owner/name`:

   ```bash
   scripts/pr-tree.py --repo jdx/mise
   ```

4. If the user explicitly says extra PRs are WIP, pass them as overrides:

   ```bash
   scripts/pr-tree.py --repo jdx/mise --wip 9959 --wip jdx/mise#9901
   ```

5. Use the JSON to select the relevant PRs, dependencies, and checks. Keep the
   inventory internal unless it materially supports the answer.
6. Only when the user explicitly asks to see a tree, use text output:

   ```bash
   scripts/pr-tree.py --format text
   ```

   Present only the requested scope; do not dump unrelated repositories.

## Rules

- Keep merged PRs out of the tree.
- Mark open draft PRs with `DRAFT`.
- Mark active work with `WIP`. The script detects non-detached `tmux` Codex
  sessions and also accepts `--wip <number>` overrides.
- Mark non-clean merge state values such as `DIRTY`, `BLOCKED`, and `UNSTABLE`.
- Include failed and cancelled check names under the affected PR.
- Preserve declared blockers that are not open in the current view; do not
  mistake those PRs for standalone work.
- Preserve the note for #9924: its body says to come back after the tool opts
  refactor and other fixes complete.
- Do not settle checks or wait for CI unless the user explicitly asks.
