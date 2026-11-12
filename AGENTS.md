# Maintenance Notes

- `wsl` is a compatibility symlink to `unix/` so existing installations keep
  working after a pull, before bootstrap replaces their old links. Use `unix/`
  for new source paths.
- Bootstrap hooks and declarations live in `.config/mise/conf.d/`; keep
  repository tools, task includes, and relative dotfile sources in root configs
  to preserve their lockfile ownership and path resolution. Platform and
  personal overlays remain in `mise.<env>.toml`.
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

## Worker Maintenance

Run tasks from the repository root: `mise run worker:dev` starts the local
server, `mise run worker:preview` previews a build, and
`mise run worker:test:watch` opens the Vitest UI.
`mise run worker:build` builds the production artifact.

Production uses the exact Worker artifact validated by CI, with its source
revision and checksum; do not rebuild it during deployment. Main pushes deploy
after all checks pass. For a manual deployment, run **CI** on `main` with
**Deploy the validated Worker** enabled. **Upstream Health** never deploys.

Deployment uses repository variable `CLOUDFLARE_ACCOUNT_ID` and the existing
repository secret `CLOUDFLARE_API_TOKEN`. Production targets the `production`
Environment and Preview targets `preview`; both can use the repository secret
without reading or re-entering its value. An Environment secret with the same
name takes precedence if added later. Moving the token to Environment secrets is
a separate migration: validate both deployment paths before removing the
repository copy. All Worker jobs live in `ci.yml`; only the Preview and
production deploy jobs reference Cloudflare credentials, and artifact validation
runs without them. The token needs `Individual Workers Editor` scoped to
`dotfiles-worker` on account `risu`. Production uploads the validated artifact
with `cf workers versions create --prebuilt --mode production`, then deploys
that exact version with `cf workers deployments create` to 100% of traffic. It
then reconciles the declared Custom Domain, workers.dev and Preview URL
settings.

The pinned `cf` beta reads `worker/cloudflare.config.ts` and builds with Vite.
CI archives `.cloudflare/output/v0` and always uses `--prebuilt` when uploading.
PRs use named Workers Previews. CI lets `wrangler-deploy-action` run
`cf previews deploy` without `--prebuilt`, Cloudflare's documented flow, so cf
builds with Preview context and drops production domains. The deploy runs in a
job required by `CI Check`, so a broken Preview build or deployment blocks
merging. Fork PRs only run validation; runs without Preview credentials, such as
Dependabot's, skip the Preview. Superseded PR runs are cancelled with the rest
of CI. Before deploying, the job checks that the PR is open at the tested head,
so re-running an old run cannot replace the current Preview. Because cf builds
while holding the API token, build-time code from same-repository PRs, including
Renovate's dependency updates, can read it. Cloudflare's documented Preview flow
has the same premise; keep the token scoped to this Worker. The pinned
`wrangler-deploy-action` v3 runs cf for previews, dry runs, and production. It
reads back the deployment to verify the exact version at 100%. Use
`deploy-triggers: true` for production; dry-run and Preview keep it false. The
action owns the beta CLI output contract; validate CLI and action upgrades
together.

Previews of closed PRs are not deleted. Cloudflare evicts the least recently
deployed Preview once a Worker reaches its Preview limit, and this Worker has
no storage bindings whose data would outlive the PR. A closed PR's Preview
only stays reachable at its unadvertised Preview URL until it is evicted.
Revisit cleanup if the Worker gains storage bindings or secrets.

The owner selected routine trigger reconciliation on 2026-11-11. The shared
action checks Custom Domain changesets before publication and before trigger
deployment, then verifies the resulting attachments. Conflicts and authorization
errors stop the release. Keep the existing Worker-scoped credential; verify its
actual legacy endpoint access and add only demonstrated necessary grants. The
public account API permission table does not prove the legacy endpoint needs
broad script rights. No new routes, schedules or bindings are introduced. Domain
removal or modifying an existing attachment requires separately reviewed
maintenance. Production concurrency remains the single-writer boundary;
changeset checks are not atomic.

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
