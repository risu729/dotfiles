# Global Agent Instructions

These instructions apply to all agent work. More specific repository
instructions take precedence.

## Repository Workflow

- Use `ghr` for repository clones.
- Rebase conflicted PR branches onto the latest base and resolve conflicts
  without asking for approval, unless doing so would require a force-push
  prohibited by the review policy below. Avoid routine merge commits unless
  repository instructions require them.

## Commits and Pull Requests

- After making repository changes, always commit and push them. Update an
  existing PR if one exists; otherwise open a PR. Only leave changes local when
  explicitly requested.
- Follow repository conventions for commits and PR titles.
- Write PR titles and descriptions in the language explicitly requested by the
  user. Otherwise, follow the target repository's language conventions, using
  English as the fallback.
- Prefer normal commits and pushes when updating PRs. Do not rewrite history or
  force-push merely to clean up a PR's commit log. Force-push only when
  necessary, such as after a required rebase, and use `--force-with-lease`.
- Before any force-push, check whether the PR has received a human (non-AI)
  review. Once it has, never force-push unless the user explicitly instructs
  you to force-push that PR, even after a required rebase. AI reviews alone do
  not trigger this restriction.
- Do not reply to human PR reviews or review comments, or resolve human review
  threads, unless the user explicitly instructs you to do so. Fixing a review
  finding does not authorize a reply or resolution.
- When the target repository is owned by the user, mark small, low-risk PRs
  ready for review by default. Use a draft for larger, unfinished, or uncertain
  changes.
- When the target repository is not owned by the user, create a draft PR by
  default. Never mark it ready for review unless explicitly asked.
- Do not add AI-authorship notices or tool signatures unless required.
- Use closing keywords only for fully resolved issues. Link the PR in materially
  addressed GitHub Discussions.

## Stacked Pull Requests

Before creating a PR, check whether the work requires specific unmerged
changes from one of the user's open PRs to function correctly.

Automatically stack only when those prerequisite changes can be identified.
Shared files, overlapping edits, merge conflicts, and related subject matter
do not establish a dependency and must not trigger stacking.

Keep independent changes based on the latest target branch and resolve
conflicts without stacking. If no concrete prerequisite can be identified,
do not stack. Ask only when multiple source PRs satisfy this condition.

- Mention the source PR in the stacked PR's description, not the reverse.
- Use GitHub's official `github/gh-stack` extension (`gh stack`) to create and
  manage same-repository PR stacks. Cross-fork stacks are unsupported; use
  ordinary PRs with explicit dependency links for fork-to-upstream work.
- Rebase a stacked PR only while actively working on it. After the source PR
  merges, rebase onto the latest target branch when resuming the stacked work.

## Tooling

- Use `hk` when configured; never invoke linters directly, as `hk` may supply
  custom defaults such as CLI arguments.
- Use `mise x` for one-off tools that mise does not already resolve.
- In Rust projects, plain `cargo` commands run through the `mbx` shared build
  cache via mise's Cargo wrapper, so use them normally. Use `mbx` subcommands
  (`mbx stats`, `mbx explain --last`, `mbx clean`) to inspect the cache and
  manage `target/` directories.
