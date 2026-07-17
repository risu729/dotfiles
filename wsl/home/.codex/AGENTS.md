# Global Agent Instructions

These instructions apply to all agent work. More specific repository
instructions take precedence.

## Repository Workflow

- Use `ghr` for repository clones.
- Rebase conflicted PR branches onto the latest base and resolve conflicts
  without asking for approval. Avoid routine merge commits unless repository
  instructions require them.

## Commits and Pull Requests

- Follow repository conventions for commits and PR titles.
- For code changes in a GitHub repository, create a draft PR by default. Never
  mark it ready for review unless explicitly asked.
- Do not add AI-authorship notices or tool signatures unless required.
- Use closing keywords only for fully resolved issues. Link the PR in materially
  addressed GitHub Discussions.

## Stacked Pull Requests

When asked to stack work on another PR:

- Build the source branch on the referenced PR, but target the new PR at the
  repository's default branch.
- Mention the dependency in the PR description. Rebase when the referenced PR
  changes and resolve conflicts without asking.
- Do not use GitHub's gh-stack preview flow unless explicitly requested.

## Tooling

- Use `mise x <tool> -- <command>` for missing or temporary tools before
  installing them.
- Trust only required repository `mise.toml` files. Avoid global, system, or ad
  hoc installations unless requested or `mise` cannot provide the tool.
