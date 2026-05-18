---
description: Show risu729's current jdx/mise pull requests as a tree, grouped by dependency area, with DRAFT, WIP, DIRTY/BLOCKED/UNSTABLE status, failed checks, and explicit blocker notes. Use when the user asks for the mise PR tree, latest mise PR statuses, or which mise PR depends on which other PRs.
name: mise-pr-tree
---

# Mise PR Tree

Use this skill when the user asks for the current `jdx/mise` PR tree or asks
which mise PRs relate to or require other PRs.

## Workflow

1. Refresh live GitHub state; do not rely on memory.
2. Run the bundled script:

   ```bash
   /home/risu/.agents/skills/mise-pr-tree/scripts/mise-pr-tree.sh
   ```

3. If the user explicitly says extra PRs are WIP, pass them as overrides:

   ```bash
   /home/risu/.agents/skills/mise-pr-tree/scripts/mise-pr-tree.sh --wip 9959 --wip 9901
   ```

4. Report the script output directly, wrapped in a single fenced `text` block
   unless the user asks for another format.

## Rules

- Keep merged PRs out of the tree by default.
- Mark open draft PRs with `DRAFT`.
- Mark active work with `WIP`. The script detects non-detached `tmux` Codex
  sessions and also accepts `--wip <number>` overrides.
- Mark non-clean merge state values such as `DIRTY`, `BLOCKED`, and `UNSTABLE`.
- Include failed and cancelled check names under the affected PR.
- Preserve the note for #9924: its body says to come back after the tool opts
  refactor and other fixes complete.
- Do not settle checks or wait for CI unless the user explicitly asks.
