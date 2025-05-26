# 🐿 Risu's dotfiles

## ⭐ Description

These dotfiles are used to configure my environment, mainly Windows 11 and WSL2 (Ubuntu).

Since I use WSL2 as my main development environment, I only install GUI applications on Windows, such as browsers, IDEs, etc.

## ⚙️ Installation

### 🪟 Windows 11

<!-- cspell:ignore localonly -->

> \[!IMPORTANT]
> Set up Windows 11 **without** a Microsoft account to avoid the automatic installation of OneDrive.
>
> 1. Press `Shift + F10` on the startup screen (do **not** connect to the internet).
> 2. Run the following command in Command Prompt:
>
>    ```cmd
>    start ms-cxh:localonly
>    ```
>
> 3. Continue the setup without a Microsoft account by selecting `I don't have internet`.

1. Update Windows 11 to the latest version.
2. Uninstall OneDrive.
3. In Windows Terminal (PowerShell, Windows PowerShell, or Command Prompt), run the following command.

```powershell
powershell -c "irm dot.risunosu.com/win | iex"
```

### 🐧 WSL2

The Windows installer script will install dotfiles in WSL2, so you don't need to run the installer script again.

However, if you want to install dotfiles to WSL2 only—such as when you reset WSL2—you can run the following command in bash:

```bash
bash <(curl -fsSL https://dot.risunosu.com/wsl)
```

> \[!IMPORTANT]
> Use process substitution (`<()`) instead of piping (`|`) for interactive scripts.

> \[!TIP]
> Both installer scripts are idempotent, meaning you can run them multiple times without issues.

## ➡️ What to do next

<!-- cspell:ignore powertoys -->

1. Restore PowerToys settings. See [docs](https://learn.microsoft.com/en-us/windows/powertoys/general#backup--restore).

2. Install the following software on Windows, which the script does not install:

- [Lenovo Vantage](https://www.lenovo.com/us/en/software/vantage)
  (Cannot be installed via `winget`.)

- [Minecraft Launcher](https://aka.ms/minecraftClientGameCoreWindows)
  (Cannot be installed via `winget`.)

- [LINE](https://desktop.line-scdn.net/win/new/LineInst.exe)
  (Cannot be installed via `winget`.)

- [X](https://x.com)
  (PWA apps cannot be installed using the script.)

3. Uninstall unnecessary software pre-installed by Windows 11.

## 🛠️ Development

### ⚙️ Setup

**Prerequisites:** [mise](https://mise.jdx.dev/)

Clone this repository and run the following command:

```bash
mise i
```

### 🧵 Lint and Format

The following command will lint and format the code, including auto-fixes:

```bash
mise check
```

### ✏️ Commit

The following command will commit changes interactively:

```bash
mise commit
```

## 📜 License

MIT
