---
description: Query the active GitHub user's open pull requests, their stack
  relationships derived from git commit ancestry, the review-bot state of each,
  and the live coding agents working on them. Use when identifying which PR
  belongs to current work, resuming concurrent or stacked PR work, resolving PR
  relationships or status, or answering a PR-tracking question.
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
- `--agent-lines N` sets how much of each agent's terminal to capture
  (default 30, `0` to omit).

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
- `review_bots` — see below.

### Reading Review_bots

Presence of a bot in this list is not "it reviewed". Read `verdict`:

- `not_run` — no check and no activity. The bot never looked at this PR.
- `running` — its check on the current head is still in flight.
- `clean` — it ran on this head and left nothing outstanding.
- `findings` — `unresolved` threads are waiting on you. Always show the count.
- `stale` — it commented before, but has no check on the *current* head, so
  the latest push is unreviewed.

`clean` and `not_run` look identical if you only check whether a review object
exists — **they are not the same**, and confusing them is the most common way
to render this wrong. A bot that finds nothing posts only a summary comment
and never opens a formal review, so `reviews: 0` is normal for a clean pass.
Findings that cannot be anchored to the diff are posted as ordinary PR
comments rather than inline, so `unresolved` is the number to trust, not
`reviews`.

Supporting counts: `check` (the head-scoped check-run conclusion), `reviews`,
`last_review_state`, `summaries`, `threads`, `unresolved`, `last_activity`.

### Reading Agents

- `agent` — the tool ("codex", "claude", …). `session_id` is that tool's own
  session identifier. **Print it in full** — a truncated id cannot be used to
  resume, which is the only reason it is there. Never assume a specific resume
  command; the tool named in `agent` decides that. It can be `null`.
- `status` — `working`, `idle`, `done`, `blocked`, and possibly others. Treat
  it as an open set and pass through anything you do not recognise.
- `recent_output` — the tail of that agent's terminal. Summarise it into one
  sentence saying what the agent is doing now, or what it finished last. This
  is the field that answers "what is this agent up to".
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

Give each PR a block of its own, not a single dense line. Cramming status,
size, reviews, and an agent onto one line is the main failure mode here — the
user cannot scan it. Group by stack, one section per root chain, nesting by
depth. Lead with a legend for the glyphs you use.

Per PR, in this order:

1. A heading line: lifecycle glyph, `#number` as a link, and the title.
2. Size as `+additions −deletions · N files`, then the blockers and the review
   state, each on its own line rather than run together.
3. One sentence naming the behavior the PR changes — not how it is
   implemented, not a restatement of the title. Write it in the language the
   user is using. Never drop it to save space; a PR with no explanation is the
   one the user has to go look up.
4. The agent line, when one is matched.

### Lifecycle

One per PR, describing only where it sits in its life, never its health:

- 🟢 open and ready for review
- 📝 open draft
- ✅ merged (only a parent you looked up to complete a chain)

### Blockers

Health is a separate axis, because a PR can have several problems at once and
collapsing them into one colour hides all but the first. Show every one that
applies, each with its own glyph:

- 💥 merge conflict — needs a rebase onto the base branch
- ❌ CI failing — list the failing check names
- ⏳ CI running — list the pending check names
- 🧪 no CI has reported yet
- ♻️ needs a restack — its declared parent is not confirmed by git, usually
  because that parent merged or was force-pushed
- ❓ `head_resolved` is false, so the stack position is unverified

When a PR has none of these, say so positively (CI green, no conflict) rather
than leaving the line blank.

### Review Bots

Give each bot its own entry with a word, never a bare icon. A lone 🐇 tells
the user nothing about whether there is anything to act on:

- 🐇 CodeRabbit and 🦎 Greptile, each followed by the verdict spelled out —
  `3 unresolved`, `reviewed, nothing open`, `still running`, `not run`, or
  `stale, has not seen the latest push`.

### Agents

- 🤖 the tool and status, the **full** `session_id`, and one sentence from
  `recent_output` describing what it is doing or last did.
- ✏️ append the `dirty_files` count when the worktree has uncommitted changes.

Close with what the tree cannot show: agents with no PR, children needing a
restack, entries in `errors[]`, and what changed since you last rendered it.

Do not print the raw JSON.
