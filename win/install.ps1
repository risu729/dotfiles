# This script must be compatible with PowerShell 5.1 because it is installed by default.
# ref: https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_windows_powershell_5.1

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

<#
.SYNOPSIS
Tests if the current Windows version meets the specified minimum build and display version requirements.

.PARAMETER MinimumBuild
The minimum required Windows build number (e.g., 26100).

.PARAMETER RequiredDisplayVersionString
The required Windows DisplayVersion string in NNHN format (e.g., "24H2").

.NOTES
Throws exceptions on validation failure or inability to retrieve system information.
#>
function Test-MinimumWindowsVersion {
	[CmdletBinding()]
	param(
		[Parameter(Mandatory = $true)]
		[int]$MinimumBuild,

		[Parameter(Mandatory = $true)]
		[string]$RequiredDisplayVersionString
	)

	# Check if running on Windows.
	# The $IsWindows automatic variable might not exist in older PowerShell versions.
	# ref: https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_automatic_variables#iswindows
	# ref: https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_automatic_variables?view=powershell-5.1
	# If $IsWindows doesn't exist, we assume it's Windows.
	if ((Test-Path Variable:\IsWindows) -and ($IsWindows -eq $false)) {
		throw "This script can only run on Windows."
	}

	# cspell:ignore NNHN
	# Derive the numeric version from the required display version string (NNHN format expected)
	if ($RequiredDisplayVersionString -match '^(\d{2})H(\d)$') {
		$requiredVerNum = [int]("$($matches[1])0$($matches[2])")
	}
 else {
		# This indicates an an issue with the script's configuration
		throw "Internal script error: Required DisplayVersion string format '$($RequiredDisplayVersionString)' is invalid. Expected NNHN format."
	}

	try {
		$os = Get-CimInstance Win32_OperatingSystem
		$version = [System.Version]$os.Version
	}
 catch {
		throw "Could not retrieve operating system version information."
	}

	# Check for Windows 10 Major version (which Windows 11 uses) and minimum build
	if ($version.Major -ne 10 -or $version.Build -lt $MinimumBuild) {
		throw "This script requires Windows 11 $($RequiredDisplayVersionString) or later (Build $($MinimumBuild)+). Detected: $($os.Caption) $($version.ToString())"
	}

	# Further validation using DisplayVersion from registry
	try {
		# cspell:ignore HKLM
		$displayVersion = Get-ItemPropertyValue -Path "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion" -Name "DisplayVersion" -ErrorAction Stop
	}
 catch {
		throw "DisplayVersion not found in registry or could not be read. Cannot confirm Windows version details."
	}

	# Validate DisplayVersion format and check against minimum required numeric version
	if ($displayVersion -match '^(\d{2})H(\d)$') {
		# Convert "NNHN" to NN0N for numeric comparison
		$verNum = [int]("$($matches[1])0$($matches[2])")
		if ($verNum -lt $requiredVerNum) {
			throw "DisplayVersion '$displayVersion' is less than required '$($RequiredDisplayVersionString)'."
		}
	}
 else {
		throw "DisplayVersion format '$displayVersion' is invalid. Expected format like '$($RequiredDisplayVersionString)'."
	}

	Write-Host "Detected Windows version (DisplayVersion '$($displayVersion)', Build $($version.Build)) meets minimum requirements ($($RequiredDisplayVersionString) / Build $($MinimumBuild)+)."
}

<#
.SYNOPSIS
Runs an external command using Invoke-Expression and throws an exception on failure.

.PARAMETER Command
The command string to execute.
#>
function Invoke-ExternalCommand {
	[CmdletBinding()]
	param (
		[string]$Command
	)

	Invoke-Expression $Command
	# cspell:ignore LASTEXITCODE
	$exitCode = $LASTEXITCODE
	if ($exitCode -ne 0) {
		throw "Command failed with exit code ${exitCode}: $Command"
	}
}

# must be edited by the worker to use the same script as requested by the user
$script_origin = ""

# Test the Windows version
$minBuild = 26100
$requiredDisplayVersionString = "24H2"
try {
	Test-MinimumWindowsVersion -MinimumBuild $minBuild -RequiredDisplayVersionString $requiredDisplayVersionString
}
catch {
	Write-Error $_.Exception.Message
	exit 1
}

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
	$command = "Invoke-RestMethod $script_origin/win | Invoke-Expression"
	Start-Process powershell -ArgumentList "-NoProfile -NoExit -Command &{ $command }" -Verb RunAs
	Write-Host "Restarting script with administrator privileges..."
	exit
}

# must be edited by the worker to use the correct GitHub repository
$repo_name = ""
# might be edited by the worker to use a specific ref
$git_ref = ""

$distribution = "Ubuntu-24.04"

Run-ExternalCommand "wsl --update --pre-release"
Run-ExternalCommand "wsl --version"
Run-ExternalCommand "wsl --install --distribution `"$distribution`""
Run-ExternalCommand "wsl --set-default `"$distribution`""

$wsl_script = "$script_origin/wsl"
if ($git_ref -ne "") {
	$wsl_script += "?ref=$git_ref"
}
# pipe cannot be quoted
# ref: https://github.com/microsoft/WSL/issues/3284
Run-ExternalCommand "wsl /usr/bin/env bash -c `"SKIP_GIT_SETUP=true bash <(curl -fsSL $wsl_script)`""

$wsl_username = "$(wsl whoami)"
$repo_win_path = $repo_name -replace '/', '\'
$dotfiles_path = "\\wsl.localhost\$distribution\home\$wsl_username\ghq\github.com\$repo_win_path"
Run-ExternalCommand "winget import --import-file `"$dotfiles_path\win\winget.json`" --disable-interactivity --accept-package-agreements"

# uninstall Windows Terminal since it's preview version is installed by winget import
Run-ExternalCommand "winget uninstall --id `"Microsoft.WindowsTerminal`""

# remove generated shortcuts
Remove-Item -Path ~\Desktop\*.lnk -Force
# some apps create shortcuts in public desktop
Remove-Item -Path "$env:PUBLIC\Desktop\*.lnk" -Force

# cspell:ignore powertoys
# set PowerToys settings backup directory
# ref: https://github.com/microsoft/PowerToys/blob/29ce15bb8a8b6496fb55e38ec72f746a3a4f9afa/src/settings-ui/Settings.UI.Library/SettingsBackupAndRestoreUtils.cs#L391
$powertoys_backup_dir = "$dotfiles_path\win\powertoys"
# cspell:ignore hkcu
Set-ItemProperty -Path HKCU:Software\Microsoft\PowerToys -Name SettingsBackupAndRestoreDir -Value "$powertoys_backup_dir"
# delete existing PowerToys backup directory
Remove-Item -Path ~\Documents\PowerToys -Recurse -Force -ErrorAction SilentlyContinue

# cspell:ignore wslenv pathext
# set WSLENV to share PATHEXT between Windows and WSL
# ref: https://learn.microsoft.com/en-us/windows/wsl/filesystems#share-environment-variables-between-windows-and-wsl-with-wslenv
[System.Environment]::SetEnvironmentVariable("WSLENV", "PATHEXT", [System.EnvironmentVariableTarget]::User)

# setup git after browser is installed
# use -i, interactive mode
# need to source .bashrc to update PATH
Run-ExternalCommand "wsl /usr/bin/env bash -ic `"source ~/.bashrc; ~/ghq/github.com/$repo_name/wsl/setup-git.ts`""
