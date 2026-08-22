---
description: Query the active GitHub user's open pull requests as a stacked
  dependency tree, joined with the live coding agents working on them. Use when
  identifying which PR belongs to current work, resuming concurrent or stacked
  PR work, resolving PR relationships or status, or answering a PR-tracking
  question.
name: pr-tree
---

# PR Tree

The bundled script emits parseable data only. Build and render the tree
yourself from it.

## Collecting the Data

Run the bundled script from this skill directory:

```bash
scripts/pr-tree.ts --current-repo
```

- `--repo owner/name` targets one repository; repeat for several.
- Omit both to query every open PR authored by the active GitHub user.
- `--no-agents` skips the local agent lookup.

Agent data comes from `herdr`. When `herdr` is absent or fails, `agents` is
empty and the PR half still works.

## What the Output Contains

`pull_requests[]` — one entry per PR, with `id` as `owner/repo#number`:

- `state` (`OPEN`, `MERGED`, `CLOSED`), `draft`, `title`, `url`, `updated_at`.
- `in_scope` — `false` for a PR pulled in only because another one referenced
  it. These are context nodes: merged foundations, replaced predecessors. Their
  relations are not parsed, but their `dependents` are populated.
- `dependencies` / `dependents` / `open_dependencies` /
  `dependencies_outside_view` — the stack edges.
- `dependency_source` — `work_order` when the parent came from the PR body's
  `## Work order` list, `keyword` when it came from prose such as
  `Depends on #N` or `Builds on #N`, `none` when the PR declares no parent.
- `work_order` — the full declared stack (`items` with `ref`, `independent`,
  `this_pr`) and this PR's `position`. Use it to show stack members that have
  no PR yet.
- `related` — soft references (follow-ups, split boundaries). Not blocking.
- `replaces` — PRs this one supersedes. Never render these as dependencies.
- `conflict` — merge conflict against the base branch. `OPEN` PRs only.
- `ci` — `state` (`passing`, `failing`, `pending`, `none`) plus the `failing`
  and `pending` check names and a `passing` count.
- `size` — `additions`, `deletions`, `changed_files`.
- `latest_reviews` — `login`, `state`, `submitted_at` per reviewer, bots
  included.
- `head_ref`, `head_repo`, `base_ref`, `merge_state`, `mergeable`, `checks`.

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

Root every chain at a PR with no `open_dependencies`, then nest `dependents`
under it. A merged or auto-closed PR that still has open `dependents` is a
root — show it, because it explains why the children exist and whether they
need a restack.

Trust `dependency_source: "work_order"` over `keyword`. When a PR reports
`none` but its body clearly places it in a stack, say so rather than silently
inventing an edge.

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

Close with anything the tree cannot show: agents with no PR, PRs whose parent
merged and now need a restack, and what changed since the last time you
rendered it.

Do not print the raw JSON, and do not report checks or reviews as still
settling unless the user asked you to wait for them.
