# Repository Map

The repository has two mise scopes: root configuration prepares a machine and
provides development tools; `unix/home/.config/mise/` is installed as the user's
global configuration. Choose the owner below before changing a tool or setting.

- **Repository lint and test tools, dependency setup, shared bootstrap:**
  [`mise.toml`](../mise.toml) and [`mise.lock`](../mise.lock).
- **Platform bootstrap overrides:** [`mise.linux.toml`](../mise.linux.toml),
  [`mise.macos.toml`](../mise.macos.toml),
  [`mise.windows.toml`](../mise.windows.toml).
- **Personal repositories and bootstrap additions:**
  [`mise.personal.toml`](../mise.personal.toml).
- **Installed CLI tools, aliases, and environment:**
  [`unix/home/.config/mise/`](../unix/home/.config/mise/).
- **Installed shell and application settings:**
  [`unix/home/`](../unix/home/).
- **Merged Codex and Claude settings:** [`unix/codex/`](../unix/codex/),
  [`unix/claude/`](../unix/claude/), and [`win/codex.toml`](../win/codex.toml).
- **Unix and Windows installer entry points:**
  [`unix/install.sh`](../unix/install.sh) and
  [`win/install.ps1`](../win/install.ps1).
- **macOS keyboard and display setup:**
  [`macos/`](../macos/).
- **Linux SSH and system services:**
  [`unix/ssh/`](../unix/ssh/) and [`unix/systemd/`](../unix/systemd/).
- **Installer HTTP service:**
  [`worker/`](../worker/).
- **Repository tasks and validation:** [`tasks.toml`](../tasks.toml),
  [`tasks/`](../tasks/), [`tests/`](../tests/), and
  [`mise/doctor/`](../mise/doctor/).
- **CI, dependency updates, and hostname maintenance:**
  [`.github/`](../.github/).

## Deployment of User Files

Root `mise.toml` declares dotfile groups under `unix/home` and individual
entries with platform or profile restrictions. The `config` group walks
`.config`, while its exclusions leave special entries to their explicit
declarations. Check both the group and individual mappings when adding or moving
a user file.

`wsl` is a compatibility symlink to `unix`. Keep it for existing installations;
new source paths use `unix`.

`unix/home/.codex/AGENTS.md` is installed as the user's global agent
instructions and mapped to Claude Code and Cursor. Repository instructions
belong in the root [`AGENTS.md`](../AGENTS.md).

## Generated Files

Root and Worker package lockfiles are generated with Aube. Mise owns its tool
lockfiles and dependency sidecars in `.mise/locks/` and
`unix/home/.config/mise/locks/`. Keep changes with their owning configuration;
do not hand-edit generated dependency graphs.

See [development and validation](development.md) for commands and test scope,
and [Worker deployment](worker-deployment.md) for build and deployment rules.
