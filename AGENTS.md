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

## Language

Use English consistently for repository documentation, code comments, commit
messages, and pull request titles and descriptions.

## Development and Maintenance

- Read [development and validation](docs/development.md) before changing code.
  It covers tool setup, checks, disposable installer tests, and lockfile rules.
- Read [Worker deployment](docs/worker-deployment.md) before changing Worker
  build, Preview, deployment, or credentials configuration.
- Read [hostname maintenance](worker/HOSTNAME-MAINTENANCE.md) before changing
  Custom Domains or routes.
- See the [repository map](docs/repository-layout.md) to locate configuration
  owners and distinguish repository tools from installed user tools.
