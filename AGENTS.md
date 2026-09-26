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
- Agent skills under `unix/home/.agents/` are copied, unlike most dotfiles,
  because Codex does not discover symlinked skill files. Editing the source does
  not update an already installed copy.
- The Worker substitutes empty ref, profile, and origin assignments in the
  installers. Changes to those assignments in `unix/install.sh` or
  `win/install.ps1` must stay compatible with `worker/src/index.ts`.

## Development

From the repository root, `mise install` installs the pinned tools and
`mise deps` installs the root and Worker dependencies.

| Task | Command |
| --- | --- |
| Lint and format with fixes | `mise run check` |
| Lint without fixes | `mise run check --lint` |
| Check selected files | `mise exec -- hk check <files>` |
| Bats shell regressions | `mise run test:bats` |
| PR-tree unit tests | `mise run test:pr-tree` |
| Worker tests | `mise run worker:test` |
| All three test suites | `mise run test` |

Worker tests fetch installer scripts from GitHub at the checked-out commit;
that commit must be pushed before running them. Bats and PR-tree tests use
local fixtures. For one shell suite, use
`mise exec -- bats tests/installer-revisions.bats`.

Installer integration tests perform a real bootstrap. On a disposable machine,
use `TEST_PROFILE=bare mise run test:installer-linux` or
`TEST_PROFILE=personal mise run test:installer-macos`; both tasks accept either
profile and install twice. Linux needs Docker and the `wsl-amd64.wsl` image
prepared by CI. The macOS task changes the Mac running it. Both require
`GIT_COMMIT_SHA` (default: `HEAD`) to be available on GitHub.

To inspect an existing installation without reinstalling, use
`TEST_PROFILE=personal mise run verify:installation` (or `bare`). This includes
`mise doctor` in a fresh interactive shell and treats warnings as failures,
then runs the named `mise doctor project` checks. Project diagnostics alone:
`TEST_PROFILE=personal mise run verify:project` (or `bare`); append `--json` for
per-check results. These checks inspect an installed machine, not a development
checkout. Ordinary `mise doctor`, root-level `mise doctor project`, and hk lint
runs do not run them.

The opt-in configuration lives in `mise/doctor/mise.toml` and retains the active
mise profile. Its paths are relative to that config's root; probes run from the
repository root. Linux Bash and macOS Zsh checks start fresh interactive shells.
Failed checks include repair hints; probe output is hidden by mise, so run the
command declared in the config directly when more detail is needed.

## Worker Maintenance

Run tasks from the repository root: `mise run worker:dev` starts the local
server, `mise run worker:preview` previews a build, and
`mise run worker:test:watch` opens the Vitest UI.

Production uses the exact Worker artifact validated by CI, with its source
revision and checksum; do not rebuild it during deployment. Main pushes deploy
after all checks pass. For a manual deployment, run **CI** on `main` with
**Deploy the validated Worker** enabled. **Upstream Health** never deploys.

Deployment uses repository variable `CLOUDFLARE_ACCOUNT_ID` and secret
`CLOUDFLARE_API_TOKEN`. The token needs `Workers Scripts: Edit` on account
`risu` and `Workers Routes: Read` on zone `risunosu.com`. Wrangler reads routes
to check for conflicting assignments before publishing the Custom Domain;
Cloudflare creates its DNS record and certificate. If switching to an ordinary
route, use `Workers Routes: Edit` instead.
