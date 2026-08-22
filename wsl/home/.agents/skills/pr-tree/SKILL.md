---
description: Query the active GitHub user's open pull requests as a stacked
  dependency tree, joined with the live coding agents working on them. Use when
  identifying which PR belongs to current work, resuming concurrent or stacked
  PR work, resolving PR relationships or status, or answering a PR-tracking
  question.
name: pr-tree
---

# PR Tree

The bundled script emits parseable data only. It resolves stacks from git
ancestry, never from prose. Read the PR bodies yourself for declared stacks,
then render the tree.

## Collecting the Data

Run the bundled script with the tracked repository as the working directory,
so git can resolve ancestry:

```bash
scripts/pr-tree.ts --current-repo
```

- `--repo owner/name` targets one repository; repeat for several.
- Omit both to query every open PR authored by the active GitHub user.
- `--no-agents` skips the local agent lookup.

Check `git.heads_resolved` against `git.heads_total`. When they differ, the
local clone is missing head commits, so run `git fetch` and try again before
trusting the edges. Agent data comes from `herdr`; when it is absent or fails,
`agents` is empty and the PR half still works.

## What the Output Contains

`pull_requests[]` — one entry per open PR, with `id` as `owner/repo#number`:

- `parent` — the nearest PR whose head commit this branch contains.
- `children` — the PRs whose `parent` is this one.
- `ancestors` — every PR head contained in this branch, not just the nearest.
- `state`, `draft`, `title`, `url`, `updated_at`, `head_ref`, `head_repo`,
  `head_sha`, `base_ref`.
- `conflict` — merge conflict against the base branch. Open PRs only.
- `ci` — `state` (`passing`, `failing`, `pending`, `none`) plus the `failing`
  and `pending` check names and a `passing` count.
- `size` — `additions`, `deletions`, `changed_files`.
- `latest_reviews` — `login`, `state`, `submitted_at` per reviewer, bots
  included.

`agents[]` — one entry per live agent:

- `agent` — the tool ("codex", "claude", …). `session_id` is that tool's own
  session identifier; present it verbatim so the user can resume with whichever
  tool it names. Never assume a specific resume command.
- `status` — `working`, `idle`, `done`, `blocked`. An agent missing from the
  list has exited.
- `pull_request` — the matched PR id, resolved from the agent's worktree branch
  and head repository. `null` means the agent has no PR yet.
- `branch`, `repo`, `cwd`, `dirty_files`, `focused`, `pane_id`, `title`.

The calling agent appears in this list too. Identify it by `cwd` and leave it
out of the tree.

## Building the Tree

`parent` and `ancestors` are facts about commits: the branch really does
contain that PR's head. Nest `children` under each `parent` and root every
chain at a PR with no `parent`.

A missing `parent` is not proof that a PR is independent. It also happens when
a PR was stacked and its parent has since been rebased, squash-merged, or
force-pushed. Read the PR bodies to recover the declared stack — a
`## Work order` list, `Depends on #N`, `Builds on #N`, `Replaces #N` — and
reconcile:

- Declared and confirmed by git — draw the edge.
- Declared but not confirmed — draw the edge and flag that the child needs a
  restack onto its parent. This is the common case right after a parent lands.
- Confirmed but not declared — draw the edge; the body is just out of date.

Do not treat a `Replaces #N` or a follow-up reference as a dependency.

## Presenting the Tree

Default to one tree grouped by stack, with a short section per root chain and
nesting by depth. Add a legend for the emojis you use.

State, one per PR, chosen by severity:

- ✅ merged
- ⚫ closed (in `jdx/*` this is usually a stale-PR auto-close)
- 🔴 open and needs attention — conflict, failing CI, or a blocked dependency
- 🟢 open, ready for review, no conflict, CI passing
- 🟡 open draft, otherwise healthy

Keep conflict and CI failure as separate markers after the state emoji — they
are different problems with different fixes, so never collapse them into one:

- ⚠️ conflict, needing a rebase or restack
- ❌ CI failing, followed by the failing check names
- ⏳ CI pending, followed by the pending check names
- 🔀 declared parent not confirmed by git, so the branch needs a restack

Supplementary markers:

- 🤖 a live agent, with its `status`, `agent`, and `session_id`. Place it on
  the PR's own line, not in a separate table.
- ✏️ uncommitted changes in that agent's worktree, with the file count.
- 🐇 CodeRabbit, 🦎 Greptile, or another review bot, with its review state.
  No review on a ready PR often means the bot skipped a large diff — check the
  PR comments before reporting it as pending.

Per PR, show the number as a link, the title, the size as
`+additions −deletions · N files`, the markers above, and one explanation
line. Keep the explanation to a single sentence naming the behavior the PR
changes, not how it is implemented and not a restatement of the title. Write
it in the language the user is using. Never drop the explanation to save
space — a PR with no explanation is the one the user has to go look up.

Close with anything the tree cannot show: agents with no PR, merged parents
whose children still need a restack, and what changed since the last time you
rendered it.

Do not print the raw JSON, and do not report checks or reviews as still
settling unless the user asked you to wait for them.
