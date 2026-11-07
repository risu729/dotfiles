# Version-Matched Vendor Skills

Packslip tools fetch their declared skills during installation by default. The
global mise configuration enables project synchronization into `.agents/skills`
after install, use, and upgrade, and removes only stale mise-owned links.
Bootstrap also runs `mise --cd "$HOME" skills sync --global --prune` to prepare
the home-level directory from global tool versions. Run it again after changing
global versions.

Inspect available skills with `mise skills ls --json`. These links point into
the active tool installation; they are machine-local and should not be
committed. Mise preserves handwritten skills and reports conflicting names
without replacing them. Inside ordinary Git clones, mise excludes its links
through `.git/info/exclude`. Linked worktrees share that file, so mise does not
edit it there; inspect status before committing and keep the generated links out
of commits.

GitHub skills installed through `gh skill` or `skills add` remain independent:
mise only synchronizes skills declared by the installed Packslip release.
Changing directories does not synchronize links; rerun sync or
reinstall/use/upgrade.

Reference:
[Packslip resources](https://mise.jdx.dev/dev-tools/packslip-resources.html).
