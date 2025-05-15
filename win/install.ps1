$ErrorActionPreference = 'Stop'

function Test-MinimumWindowsVersion {
	[CmdletBinding()]
	param(
		[Parameter(Mandatory=$true)]
		[int]$MinimumBuild,

		[Parameter(Mandatory=$true)]
		[string]$RequiredDisplayVersionString
	)

	# Check if running on Windows.
	# The $IsWindows automatic variable might not exist in older PowerShell versions.
 	# ref: https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_automatic_variables#iswindows
  	# ref: https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_automatic_variables?view=powershell-5.1
	# If $IsWindows doesn't exist, we assume it's Windows.
	if ($IsWindows -eq $false) {
		throw "This script can only run on Windows."
	}

	# Derive the numeric version from the required display version string (NNHN format expected)
	if ($RequiredDisplayVersionString -match '^(\d{2})H(\d)$') {
		$requiredVerNum = [int]("$($matches[1])0$($matches[2])")
	} else {
		# This indicates an issue with the script's configuration
		throw "Internal script error: Required DisplayVersion string format '$($RequiredDisplayVersionString)' is invalid. Expected NNHN format."
	}

	try {
		$os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
		$version = [System.Version]$os.Version
	} catch {
		throw "Could not retrieve operating system version information."
	}

	# Check for Windows 10 Major version (which Windows 11 uses) and minimum build
	if ($version.Major -ne 10 -or $version.Build -lt $MinimumBuild) {
		throw "This script requires Windows 11 $($RequiredDisplayVersionString) or later (Build $($MinimumBuild)+). Detected: $($os.Caption) $($version.ToString())"
	}

	# Further validation using DisplayVersion from registry
	try {
		$displayVersion = Get-ItemPropertyValue -Path "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion" -Name "DisplayVersion" -ErrorAction Stop
	} catch {
		throw "DisplayVersion not found in registry or could not be read. Cannot confirm Windows version details."
	}

	# Validate DisplayVersion format and check against minimum required numeric version
	if ($displayVersion -match '^(\d{2})H(\d)$') {
		$verNum = [int]("$($matches[1])0$($matches[2])")  # Convert "NNHN" to NN0N for numeric comparison
		if ($verNum -lt $requiredVerNum) {
			throw "DisplayVersion '$displayVersion' is less than required '$($RequiredDisplayVersionString)'."
		}
	} else {
		throw "DisplayVersion format '$displayVersion' is invalid. Expected format like '$($RequiredDisplayVersionString)'."
	}

	# If all checks pass, the function completes successfully
	# Print the detected version details in the verbose message
	Write-Host "Detected Windows version (DisplayVersion '$($displayVersion)', Build $($version.Build)) meets minimum requirements ($($RequiredDisplayVersionString) / Build $($MinimumBuild)+)."
}

function Run-ExternalCommand {
    param (
        [string]$Command
    )
    Invoke-Expression $Command
    # cspell:ignore LASTEXITCODE
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        Write-Error "Command failed with exit code ${exitCode}: $Command"
        exit $exitCode
    }
}

$minBuild = 26100
$requiredDisplayVersionString = "24H2"

# Test the Windows version
try {
	Test-MinimumWindowsVersion -MinimumBuild $minBuild -RequiredDisplayVersionString $requiredDisplayVersionString
} catch {
	# Catch any errors thrown by the function and write them before exiting
	Write-Error $_.Exception.Message
	exit 1
}

# might be edited by the worker to use a specific ref
$git_ref = ""

$distribution = "Ubuntu-24.04"

Run-ExternalCommand "wsl --install --distribution `"$distribution`""
Run-ExternalCommand "wsl --set-default `"$distribution`""

$wsl_script = "https://dot.risunosu.com/wsl"
if ($git_ref -ne "") {
	$wsl_script += "?ref=$git_ref"
}
# pipe cannot be quoted
# ref: https://github.com/microsoft/WSL/issues/3284
Run-ExternalCommand "wsl /usr/bin/env bash -c `"SKIP_GIT_SETUP=true bash <(curl -fsSL $wsl_script)`""

$wsl_username = "$(wsl whoami)"
Run-ExternalCommand "winget import --import-file `"\\wsl.localhost\$distribution\home\$wsl_username\ghq\github.com\risu729\dotfiles\win\winget.json`" --disable-interactivity --accept-package-agreements"

# uninstall Windows Terminal since it's preview version is installed by winget import
Run-ExternalCommand "winget uninstall --id `"Microsoft.WindowsTerminal`""

# remove generated shortcuts
Remove-Item -Path ~\Desktop\*.lnk -Force
# some apps create shortcuts in public desktop
Remove-Item -Path "$env:PUBLIC\Desktop\*.lnk" -Force

# cspell:ignore powertoys
# set PowerToys settings backup directory
# ref: https://github.com/microsoft/PowerToys/blob/29ce15bb8a8b6496fb55e38ec72f746a3a4f9afa/src/settings-ui/Settings.UI.Library/SettingsBackupAndRestoreUtils.cs#L391
$powertoys_backup_dir = "\\wsl.localhost\$distribution\home\$wsl_username\ghq\github.com\risu729\dotfiles\win\powertoys"
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
Run-ExternalCommand "wsl /usr/bin/env bash -ic `"source ~/.bashrc; ~/ghq/github.com/risu729/dotfiles/wsl/setup-git.ts`""
