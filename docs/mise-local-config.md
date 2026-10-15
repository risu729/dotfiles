# Machine-Local Mise Configuration

Shared discovery defaults remain in `~/.config/mise/miserc.toml`. Bootstrap
merges only the selected profile into `miserc.local.toml`, preserving other
machine-local keys and comments. A checkout's `.miserc.local.toml` can override
the machine choice and is globally ignored by Git.

New global tools, packages, and dotfiles go to the local fragments under
`~/.config/mise/conf.d/90-tools.local.toml`, `91-packages.local.toml`, and
`92-dotfiles.local.toml`. These are regular machine-owned files, not repository
symlinks. Their `.local.toml` names keep their locks in `mise.local.lock`,
separate from the shared `mise.lock` and its dependency sidecars.

Existing declarations stay in their owning file. To promote a machine-local
addition into shared dotfiles, edit the repository declaration, remove the local
entry, and regenerate the shared lockfile. To override an existing shared tool
locally, use an explicit path, for example:

```sh
mise use --path ~/.config/mise/config.local.toml node@26
```

A command updating entries owned by different files may require `--path`.
Write targets route only new entries; they do not move existing tools. Explicit
project paths continue to work normally.

## Automatic Agent Updates

Bootstrap merges Codex and Claude overrides into the regular machine-owned
`config.local.toml`. Their `auto_update = "24h"` setting checks at most once per
day and preserves their existing zero release-age overrides. Other global tools
and project pins do not opt in. No separate update daemon or package-manager
self-update is enabled.

Mise updates an installed agent before shim/exec launches, or in the background
at an activated shell prompt. Offline, CI, locked execution, and project tool
overrides suppress the relevant updates. A failed update keeps the installed
version; inspect `mise doctor` for the error.

The local declarations use `mise.local.lock`, leaving the shared global lock
under Renovate's control. Commit shared-tool changes through the normal PR
workflow. Local agent updates are per-machine state and need not match another
machine's latest agent version.

Before a locked bootstrap installs tools, a Bash seed step copies Codex and
Claude native records verbatim from the generated shared lock into a new
`mise.local.lock`. It validates version 3 TOML, refuses symlinked local locks
and non-native agent backends, and atomically creates the file without replacing
any existing machine-owned state. It requires no Bun or Python before tools.
An existing lock containing both agents is left byte-for-byte unchanged.

If write targets or another process already created a local lock without both
agents, bootstrap stops without changing it. For an empty or pre-version-3 local
lock, first upgrade its format through mise's native writer (this processes all
local tools and cannot be combined with tool arguments):

```sh
mise --cd "$HOME" lock --global --local --upgrade
```

Initialize missing agent records, then rerun bootstrap:

```sh
mise --cd "$HOME" lock --global --local codex claude
```

This one-time migration may resolve currently available agent versions; native
mise locking preserves other local records. The seed hook does not attempt to
merge an existing lock because it cannot share mise's private writer mutex.

If an agent later moves to an npm or PyPI backend, update this migration to
handle its generated dependency sidecars before enabling that backend. Shared
lock records are never edited or advanced by the seed step.
