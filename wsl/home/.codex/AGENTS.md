# Global Agent Instructions

These instructions apply to all agent work. More specific repository
instructions take precedence.

## Repository Workflow

- Use `ghr` for repository clones.
- Rebase conflicted PR branches onto the latest base and resolve conflicts
  without asking for approval. Avoid routine merge commits unless repository
  instructions require them.

## Commits and Pull Requests

- After making repository changes, always commit and push them. Update an
  existing PR if one exists; otherwise open a PR. Only leave changes local when
  explicitly requested.
- Follow repository conventions for commits and PR titles.
- When the target repository is not owned by the user, create a draft PR by
  default. Never mark it ready for review unless explicitly asked.
- Do not add AI-authorship notices or tool signatures unless required.
- Use closing keywords only for fully resolved issues. Link the PR in materially
  addressed GitHub Discussions.

## Stacked Pull Requests

Before creating a PR, check whether the work conflicts with or depends on one of
the user's open PRs. If one is clearly relevant, create the new branch on top of
that PR automatically. Ask only when multiple source PRs are plausible.

- Mention the source PR in the stacked PR's description, not the reverse.
- Rebase a stacked PR only while actively working on it. After the source PR
  merges, rebase onto the latest target branch when resuming the stacked work.

## Tooling

- Use `mise x` for one-off tools that mise does not already resolve.
