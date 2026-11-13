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

The Worker container copies mise from `jdxcode/mise` on Docker Hub, the same
image mise publishes to `ghcr.io/jdx/mise`. Renovate's Docker datasource only
reads release timestamps from Docker Hub, so GHCR tags skipped the one-day
release cooldown and moved ahead of the other mise pins, which failed the
Dockerfile's `MISE_VERSION` check until the pins caught up. The owner chose
Docker Hub on 2026-11-13 to keep the digest pin and the cooldown.

## Language

Use English for everything published to GitHub: repository files, code comments,
commit messages, branch names, and the titles, descriptions and comments of pull
requests and issues. Do not translate existing content only to change its
language. Preserve intentional localizations, locale-specific fixtures, quoted
source text, and data whose exact wording is required for correctness.

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

## Change Workflow

- Keep one scope per pull request.
- Branch from the latest `main`, or from a prerequisite PR's branch when
  stacking under the global agent rules. Do not push to `main` directly.
- Write commit messages and PR titles as Conventional Commits, for example
  `feat(macos): disable display dimming on battery` or
  `chore(deps): update dependency hk to v2.12.0`.
- Pull requests are squash-merged. GitHub uses the PR title as the squash commit
  subject only for multi-commit PRs; a single-commit PR keeps its commit
  subject, and the commit body is the concatenated commit messages, not the PR
  description. When merging, set the squash commit subject to the PR title.
- Every PR not opened by Renovate, including documentation-only PRs, needs a
  review by a reviewer that did not write the change (for an agent-authored PR,
  a separate review agent) before merging. Address each finding and summarize
  the review in the PR description.
- Before merging, wait until every CI job has finished. The required `CI Check`
  job runs only to fail when another job failed or was cancelled, so it shows as
  skipped when everything passed. CodeQL is also required. Never skip, disable
  or weaken a test or check to get CI green.
- Do not write an ADR, code or a PR for a design still under discussion with the
  owner. Propose it to the owner first and start only after explicit approval.
- Branches of merged PRs are deleted automatically. Delete branches of closed or
  abandoned PRs and other stale branches you created; leave `renovate/*`
  branches to Renovate.
- Do not merge a PR in a repository outside the five listed in
  [Related Repositories](#related-repositories) unless the owner says to.
- Merging to `main` deploys the Worker to production once CI passes (see [Worker
  Maintenance](#worker-maintenance)). This repository has no releases.

## Design Decisions

Record every design decision in this repository. Nothing should live only in a
chat, an issue thread or agent memory.

- Large decisions get an ADR at `docs/adr/NNNN-kebab-case-title.md`, numbered
  from `0001`, with Status, Context, Decision and Consequences sections. The
  status of a new ADR is `Accepted (YYYY-MM-DD)`, since designs under discussion
  are not written down yet. A replaced ADR stays in place with its status set to
  `Superseded by NNNN`.
- Smaller decisions go in the `docs/` page, README section or AGENTS.md section
  that owns the behavior.
- Rules for agents working on this repository live in this file. Global agent
  rules live in `unix/home/.codex/AGENTS.md`, which mise links to
  `~/.claude/CLAUDE.md` and Cursor. Do not add a repository-level `CLAUDE.md`.
- Recorded decisions are the current design and stay in force until a change is
  approved. They are not proof that the design is right: when a better design
  exists, propose it with its reasoning.

## External Tools

This repository depends heavily on mise, hk, Renovate, Aube, Bun and
Cloudflare's `cf` CLI. When their behavior matters and is unclear, read their
source code at the version in use (`mise.toml`, `mise.lock`, the
`unix/home/.config/mise/` configuration and the package lockfiles) instead of
guessing or relying on documentation alone. Cite the file and line you relied
on, as a permalink at the tag or commit of that version (or the npm package
version when there is no tag), in the PR or document that depends on it.

## Related Repositories

These repositories are maintained together. The shared configuration
repositories release independently; consumers pin a released version, and
Renovate updates the pin.

- [renovate-config](https://github.com/risu729/renovate-config) provides the
  Renovate preset. Consumers extend it in `.github/renovate.json5`, for example
  `extends: ["github>risu729/renovate-config#3.23.2"]`.
- [hk-config](https://github.com/risu729/hk-config) provides hk `presets.pkl`
  and `helpers.pkl`. Consumers amend and import them in `hk.pkl` by tagged URL,
  for example
  `https://raw.githubusercontent.com/risu729/hk-config/v3.1.0/presets.pkl`.
- [tsconfigs](https://github.com/risu729/tsconfigs) provides the npm package
  `@risu729/tsconfigs`. Consumers pin it in `package.json`, for example
  `"@risu729/tsconfigs": "3.0.1"`, and extend it from `tsconfig.json`.

[dotfiles](https://github.com/risu729/dotfiles) and
[github-notification-cleanup][gnc] consume all three. The shared repositories
also consume each other: renovate-config uses hk-config and tsconfigs, tsconfigs
uses renovate-config and hk-config, and hk-config uses renovate-config.

The shared configuration repositories also have consumers outside these five.
Before changing one, follow its AGENTS.md.

## Renovate Pull Requests

Check open Renovate PRs in all five repositories listed above every day.

Merge a Renovate PR by hand only when it is a major update, or a grouped PR
containing one, that meets all of these conditions:

- It needs no code or configuration change in this repository.
- It brings no new feature that this repository would want to adopt.
- It does not affect this repository, for example by changing the behavior of a
  command, check or build output it relies on.

Judge these from the release notes and changelog, and from the source at the
new version when they are unclear, and follow the merge rules in
[Change Workflow](#change-workflow). Do not merge any other Renovate PR by
hand; Renovate automerges what its settings allow. When a major update fails a
condition, do not change code for it; report to the owner what it would need.

The [shared preset][preset] (consumers pin a release of it, so check the pinned
tag when it differs from `main`) waits one day after a timestamped release
(`minimumReleaseAge`), except for `risu729/**` and `@risu729/**` packages. It
automerges minor, patch, pin, digest and lock file maintenance updates, and
every update of mise itself, including majors, since mise uses CalVer. Renovate
merges them itself after checks pass (`platformAutomerge: false`). A Renovate PR
that stays open usually has a failing check or is a major update.

When a Renovate PR fails, find the root cause instead of retrying. The same
update often lands in several of the repositories at once, for example a shared
dev tool such as hk, oxlint or mise. Check the same update in the other
repositories, fix the cause once, and apply the same fix to every affected
repository. When the cause is in a shared configuration repository, fix it there
with a `fix:` or `feat:` commit so that a release is published; consumers
receive it through the Renovate update of their pin.

[preset]: https://github.com/risu729/renovate-config/blob/main/src/default.json5
[gnc]: https://github.com/risu729/github-notification-cleanup
