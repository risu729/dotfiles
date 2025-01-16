$ErrorActionPreference = 'Stop'

# might be edited by the worker to use a specific ref
$git_ref = ""

$distribution = "Ubuntu-24.04"

wsl --install --distribution $distribution
wsl --set-default $distribution

$wsl_script = "https://dot.risunosu.com/wsl"
if ($git_ref -ne "") {
	$wsl_script += "?ref=$git_ref"
}
# pipe cannot be quoted
# ref: https://github.com/microsoft/WSL/issues/3284
wsl /usr/bin/env bash -c "SKIP_GIT_SETUP=true bash <(curl -fsSL $wsl_script)"

$wsl_username = "$(wsl whoami)"
winget import --import-file "\\wsl.localhost\$distribution\home\$wsl_username\ghq\github.com\risu729\dotfiles\win\winget.json" --disable-interactivity --accept-package-agreements

# cspell:ignore powertoys
# set PowerToys settings backup directory
# ref: https://github.com/microsoft/PowerToys/blob/29ce15bb8a8b6496fb55e38ec72f746a3a4f9afa/src/settings-ui/Settings.UI.Library/SettingsBackupAndRestoreUtils.cs#L391
$powertoys_backup_dir = "\\wsl.localhost\$distribution\home\$wsl_username\ghq\github.com\risu729\dotfiles\win\powertoys"
# cspell:ignore hkcu
Set-ItemProperty -Path HKCU:Software\Microsoft\PowerToys -Name SettingsBackupAndRestoreDir -Value "$powertoys_backup_dir"
# delete existing PowerToys backup directory
Remove-Item -Path ~\Documents\PowerToys -Recurse -Force

# cspell:ignore wslenv pathext
# set WSLENV to share PATHEXT between Windows and WSL
# ref: https://learn.microsoft.com/en-us/windows/wsl/filesystems#share-environment-variables-between-windows-and-wsl-with-wslenv
[System.Environment]::SetEnvironmentVariable("WSLENV", "PATHEXT", [System.EnvironmentVariableTarget]::User)

# setup git after browser is installed
# use -i, interactive mode
# need to source .bashrc to update PATH
wsl /usr/bin/env bash -ic "source ~/.bashrc; ~/ghq/github.com/risu729/dotfiles/wsl/setup-git.ts"
