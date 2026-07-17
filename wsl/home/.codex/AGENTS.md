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

- Mention the source PR in the stacked PR's description, not the reverse.
- Rebase a stacked PR only while actively working on it. After the referenced PR
  merges, rebase onto the latest default branch when resuming the stacked work.

## Tooling

- Use `mise x <tool> -- <command>` for missing or temporary tools before
  installing them.
- Trust only required repository `mise.toml` files. Avoid global, system, or ad
  hoc installations unless requested or `mise` cannot provide the tool.
