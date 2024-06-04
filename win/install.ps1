$distribution = "Ubuntu-24.04"

wsl --install -d $distribution
wsl --set-default   $distribution

# ref: https://github.com/microsoft/WSL/issues/3284
wsl /usr/bin/env bash -c "bash <(curl -fsSL https://dot.risunosu.com/wsl)"

$wsl_username = "$(wsl whoami)"
winget import --import-file "\\wsl.localhost\$distribution\home\$wsl_username\github\dotfiles\win\winget.json" --disable-interactivity --accept-package-agreements

# cspell:ignore powertoys
# Set PowerToys settings backup directory
# ref: https://github.com/microsoft/PowerToys/blob/29ce15bb8a8b6496fb55e38ec72f746a3a4f9afa/src/settings-ui/Settings.UI.Library/SettingsBackupAndRestoreUtils.cs#L391
$powertoys_backup_dir = "\\wsl.localhost\$distribution\home\$wsl_username\github\dotfiles\win\powertoys"
# cspell:ignore hkcu
Set-ItemProperty -Path HKCU:Software\Microsoft\PowerToys -Name SettingsBackupAndRestoreDir -Value "$powertoys_backup_dir"
