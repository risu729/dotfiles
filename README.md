# 🐿 Risu's Dotfiles

Personal configuration for my Windows, WSL, and macOS development environments.

## ⭐ Description

These dotfiles are used to configure my environment, mainly Windows 11 and WSL2
(Ubuntu 26.04 LTS).

Since I use WSL2 as my main development environment, I only install GUI
applications on Windows, such as browsers, IDEs, etc.

On macOS, the same `mise bootstrap` applies the shared dotfiles and tools,
system preferences, and a few desktop apps, and keeps zsh as the login shell.
`~/.zshrc` only gets a managed block that sources `~/.config/zsh/zshrc`, the zsh
counterpart of `.bashrc`, so machine-local lines in `~/.zshrc` survive.

Everything is split along two axes:

- **Platform.** Linux-only and macOS-only configuration lives in
  `mise.linux.toml` and `mise.macos.toml`, which `auto_env` in `.miserc.toml`
  loads automatically. `.miserc.toml` is only found from inside the repository,
  so the installer sets `MISE_AUTO_ENV=true` as well. Bootstrap hooks are
  templates that skip Linux-only steps elsewhere, and dotfile entries carry `os`
  variants.
- **Profile.** A plain bootstrap installs only what is safe on any machine,
  including a work one. `-E personal` adds `mise.personal.toml`, the global
  `config.personal.toml`, and the dotfile entries marked
  `profile = "personal"`: SSH hosts, the Git identity and commit signing, and
  personal repositories and tools. The rendered `~/.config/mise/miserc.toml`
  remembers the profile for later runs. To drop back, delete the `env` line
  there and bootstrap again; links that `personal` created may remain.

Cloudflare Tunnel is installed in WSL and configured as a systemd user
service. The service retries until a remotely-managed tunnel token is stored
at `~/.config/cloudflared/tunnel-token`, then connects automatically. Bootstrap
also assigns `10.1.0.20/32` to the WSL loopback interface for a stable
Cloudflare private-network route to SSH.

## 🧭 Repository Structure

This repository is organized around the two installer entry points:
`win/install.ps1` for Windows and `unix/install.sh`, which WSL2 and macOS
share.

- `win/` contains the Windows setup script, `winget` package list, PowerToys
  settings backup, and Windows application configuration files.

- `unix/` contains the installer for WSL2 and macOS. It installs mise for the
  operating system it runs on, clones this repository, and runs
  `mise bootstrap`.

- `wsl/` contains the files installed by `mise bootstrap`.
  - `wsl/home/` mirrors the target home directory and is shared with macOS.
    Mise links these files into `$HOME`, except for Codex skills, which are
    copied because Codex does not discover symlinked skill files.
  - On Linux, mise declaratively installs `wsl/codex/config.toml` as
    system-level Codex defaults at `/etc/codex/config.toml`, leaving the mutable
    user configuration untracked.
  - `wsl/setup-git.ts` performs interactive GitHub authentication after the
    bootstrap, on WSL and macOS. Shared Git settings live in
    `wsl/home/.config/git/config`. The identity and SSH signing are in
    `personal.gitconfig` next to it, which is linked for the personal profile
    only. `ghr` defaults live in `wsl/home/.ghr/ghr.toml`.

- `worker/` is a Cloudflare Worker for `dot.risunosu.com`. It redirects the root
  route to this README and serves the `/win`, `/wsl`, and `/mac` installer
  routes by fetching the matching scripts from GitHub and injecting the
  requested Git ref, profile, and script origin.

- `docker/` and `compose.ci.yml` define the Ubuntu WSL-like test environment
  used by CI to exercise the WSL installer.

- `.github/workflows/` contains linting, installer test, worker, and PR
  maintenance workflows.

- `github/` contains GitHub repository configuration files managed outside
  `.github/`, such as `rulesets.json`.

- The root configuration files (`mise.toml`, `tasks.toml`, `hk.pkl`, and the
  formatter/linter configs) define the machine bootstrap, development toolchain,
  and checks for both the root repository and the worker package.

## ⚙️ Installation

Use the installer for the operating system being configured.

### 🪟 Windows 11

