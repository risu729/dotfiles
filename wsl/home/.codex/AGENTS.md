# Global Agent Instructions

These instructions apply to all agent work. Repository-level instructions take
precedence where they are more specific or conflict with this file.

## Scope and Change Discipline

- Prefer small, focused changes and preserve the repository's existing style.
- Inspect repository instructions and nearby conventions before making
  assumptions.
- Preserve unrelated user changes in a dirty worktree. Do not stage, overwrite,
  or reformat them.
- Do not fix unrelated failures or refactor unrelated code unless explicitly
  asked.
- Report bugs or suspicious behavior noticed during the work, but do not fix
  them unless they are in scope. Include the relevant path and a concise reason.

## Repository and Branch Workflow

- Prefer `gh pr checkout` when checking out an existing pull request.
- Use `ghr clone` for temporary clones and `ghr list` to inspect existing ones.
- Before relying on remote branch state, rebasing, or resolving conflicts, run
  `git fetch --all --prune` or an equivalent command that updates every remote,
  including `origin` and `upstream`.
- If a PR branch conflicts with its base, rebase it onto the latest base and
  resolve the conflicts without asking for approval. Avoid routine merge commits
  unless repository instructions require them.
- Do not force-push unless necessary. Prefer `--force-with-lease` over plain
  `--force`, and do not rewrite published history merely to make it cleaner.

## Commits and Pull Requests

- Follow the repository's commit-title convention for commits and PR titles.
  Prefer conventional commits such as `feat(scope): summary`, `fix: summary`,
  `docs(scope): summary`, or `chore(deps): summary` when they match nearby
  history.
- For code changes in a GitHub-hosted repository, create a draft PR by default,
  even when the user did not explicitly request one.
- Never mark a draft PR ready for review unless explicitly asked.
- Do not add AI-authorship notices, generated-by footers, or tool signatures
  unless repository instructions require them.
- Use `Closes`, `Fixes`, or `Resolves` only when the PR fully resolves an issue.
  For partial work, describe the scope without a closing keyword.
- When a PR materially addresses a GitHub Discussion, leave a comment linking
  the PR; issue-closing keywords do not close Discussions.
- If the relevant PR is unclear, use `$pr-tree` to query live PR context. Treat
  its JSON as internal coordination data and surface only the PRs relevant to
  the task unless the user asks for the full result.

## Stacked Pull Requests

When the user says to "stack on" a PR, "base this on PR #123", or similar:

- Build the new source branch on top of the referenced PR branch.
- Keep the new PR's target branch set to the repository's default branch, not
  the referenced PR branch. This is a local/source-branch stack only.
- Mention the dependency in the PR description, for example:
  `Stacked on #123. Target branch remains the default branch.`
- If the referenced PR changes, rebase the new branch onto its updated branch.
  Resolve resulting conflicts without asking for approval.
- Do not use GitHub's gh-stack preview flow unless explicitly requested.

## Settling a Pull Request

"Settle the PR" means to keep checking it until all relevant CI checks and
AI/code reviews reach a final state. Do this only when explicitly requested.

Once requested, continue settling that PR after follow-up fixes in the same
session until the user explicitly cancels or overrides the instruction.

When settling:

- Wait for every relevant check and review to leave pending, queued,
  in-progress, or waiting states.
- Apply valid review suggestions. For ignored suggestions, reply with a concise
  reason and resolve the thread.
- Inspect failed GitHub Actions logs before deciding a failure is unrelated.
  Compare the base branch and recent runs when needed to verify a systemic
  failure.
- Do not fix unrelated CI failures unless asked. Leave a PR comment explaining
  why the failure appears unrelated.
- Apply the normal rebase rule if the branch becomes conflicted.
- Keep the PR in draft unless explicitly asked to mark it ready.

## Tooling and Dependencies

- Use `mise` for temporary tool execution whenever possible:
  `mise x <tool> -- <command>`.
- If a binary is missing, try `mise x` before installing it. If the repository's
  `mise.toml` is untrusted and needed for the task, run `mise trust` for that
  repository only.
- Avoid global or system-package installation unless explicitly requested. Do
  not install tools into `/tmp` or ad hoc directories unless `mise` cannot
  provide them.
- If `cargo check` cannot find Cargo or another required tool, use
  `mise x cargo -- cargo check`. Do not clear or override wrappers such as
  `RUSTC_WRAPPER`; let `mise` provide the configured environment.
