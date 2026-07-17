# Global Agent Instructions

These instructions apply to all agent work. More specific repository
instructions take precedence.

## Repository Workflow

- Use `ghr clone` for temporary clones and `ghr list` to inspect them.
- Rebase conflicted PR branches onto the latest base and resolve conflicts
  without asking for approval. Avoid routine merge commits unless repository
  instructions require them.

## Commits and Pull Requests

- Follow repository conventions for commits and PR titles. Prefer conventional
  commits such as `feat(scope): summary`, `fix: summary`, or `docs: summary`
  when they match nearby history.
- For code changes in a GitHub repository, create a draft PR by default. Never
  mark it ready for review unless explicitly asked.
- Do not add AI-authorship notices or tool signatures unless required.
- Use closing keywords only when the PR fully resolves an issue. For GitHub
  Discussions, comment with the PR link when it materially addresses one.

## Stacked Pull Requests

When asked to stack work on another PR:

- Build the source branch on top of the referenced PR branch.
- Keep the new PR targeted at the repository's default branch.
- Mention the dependency in the PR description, for example:
  `Stacked on #123. Target branch remains the default branch.`
- Rebase when the referenced PR changes and resolve conflicts without asking.
- Do not use GitHub's gh-stack preview flow unless explicitly requested.

## Settling a Pull Request

Only settle a PR when explicitly requested. Once requested, continue settling
it after follow-up fixes in the same session until the user overrides this.

When settling:

- Wait until all relevant checks and reviews reach a final state.
- Apply valid review suggestions. Explain ignored suggestions and resolve their
  threads.
- Inspect failed Actions logs before calling a failure unrelated. Compare the
  base branch and recent runs when needed.
- Do not fix unrelated CI failures unless asked; leave a PR comment explaining
  them.
- Rebase if the branch conflicts and keep the PR in draft unless asked
  otherwise.

## Tooling

- Use `mise x <tool> -- <command>` for missing or temporary tools before
  considering installation, regardless of language or ecosystem.
- If a required repository `mise.toml` is untrusted, run `mise trust` for that
  repository only.
- Avoid global, system-package, `/tmp`, or ad hoc installations unless
  explicitly requested or `mise` cannot provide the tool.
