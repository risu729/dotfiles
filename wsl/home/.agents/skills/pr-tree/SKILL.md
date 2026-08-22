---
description: Query the active GitHub user's open pull requests, their stack
  relationships derived from git commit ancestry, and the live coding agents
  working on them. Use when identifying which PR belongs to current work,
  resuming concurrent or stacked PR work, resolving PR relationships or status,
  or answering a PR-tracking question.
name: pr-tree
---

# PR Tree

The bundled script emits parseable data only. It resolves stacks from git
ancestry, never from prose. Read the PR bodies yourself for declared stacks,
then build and render the tree.

## Collecting the Data

Ancestry is resolved against the working directory, so run the script **from
the checkout of the repository you are tracking**, referring to the script by
its absolute path in this skill directory:

```bash
cd /path/to/the/tracked/repo
/abs/path/to/skill/scripts/pr-tree.ts --current-repo
```

Running it from the skill's own directory succeeds and returns a plausible
tree for the *dotfiles* repository instead. Always confirm `git.cwd` in the
output is the repository you meant.

- `--repo owner/name` (or `--repo=owner/name`) targets one repository; repeat
  for several.
- Omit both to query every open PR by the active GitHub user, across repos.
- `--no-agents` skips the local agent lookup.

`git.heads_resolved` vs `git.heads_total` says how many PR heads the local
clone actually contains. In single-repository mode a shortfall means the
checkout is stale — `git fetch` and rerun. With no repository filter a
shortfall is expected and not fixable by fetching, because one clone cannot
hold the heads of every repository; treat the unresolved PRs as roots.

`errors[]` lists PRs that could not be fetched, with the failing command.
Their absence from `pull_requests[]` is not evidence they do not exist.

## What the Output Contains

`pull_requests[]` — one entry per open PR, with `id` as `owner/repo#number`:

- `parent` — the one ancestor PR that contains every other ancestor. `null`
  when the PR is a root, when git could not resolve the head, and when two
  ancestors contain neither the other (a merge, or a truncated walk). `null`
  therefore means "no single parent", not "independent".
- `children` — the PRs whose `parent` is this one.
- `ancestors` — every PR head contained in this branch. Use it to sanity-check
  a chain when `parent` is `null`.
- `head_resolved` — false when the local clone lacks the head commit, so this
  PR's `parent`, `children`, and `ancestors` are all unreliable.
- `state`, `draft`, `title`, `url`, `number`, `updated_at`, `head_ref`,
  `head_repo`, `head_sha`.
- `conflict` — true only when GitHub reports a conflict. GitHub answers
  `UNKNOWN` while it recomputes mergeability after a push, so `false` means
  "not known to conflict" rather than "merges cleanly".
- `ci` — `state` (`passing`, `failing`, `pending`, `none`), the `failing` and
  `pending` check names, and `passing`. All three count *distinct check
  names*, so a matrix job reporting one name many times counts once.
- `size` — `additions`, `deletions`, `changed_files`.
- `reviews` — `login` and `state` per reviewer, bots included.

`agents[]` — one entry per live agent:

- `agent` — the tool ("codex", "claude", …). `session_id` is that tool's own
  session identifier; present it verbatim so the user can resume with whichever
  tool it names. Never assume a specific resume command. It can be `null`.
- `status` — `working`, `idle`, `done`, `blocked`, and possibly others. Treat
  it as an open set and pass through anything you do not recognise.
- `pull_request` — the matched PR, resolved from the agent's worktree branch
  within the agent's own repository. `null` means no PR yet, or a checkout the
  script could not read.
- `branch`, `repo`, `cwd`, `dirty_files`, `focused`, `pane_id`, `title`.
  `dirty_files` counts `git status --porcelain` lines, so it includes
  untracked files.

`agents` is empty when `herdr` is missing or fails; the PR half still works.

Identify the calling agent by `cwd` and mark its PR as the current one rather
than dropping it — locating the current work is the main thing this skill is
for.

## Building the Tree

`parent` and `ancestors` are facts about commits: the branch really does
contain that PR's head. Nest `children` under each `parent`.

A `null` parent is not proof that a PR is independent. It also happens when a
parent was rebased, squash-merged, or force-pushed, when the head is
unresolved, and when the shape is ambiguous. Read the PR bodies to recover the
declared stack — a `## Work order` list, `Depends on #N`, `Builds on #N` — and
reconcile:

- Declared and confirmed by git — draw the edge.
- Declared but `parent` is `null` — nest under the declared parent and mark it
  as needing a restack. This is the common case right after a parent lands.
- Declared parent differs from git's `parent` — **place the PR under git's
  parent**, and note the disagreement rather than drawing two edges.
- Confirmed but not declared — draw the edge; the body is just out of date.

Root every chain at a PR that has neither a git `parent` nor a declared one.
Do not treat a `Replaces #N` or a follow-up reference as a dependency.

A parent that has already merged will not appear in `pull_requests[]`, since
the script lists only open PRs. Show it as a merged root only if you looked it
up yourself; otherwise just say the child needs a restack.

## Presenting the Tree

Default to one tree grouped by stack, with a short section per root chain and
nesting by depth. Add a legend for the emojis you use.

Pick exactly one state emoji per PR, taking the first that applies in this
order:

- 🔴 conflict, failing CI, or a parent that is itself 🔴
- 🟡 draft, or CI still pending or absent
- 🟢 ready for review, no conflict, CI passing
- ✅ a merged parent you looked up to complete a chain

Keep conflict and CI failure as separate markers after the state emoji — they
are different problems with different fixes, so never collapse them into one:

- ⚠️ conflict, needing a rebase or restack
- ❌ CI failing, followed by the failing check names
- ⏳ CI pending, followed by the pending check names
- 🔀 declared parent not confirmed by git, so the branch needs a restack
- ❓ `head_resolved` is false, so the stack position is unverified

Supplementary markers:

- 🤖 a live agent, with its `status`, `agent`, and `session_id`. Place it on
  the PR's own line, not in a separate table.
- ✏️ uncommitted changes in that agent's worktree, with the file count.
- 🐇 CodeRabbit, 🦎 Greptile, or another review bot, with its review state. A
  ready PR with no bot review usually means the bot skipped a large diff; say
  so rather than reporting it as pending.

Per PR, show the number as a link, the title, the size as
`+additions −deletions · N files`, the markers above, and one explanation
line. Keep the explanation to a single sentence naming the behavior the PR
changes, not how it is implemented and not a restatement of the title. Write
it in the language the user is using. Never drop the explanation to save
space — a PR with no explanation is the one the user has to go look up.

Close with anything the tree cannot show: agents with no PR, children needing
a restack, entries in `errors[]`, and what changed since you last rendered it.

Do not print the raw JSON, and do not report checks or reviews as still
settling unless the user asked you to wait for them.
