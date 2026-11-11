# Development and Validation

From the repository root, `mise install` installs the pinned tools and
`mise deps` installs both root and Worker dependencies with Aube. Bun remains
the runtime for Bun-specific scripts and tests; Worker package binaries run
through `aube exec --no-install --` after mise prepares their dependencies.

| Task                            | Command                         |
| ------------------------------- | ------------------------------- |
| Lint and format with fixes      | `mise run check`                |
| Lint without fixes              | `mise run check --lint`         |
| Check selected files            | `mise exec -- hk check <files>` |
| Check current registry backends | `mise run verify:mise-backends` |
| Bats shell regressions          | `mise run test:bats`            |
| Worker tests                    | `mise run worker:test`          |
| Both test suites                | `mise run test`                 |

The backend check reads both the repository and installed-global configuration
sources, for bare and personal profiles. CI runs it on Linux and macOS with the
latest mise registry; it fails when `mise backends switch --dry-run` proposes a
migration. Explicit backend choices remain intentional overrides. Update the
appropriate scope with `mise backends switch` (or `--global` for the installed
global configuration), repeat with `-E personal`, and commit the generated
lockfiles. Run the check again to confirm there are no remaining migrations.

Worker tests fetch installer scripts from GitHub at the checked-out commit;
that commit must be pushed before running them. Bats tests use local fixtures.
For one shell suite, use
`mise exec -- bats tests/installer-revisions.bats`.

Installer integration tests perform a real bootstrap. On a disposable machine,
use `TEST_PROFILE=bare mise run test:installer-linux` or
`TEST_PROFILE=personal mise run test:installer-macos`; both tasks accept either
profile and install twice. Linux needs Docker and the `wsl-amd64.wsl` image
prepared by CI. The macOS task changes the Mac running it. Both require
`GIT_COMMIT_SHA` (default: `HEAD`) to be available on GitHub.

To inspect an existing installation without reinstalling, use
`TEST_PROFILE=personal mise run verify:installation` (or `bare`). This includes
`mise doctor` in a fresh interactive shell and treats warnings as failures, then
runs the named `mise doctor project` checks. Project diagnostics alone:
`TEST_PROFILE=personal mise --cd mise/doctor doctor project` (or `bare`); append
`--json` for per-check results. These checks inspect an installed machine, not a
development checkout. Ordinary `mise doctor`, root-level `mise doctor project`,
and hk lint runs do not run them.

The opt-in configuration lives in `mise/doctor/mise.toml` and retains the active
mise profile. Probes resolve paths from the repository root. Linux Bash and
macOS Zsh checks start fresh interactive shells. Failed checks include repair
hints; probe output is hidden by mise, so run the command in its hint when more
detail is needed. `bash -x` shows the failing assertion and expanded paths.

## Generated Lockfiles

Generate `pnpm-lock.yaml` and `worker/pnpm-lock.yaml` with Aube; do not edit
these generated files by hand. Both packages retain pnpm v9 lockfiles so
Renovate can refresh them with its standard pnpm support. Install dependencies
and run package binaries with Aube; the lockfile format does not select the
local package manager.

Use `aube install --lockfile-only` in the affected package after changing its
manifest, then verify `aube install --frozen-lockfile` and commit the manifest
and lockfile together. The package-local `.npmrc` files keep new lockfiles in
pnpm format. Do not run `aube import`, which would create a higher-precedence
`aube-lock.yaml`.
