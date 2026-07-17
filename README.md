# 🐿 Risu's Dotfiles

Personal configuration for my Windows and WSL development environments.

## ⭐ Description

These dotfiles are used to configure my environment, mainly Windows 11 and WSL2
(Ubuntu 26.04 LTS).

Since I use WSL2 as my main development environment, I only install GUI
applications on Windows, such as browsers, IDEs, etc.

## 🧭 Repository Structure

This repository is organized around the two installer entry points:
`win/install.ps1` for Windows and `wsl/install.sh` for WSL2.

- `win/` contains the Windows setup script, `winget` package list, PowerToys
  settings backup, and Windows application configuration files.

- `wsl/` contains the WSL launcher and the files installed into the WSL
  environment by `mise bootstrap`.
  - `wsl/home/` mirrors the target home directory. Mise links these files into
    `$HOME`, except for Codex skills, which are copied because Codex does not
    discover symlinked skill files.
  - `wsl/setup-git.ts` performs interactive GitHub authentication after the
    base WSL environment is ready. Git identity, SSH signing, and `ghr`
    defaults live in `wsl/home/.gitconfig` and `wsl/home/.ghr/ghr.toml`.

- `worker/` is a Cloudflare Worker for `dot.risunosu.com`. It redirects the root
  route to this README and serves the `/win` and `/wsl` installer routes by
  fetching the matching scripts from GitHub and injecting the requested Git ref
  and script origin.

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
bash -i <(curl -fsSL https://dot.risunosu.com/wsl)
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

### UNSW CSE GitLab

Mise installs `glab`, but authentication with the CSE GitLab instance is
manual. Run:

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

## 📜 License

MIT
