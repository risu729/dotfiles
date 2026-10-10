# 🐿 Risu's Dotfiles

My development environment for Windows 11, WSL2 (Ubuntu), and macOS, managed
with [mise](https://mise.jdx.dev/). Windows hosts desktop apps; WSL2 and macOS
share shell configuration and command-line tools.

## Installation

Choose the platform to configure. The Windows installer also handles WSL2.

### Windows 11

Set up Windows without a Microsoft account to avoid automatically installing
OneDrive. During initial setup, stay disconnected from the internet, press
`Shift + F10`, and run:

```cmd
start ms-cxh:localonly
```

Continue with **I don't have internet**. Update Windows to the latest version
and uninstall OneDrive if present, then run in Windows Terminal:

```powershell
powershell -c "irm dot.risunosu.com/win | iex"
```

This also sets up WSL2 with the personal profile. After installation, restore
[PowerToys settings][powertoys-backup]
from the backup in [`win/`](win/).

Remove unnecessary pre-installed software and install these apps separately:

- [Lenovo Vantage](https://www.lenovo.com/us/en/software/vantage)
- [Minecraft Launcher](https://aka.ms/minecraftClientGameCoreWindows)
- [LINE](https://desktop.line-scdn.net/win/new/LineInst.exe)

[powertoys-backup]: https://learn.microsoft.com/windows/powertoys/general#backup--restore

### WSL2

For an existing or reset WSL2 environment, run in Bash:

```bash
bash -i <(curl -fsSL https://dot.risunosu.com/wsl)
```

The WSL2 and macOS commands use process substitution (`<()`) so the script
comes from a file descriptor while standard input stays available for
interactive prompts. Piping into Bash would use standard input for the script.

### macOS

Run in a terminal:

```bash
bash <(curl -fsSL https://dot.risunosu.com/mac)
```

Accept the Xcode Command Line Tools installation dialog if prompted. The
installer sets up mise, desktop apps, system preferences, and shared dotfiles.
Homebrew itself is not required. Log out and back in for keyboard, mouse, and
scrolling preferences to take effect.

macOS keeps zsh as the login shell. A managed block in `~/.zshrc` loads the
shared configuration while preserving machine-local lines.

### Profiles

The WSL2 and macOS commands above install the shared configuration. Add
`?profile=personal` to include my Git identity and commit signing, SSH hosts,
personal repositories, and extra tools:

```bash
bash -i <(curl -fsSL "https://dot.risunosu.com/wsl?profile=personal")
bash <(curl -fsSL "https://dot.risunosu.com/mac?profile=personal")
```

The profile is saved in `~/.config/mise/miserc.toml` for later runs. To return
to the shared profile, remove its `env` line and rerun the installer. Existing
personal-profile links may remain.

## Updating and Choosing a Revision

Rerun the installer to update and reapply the configuration. On WSL2 and macOS,
the checkout lives at `~/.ghr/github.com/risu729/dotfiles`.

On Windows, rerunning installs missing apps without upgrading installed ones.
Use `win/packages.ps1 -Action Upgrade -DryRun`, then `-Action Upgrade`, from the
checkout in native PowerShell for managed app updates. Self-updating apps are
excluded. See [Windows update ownership and commands](win/README.md).

Add `?ref=<branch-tag-or-commit>` to an installer URL to select a revision, or
combine it with a profile:

```bash
bash <(curl -fsSL "https://dot.risunosu.com/mac?profile=personal&ref=main")
```

An explicit ref leaves the Unix checkout detached at that revision. A later run
without `ref` returns to the default branch and updates it. Commit or stash
local changes before switching revisions.

When running the Unix installer directly from a clone, use `DOTFILES_PROFILE`
and `DOTFILES_REF` for the same options:

```bash
DOTFILES_PROFILE=personal DOTFILES_REF=main bash unix/install.sh
```

## Customization

Shared packages and dotfile mappings are in [`mise.toml`](mise.toml), with
platform overrides in [`mise.linux.toml`](mise.linux.toml) and
[`mise.macos.toml`](mise.macos.toml). Personal additions are in
[`mise.personal.toml`](mise.personal.toml). Edit these when adapting the setup
for your own machines.

On macOS, machine-local Claude Code credentials can go in
`/Library/Application Support/ClaudeCode/managed-settings.d/*.json`; the
installer manages `~/.claude/settings.json`.

For the personal WSL Cloudflare Tunnel, place the remotely managed tunnel token
at `~/.config/cloudflared/tunnel-token`. The systemd user service connects once
the token is present.

The personal profile includes `glab`. To authenticate with UNSW CSE GitLab:

```bash
glab auth login --hostname gitlab.cse.unsw.edu.au --git-protocol https
```

## Contributing

See [AGENTS.md](AGENTS.md) for development and maintenance notes.

## License

[MIT](LICENSE)
