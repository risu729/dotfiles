# Maintenance Notes

- `wsl` is a compatibility symlink to `unix/` so existing installations keep
  working after a pull, before bootstrap replaces their old links. Use `unix/`
  for new source paths.
- Root mise configuration bootstraps the machine and provides repository tools;
  `unix/home/.config/mise/` becomes the user's global mise configuration. Put
  tool changes in the configuration that owns them.
- `unix/home/.codex/AGENTS.md` is installed as global agent instructions,
  including Claude Code and Cursor mappings. Repository-only guidance belongs
  here.
- The Worker substitutes empty ref, profile, and origin assignments in the
  installers. Changes to those assignments in `unix/install.sh` or
  `win/install.ps1` must stay compatible with `worker/src/index.ts`.

## Development

From the repository root, `mise install` installs the pinned tools and
`mise deps` installs both root and Worker dependencies with Aube. Bun remains
the runtime for Bun-specific scripts and tests; Worker package binaries run
through `aube exec --no-install --` after mise prepares their dependencies.

| Task | Command |
| --- | --- |
| Lint and format with fixes | `mise run check` |
| Lint without fixes | `mise run check --lint` |
| Check selected files | `mise exec -- hk check <files>` |
| Bats shell regressions | `mise run test:bats` |
| Worker tests | `mise run worker:test` |
| Both test suites | `mise run test` |

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

## Bootstrap Inspection

Inspect the same repository and profile used by the installer before applying
changes. From this checkout, use `mise -E personal bootstrap status --json`
(or omit `-E personal` for the shared profile). Add `--missing` when drift
should make the command exit unsuccessfully.

Use `mise -E personal bootstrap plan --json --detailed-exitcode` for the
resource change plan: exit 0 means no changes, 2 means changes, and 1 means an
error or unknown state. The plan covers packages, accounts, files, services,
firewall rules, and Compose resources. It does not plan repositories, dotfiles,
shell activation, macOS defaults, tools, or hooks. Use
`mise -E personal bootstrap --dry-run` to preview the whole bootstrap, and
`mise -E personal dot diff` to review managed dotfile content separately.

These are native mise inspection commands; do not run them through a task that
prepares dependencies first. Inspecting trusted templates can evaluate their
`exec()` expressions. Keep secret prompting opt-in; ordinary inspection should
not provision the Cloudflare Tunnel token.

## Worker Maintenance

Run tasks from the repository root: `mise run worker:dev` starts the local
server, `mise run worker:preview` previews a build, and
`mise run worker:test:watch` opens the Vitest UI.
`mise run worker:build:preview` builds a named Workers Preview;
`mise run worker:build` builds the production artifact. Both write the same
output directory. Mise serializes them within one invocation; do not run
production and Preview builds in separate concurrent processes.

Production uses the exact Worker artifact validated by CI, with its source
revision and checksum; do not rebuild it during deployment. Main pushes deploy
after all checks pass. For a manual deployment, run **CI** on `main` with
**Deploy the validated Worker** enabled. **Upstream Health** never deploys.

Deployment uses repository variable `CLOUDFLARE_ACCOUNT_ID` and the
existing repository secret `CLOUDFLARE_API_TOKEN`. Production targets the
`production` Environment and Preview targets `preview`; both can use the
repository secret without reading or re-entering its value. An Environment
secret with the same name takes precedence if added later. Moving the token to
Environment secrets is a separate migration: validate both deployment paths
before removing the repository copy. The reusable artifact validation workflow
receives no secrets. The token needs
`Individual Workers Editor` scoped to `dotfiles-worker` on account `risu`.
Production uploads the validated artifact with
`cf workers versions create --prebuilt --mode production`, then deploys that
exact version with `cf workers deployments create` to 100% of traffic. It
preserves the existing Custom Domain without updating triggers.

The pinned `cf` beta reads `worker/cloudflare.config.ts` and builds with Vite.
CI archives `.cloudflare/output/v0` and always uses `--prebuilt` when uploading.
PRs use named Workers Previews built separately with `cf-vite build --preview`.
The Preview workflow serializes updates and close-event cleanup per PR and
checks the live PR state before acting. Fork PRs only run validation.
The pinned `wrangler-deploy-action` v2 runs cf for previews, dry runs, and
production. It reads back the deployment to verify the exact version at 100%.
Keep `deploy-triggers` false for routine deployment. The action owns the beta
CLI output contract; validate CLI and action upgrades together.

Manage Custom Domain and route changes separately with suitable permissions.
Per-Worker tokens currently cannot manage Custom Domains. Do not replace version
deployment with `cf deploy` without accounting for its trigger updates.

## Language

Use English consistently for repository documentation, code comments, commit
messages, and pull request titles and descriptions.

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

## Updating Global Tool Locks

Preview newer versions for the checked-in shared global tool configuration with
`tasks/maintenance/lock-bump shared` or select the personal configuration with
`tasks/maintenance/lock-bump personal`. Add tool names to narrow the update.
The command uses native `mise lock --global --bump --dry-run --json`, retains
the declared release-age policy and exact pins, and does not install tools.

After reviewing the preview, use `tasks/maintenance/lock-bump --write personal`
(or `shared`) to update the locks and native dependency sidecars. Review and
commit those generated files together. JSON reports version changes only;
unchanged-version metadata or sidecar refreshes can still produce a Git diff.
Installation remains a separate `mise install --locked` operation.

Invoke the executable directly to avoid task dependency preparation. The
equivalent task invocation is
`mise run --skip-tools --no-deps maintenance:lock-bump personal`. Exact-version
arguments are rejected because `mise lock tool@version` can rewrite a configured
request. The root project pins and host system configuration are outside this
operation's write scope.

## Native Dependency Sidecars

Run `tasks/verify/lock-sidecars` after changing mise locks or native backend
settings. It checks the root lock and the checked-in shared/personal global
locks using `mise lock --sidecars --json`, and fails if a referenced sidecar
directory or a Git-tracked file is missing. Existing sidecar files, including
ignored files, must all be tracked. References outside this checkout fail
explicitly. The native inventory handles profile lock names and
symlinked lock locations; the audit does not guess paths from tool versions.
It does not validate sidecar contents or recompute their digests.

Keep referenced native manifests and lockfiles with their owning mise lock in
commits and caches. Root sidecars live under `.mise/locks/`; the global source
uses `unix/home/.config/mise/locks/`, with profile locks in named
subdirectories. Use the native inventory when checking a particular reference,
including paths outside the current directory. Do not delete sidecars merely
because they are not needed on the current operating system.

The executable needs Git and the installed mise and Bun runtimes and does not
install dependencies. For task discovery, the equivalent invocation is
`mise run --skip-tools --no-deps verify:lock-sidecars`. To inspect paths without
requiring every directory to exist, run `mise lock --sidecars --json` directly
(or add `--global` for the installed global configuration).