> \[!IMPORTANT]
>
> Set up Windows 11 **without** a Microsoft account to avoid the automatic
> installation of OneDrive.
>
> 1. Press `Shift + F10` on the startup screen (do **not** connect to the
>    internet).
> 2. Run the following command in Command Prompt:
>
>    ```cmd
>    start ms-cxh:localonly
>    ```
>
> 3. Continue the setup without a Microsoft account by selecting
>    `I don't have internet`.

1. Update Windows 11 to the latest version.
2. Uninstall OneDrive.
3. In Windows Terminal (PowerShell, Windows PowerShell, or Command Prompt), run
   the following command.

```powershell
powershell -c "irm dot.risunosu.com/win | iex"
```

### 🐧 WSL2

The Windows installer script will install dotfiles in WSL2, so you don't need to
run the installer script again.

However, if you want to install dotfiles to WSL2 only—such as when you reset
WSL2—you can run the following command in bash:

```bash
bash -i <(curl -fsSL "https://dot.risunosu.com/wsl?profile=personal")
```

> \[!IMPORTANT]
>
> Use process substitution (`<()`) instead of piping (`|`) for interactive
> scripts.

<!-- keep separate GitHub alert blocks -->

> \[!TIP]
>
> Both installer scripts are idempotent, meaning you can run them multiple times
> without issues.

### 🍎 macOS

Run the following command in a terminal. It installs mise when it is missing,
clones this repository, and runs `mise bootstrap`:

```bash
bash <(curl -fsSL https://dot.risunosu.com/mac)
```

This installs the shared profile, which is safe on a work machine. On my own
Mac, add the personal profile:

```bash
bash <(curl -fsSL "https://dot.risunosu.com/mac?profile=personal")
```

An explicit `?ref=<branch-tag-or-commit>` installs that revision and keeps the
checkout detached at it, so symlinked dotfiles continue using the requested
version. A later install without a ref returns to the default branch and
updates it. Direct invocations accept `DOTFILES_REF` for the same purpose.
Revision changes refuse a dirty checkout or an unexpected repository origin.

The profile is stored in `~/.config/mise/miserc.toml`, so it only has to be
given once. Running `unix/install.sh` from a clone takes it from
`DOTFILES_PROFILE` instead. `/wsl` takes the same query, and the Windows
installer always passes `profile=personal` to it.

> \[!WARNING]
>
> `--force-dotfiles` replaces existing files such as `~/.claude/settings.json`,
> `~/.config/mise/config.toml`, and `~/.config/gh/config.yml`. Back them up
> first, or preview the run from a clone with `mise bootstrap --dry-run`. A dry
> run does not execute hooks, so on a Mac without Ruby 3 or newer, run
> `mise bootstrap packages apply brew:ruby` and put `/opt/homebrew/bin` on
> `PATH` before it; the real run does this itself.

The first run asks for sudo to create `/opt/homebrew`; mise installs Homebrew
packages itself, so Homebrew is not required. Bootstrap creates
`~/Pictures/Screenshots` and configures it as the screenshot destination.

Log out and back in for the keyboard, mouse, and scrolling preferences to take
effect, and relaunch applications to pick up the text input ones.

Machine-local secrets, such as telemetry credentials for Claude Code on a work
machine, do not belong in this repository. Claude Code merges `env` per variable
across its settings layers, so put them in
`/Library/Application Support/ClaudeCode/managed-settings.d/*.json` instead of
the managed `~/.claude/settings.json`.

### UNSW CSE GitLab

The personal profile installs `glab`, but authentication with the CSE GitLab
instance is manual. Run:

```bash
glab auth login \
  --hostname gitlab.cse.unsw.edu.au \
  --git-protocol https
```

## ➡️ What to Do Next

1. Uninstall unnecessary software pre-installed by Windows 11.

2. Restore PowerToys settings. See [docs][powertoys-backup-restore].

3. Install the following software on Windows, which the script does not install:

