# 🐿 Risu's dotfiles

## ⭐ Description

These dotfiles are used to configure my environment, mainly Windows 11 and WSL2 (Ubuntu).

Since I use WSL2 as my main development environment, I only install GUI applications on Windows, such as browsers, IDEs, etc.

## ⚙️ Installation

### 🪟 Windows 11

<!-- cspell:ignore bypassnro -->

> \[!IMPORTANT]
> Set up Windows 11 **without** a Microsoft account to avoid the automatic installation of OneDrive.
>
> 1. Press `Shift + F10` on the startup screen (do **not** connect to the internet).
> 2. Run the following command in Command Prompt:
>
>    ```cmd
>    oobe\bypassnro
>    ```
>
> 3. Continue the setup without a Microsoft account by selecting `I don't have internet`.

In PowerShell, Windows PowerShell, or Command Prompt, run the following command.
Do **not** run it in Windows Terminal, as it will be uninstalled during the installation.

```powershell
powershell -c "irm dot.risunosu.com/win | iex"
```

Follow the on-screen instructions. When `wsl --install` completes, press `Ctrl + D` to exit the WSL shell and continue the installation.

### 🐧 WSL2

The Windows installation script will install dotfiles in WSL2, so you don't need to run the installation script again.

However, if you want to install dotfiles to WSL2 only—such as when you reset WSL2—you can run the following command in bash:

```bash
bash <(curl -fsSL https://dot.risunosu.com/wsl)
```

> \[!IMPORTANT]
> Use process substitution (`<()`) instead of piping (`|`) for interactive scripts.

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
