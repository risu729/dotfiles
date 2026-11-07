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