- [Lenovo Vantage](https://www.lenovo.com/us/en/software/vantage)
  (Cannot be installed via `winget`.)

- [Minecraft Launcher](https://aka.ms/minecraftClientGameCoreWindows)
  (Cannot be installed via `winget`.)

- [LINE](https://desktop.line-scdn.net/win/new/LineInst.exe)
  (Cannot be installed via `winget`.)

[powertoys-backup-restore]: https://learn.microsoft.com/windows/powertoys/general#backup--restore

## 🛠️ Development

Development tasks are managed with `mise` from this repository.

### ⚙️ Setup

**Prerequisites:** [mise](https://mise.jdx.dev/)

Clone this repository and run the following command:

```bash
mise i
mise deps
```

### 🧵 Lint and Format

The following command will lint and format the code, including auto-fixes:

```bash
mise check
```

### Tests

Run the Bats shell regressions and Worker Vitest suite once:

```bash
mise run test
```

Run either suite with `mise run test:bats` or `mise run worker:test`. For Worker
watch mode with the Vitest UI, use `mise run worker:test:watch`. Bats discovers
`tests/*.bats`; each case uses isolated temporary fixtures. To focus on a shell
suite, run `mise exec -- bats tests/installer-revisions.bats`. CI runs Bats and
Vitest in separate jobs. `hk` lints and formats the test files.

Worker tests fetch installer scripts from GitHub at the checked-out commit.
Push local commits before running the Worker suite or the combined test command.

### Installer Checks

CI tests Linux and macOS with both the bare (shared-only) and personal profiles.
Every PR runs lint, Bats, and Vitest; documentation-only PRs skip bootstrapping
either platform and building the Worker. Shared
configuration/toolchain and unknown paths conservatively select the full suite;
Windows-only changes also build the Worker. Every installer run keeps
all four platform/profile combinations. Stacked PRs receive the same checks. The
separate **Upstream Health** workflow runs the full suite and external-link
checks weekly or on demand, keeping upstream failures identifiable. Manual CI
runs default to full coverage. Latest package and image selections remain in
use.

Each job installs twice, verifies the requested Git revision and managed state
after both passes, and runs `mise doctor` in a fresh interactive shell. The
`verify:installation` task checks installed state and fails on doctor warnings
as well as errors. Linux uses the Ubuntu WSL filesystem in Docker; actual
Windows/WSL runtime coverage is tracked in
[#4287](https://github.com/risu729/dotfiles/issues/4287).

On a disposable environment, run the same tasks as CI:

```bash
TEST_PROFILE=bare mise run test:installer-linux
TEST_PROFILE=personal mise run test:installer-macos
```

The Linux task needs Docker and the `wsl-amd64.wsl` image downloaded by CI.
The macOS task installs directly onto the Mac running it. Both require the
selected `GIT_COMMIT_SHA` (default: `HEAD`) to be available on GitHub.
To verify an existing installation without installing again, run
`TEST_PROFILE=personal mise run verify:installation` (or `bare` as appropriate).

### ☁️ Cloudflare Worker Deployment

CI builds and validates the Worker, then uploads its bundle with the source
revision and a checksum. A separate job downloads it and exercises Wrangler's
deployment dry run. Production deploys that same artifact after lint, script
regression tests, and all four installer combinations pass on main; it never
rebuilds the bundle.
Every main push receives full validation and deployment, so queued/coalesced
runs cannot miss an earlier Worker or toolchain change. PRs keep previews and
selective checks. Running main deployments finish before the next main run.

For a manual deployment, run **CI** on `main` with
**Deploy the validated Worker** enabled. This reruns full validation before
deploying. **Upstream Health** runs never deploy, and other branches only
validate artifacts.

GitHub Actions reads repository variable `CLOUDFLARE_ACCOUNT_ID` and
repository secret `CLOUDFLARE_API_TOKEN` to deploy the Worker. The token's
minimum permissions are:

- Account `risu`: `Workers Scripts: Edit`.
- Zone `risunosu.com`: `Workers Routes: Read`.

Wrangler reads the zone's Worker routes before publishing the configured Custom
Domain to detect assignments to another Worker. Cloudflare creates the Custom
Domain's DNS record and certificate, so `DNS: Edit` is not required. If the
configuration later uses an ordinary route, replace `Workers Routes: Read`
with `Workers Routes: Edit`.

## 📜 License

MIT
