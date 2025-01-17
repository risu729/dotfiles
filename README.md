# 🐿 Risu's dotfiles

## ⭐ Description

This dotfiles are used to configure my environment, mainly Windows 11 and WSL2 (Ubuntu).

Since I use WSL2 as my main development environment, I only install some GUI applications on Windows, like browsers, IDEs, etc.

## ⚙️ Installation

### 🪟 Windows 11

<!-- cspell:ignore bypassnro -->

> [!IMPORTANT]
> Set up Windows 11 without a Microsoft account to avoid automatic installation of bloatware, mainly OneDrive.
>
> 1. Press `Shift + F10` on the startup screen. (Never connect to the internet)
> 2. Run the following command in Command Prompt.
>
>    ```cmd
>    oobe\bypassnro
>    ```
>
> 3. Continue the setup without a Microsoft account by selecting `I don't have internet`.

In PowerShell, Windows Powershell, or Command Prompt, run the following command.  
Do not run it in Windows Terminal as it will be uninstalled during the installation.

```powershell
powershell -c "irm dot.risunosu.com/win|iex"
```

Follow the instructions on the screen. When `wsl --install` completes, press `ctrl + d` to exit the WSL shell and continue the installation.

### 🐧 WSL2

Windows installation script will install dotfiles to WSL2, so you don't need to run the installation script again.

However, if you want to install dotfiles to WSL2 only, like when you reset WSL2, you can run the following command in bash.

```bash
bash <(curl -fsSL https://dot.risunosu.com/wsl)
```

> [!IMPORTANT]
> Use process substitution (`<()`) instead of piping (`|`) for interactive scripts.

## ➡️ What to do next

<!-- cspell:ignore powertoys -->

1. Restore PowerToys settings. See [docs](https://learn.microsoft.com/en-us/windows/powertoys/general#backup--restore).

2. Install the following software in Windows which is not installed by the script.

- [Lenovo Vantage](https://www.lenovo.com/us/en/software/vantage)  
  It cannot be installed via `winget`.

- [Minecraft Launcher](https://aka.ms/minecraftClientGameCoreWindows)  
  It cannot be installed via `winget`.

- [X](https://x.com)
  PWA apps cannot be installed using the script.

## 🛠️ Development

### ⚙️ Setup

**Prerequisites**: [mise](https://mise.jdx.dev/)

Clone this repository and run the following command.

```bash
mise i
```

### 🧵 Lint and Format

The following command will lint and format the code. (including auto-fix)

```bash
mise check
```

### ✏️ Commit

The following command will commit the changes interactively.

```bash
mise commit
```

## 📜 License

MIT
