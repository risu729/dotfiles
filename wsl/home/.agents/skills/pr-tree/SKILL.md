---
description: Show risu729's current GitHub pull requests as a dependency tree for one repository or all repositories, with DRAFT, WIP, DIRTY/BLOCKED/UNSTABLE status, failed checks, and blocker notes. Use when the user asks for a PR tree, latest PR statuses, or which PR depends on which other PRs.
name: pr-tree
---

# PR Tree

Use this skill when the user asks for a current PR tree or asks which PRs relate
to or require other PRs.

## Workflow

1. Refresh live GitHub state; do not rely on memory.
2. Run the bundled script from this skill directory:

   ```bash
   scripts/pr-tree.py
   ```

3. By default the script shows all open PRs authored by the active GitHub user.
   To narrow to one repository, pass `--repo owner/name`:

   ```bash
   scripts/pr-tree.py --repo jdx/mise
   ```

4. If the user explicitly says extra PRs are WIP, pass them as overrides:

   ```bash
   scripts/pr-tree.py --repo jdx/mise --wip 9959 --wip jdx/mise#9901
   ```

5. Report the script output directly, wrapped in a single fenced `text` block
   unless the user asks for another format.

## Rules

- Keep merged PRs out of the tree.
- Mark open draft PRs with `DRAFT`.
- Mark active work with `WIP`. The script detects non-detached `tmux` Codex
  sessions and also accepts `--wip <number>` overrides.
- Mark non-clean merge state values such as `DIRTY`, `BLOCKED`, and `UNSTABLE`.
- Include failed and cancelled check names under the affected PR.
- Preserve the note for #9924: its body says to come back after the tool opts
  refactor and other fixes complete.
- Do not settle checks or wait for CI unless the user explicitly asks.
