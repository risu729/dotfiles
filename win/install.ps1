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
Checks if the script is running with elevated privileges (Administrator).
If not, it restarts the script with elevated privileges.
If already elevated, it continues execution.

.PARAMETER ScriptOrigin
The base URL for the setup script.

.PARAMETER GitRef
The Git reference (branch or tag) to use for the setup script.
#>
function Invoke-ElevatedScript {
	[CmdletBinding()]
	param(
		[Parameter(Mandatory = $true)]
		[string]$ScriptOrigin,

		[Parameter(Mandatory = $true)]
  		[AllowEmptyString()]
		[string]$GitRef
	)

	$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
	if ($isAdmin) {
		return
	}

	Write-Host "Administrator privileges required. Restarting script with administrator privileges..."

	$winScriptUrl = [System.UriBuilder]::new($ScriptOrigin)
	$winScriptUrl.Path = "/win"
	if ($GitRef -ne "") {
		$winScriptUrl.Query = "ref=$GitRef"
	}
	# Wait for the user to press Enter before closing the elevated PowerShell window
	$command = "try { Invoke-RestMethod $($winScriptUrl.ToString()) | Invoke-Expression } catch { `$PSItem } finally { Read-Host -Prompt 'Press Enter to exit' }"
	Write-Host $command
	Start-Process powershell -Verb RunAs -ArgumentList "-NoExit -NoProfile -Command `"$command`""

	# Exit the current non-elevated process
	exit
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
		[Parameter(Mandatory = $true)]
		[string]$Command
	)

	Invoke-Expression $Command
	# cspell:ignore LASTEXITCODE
	$exitCode = $LASTEXITCODE
	if ($exitCode -ne 0) {
		throw "Command failed with exit code ${exitCode}: $Command"
	}
}

<#
.SYNOPSIS
Runs a command in WSL and returns the output.

.PARAMETER Command
The command string to execute in WSL.

.PARAMETER Root
If true, the command is executed as root.
If false, the command is executed as the default user.

.PARAMETER Interactive
If true, the command is executed in interactive mode.

.NOTES
The command is executed with /usr/bin/env bash -c.
#>
function Invoke-WSLCommand {
	[CmdletBinding()]
	param (
		[Parameter(Mandatory = $true)]
		[string]$Command,

		[Parameter(Mandatory = $false)]
		[switch]$Root,

		[Parameter(Mandatory = $false)]
		[switch]$Interactive
	)

	$bashArg = "-c `"$Command`""
	$bashArg = if ($Interactive) { "-i $bashArg" } else { $bashArg }
	$wslArg = "--exec /usr/bin/env bash $bashArg"
	$wslArg = if ($Root) { "--user root $wslArg" } else { $wslArg }
	Invoke-ExternalCommand "wsl $wslArg"
}

<#
.SYNOPSIS
Prompts the user for a password and confirms it.

.OUTPUTS
Returns the confirmed password as a plain text string.
#>
function Read-Password {
	[CmdletBinding()]
	param ()

	while ($true) {
		Write-Host "Enter password:"
		# Use -AsSecureString to mask input
		$passwordSecure = Read-Host -AsSecureString
		$password = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto([System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($passwordSecure))

		if ($null -eq $password -or [string]::IsNullOrEmpty($password)) {
			Write-Warning "Password cannot be empty. Try again."
			continue
		}

		Write-Host "Re-enter password:"
		$confirmPasswordSecure = Read-Host -AsSecureString
		$confirmPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto([System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($confirmPasswordSecure))

		# if doesn't match, prompt again
		if ($password -ne $confirmPassword) {
			Write-Warning "Passwords do not match. Try again."
			continue
		}

		return $password
	}
}

<#
.SYNOPSIS
Creates a new user in the WSL distribution.

.PARAMETER Distribution
The name of the WSL distribution to create the user in.

.PARAMETER Username
The username for the new WSL user.

.PARAMETER Password
The plain text password for the new user.
#>
function New-WslUser {
	[CmdletBinding()]
	[Diagnostics.CodeAnalysis.SuppressMessageAttribute("PSAvoidUsingPlainTextForPassword", "", Justification = "chpasswd requires plain text password")]
	param(
		[Parameter(Mandatory = $true)]
		[string]$Distribution,

		[Parameter(Mandatory = $true)]
		[string]$Username,

		[Parameter(Mandatory = $true)]
		[string]$Password
	)

	# No need to check the duplicate username because useradd will fail if it exists
	Invoke-WSLCommand -Root -Command "useradd --create-home $Username"
	Invoke-WSLCommand -Root -Command "echo ${Username}:$Password | chpasswd"
	# cspell:ignore usermod
	Invoke-WSLCommand -Root -Command "usermod --append --groups sudo $Username"

	Write-Host "User '$Username' created in WSL distribution '$Distribution'."
}

<#
.SYNOPSIS
Sets up WSL.
#>
function Install-Wsl {
	[CmdletBinding()]
	param()

	Invoke-ExternalCommand "wsl --install --no-distribution"
	Invoke-ExternalCommand "wsl --set-default-version 2"
	Invoke-ExternalCommand "wsl --update --pre-release"
}

<#
.SYNOPSIS
Sets up the WSL distribution.

.PARAMETER Distribution
The name of the WSL distribution to install (e.g., "Ubuntu-24.04").

.PARAMETER Username
The username for the new WSL user.

.NOTES
Requires user interaction for password input.
Fails if the distribution is already installed.
#>
function Install-WslDistribution {
	[CmdletBinding()]
	param (
		[Parameter(Mandatory = $true)]
		[string]$Distribution,

		[Parameter(Mandatory = $true)]
		[string]$Username
	)

	# Use no-launch not to require Ctrl+D afterwards
	Invoke-ExternalCommand "wsl --install --distribution `"$Distribution`" --no-launch"
	Invoke-ExternalCommand "wsl --set-default `"$Distribution`""

	# no-launch skips user creation, so we need to create it manually
	# ref: https://github.com/microsoft/WSL/issues/10386
	$password = Read-Password
	New-WslUser -Distribution $Distribution -Username $Username -Password $password
	# Set the default user to the created user
	Invoke-ExternalCommand "wsl --manage `"$Distribution`" --set-default-user `"$Username`""
}

<#
.SYNOPSIS
Runs a setup script in WSL.

.PARAMETER ScriptOrigin
The base URL for the setup script to be executed in WSL.

.PARAMETER GitRef
The Git reference (branch or tag) to use for the setup script.
#>
function Invoke-WslSetupScript {
	[CmdletBinding()]
	param(
		[Parameter(Mandatory = $true)]
		[string]$ScriptOrigin,

		[Parameter(Mandatory = $true)]
    		[AllowEmptyString()]
		[string]$GitRef
	)

	$wslScriptUrl = [System.UriBuilder]::new($ScriptOrigin)
	$wslScriptUrl.Path = "/wsl"
	if ($GitRef -ne "") {
		$wslScriptUrl.Query = "ref=$GitRef"
	}
	Invoke-WSLCommand -Command "SKIP_GIT_SETUP=true bash <(curl -fsSL $($wslScriptUrl.ToString()))"
}

<#
.SYNOPSIS
Imports winget packages from a JSON file.

.PARAMETER DotfilesPath
The path to the dotfiles repository on the WSL filesystem starting with `\\wsl.localhost`.

.NOTES
Requires access to the WSL filesystem via \\wsl.localhost.
#>
function Import-WingetPackages {
	[CmdletBinding()]
	param(
		[Parameter(Mandatory = $true)]
		[string]$DotfilesPath
	)

	$wingetConfigFile = "$DotfilesPath\win\winget.json"
	Invoke-ExternalCommand "winget import --import-file `"$wingetConfigFile`" --disable-interactivity --accept-package-agreements"
	Write-Host "winget packages imported successfully."

	# Remove the generated shortcuts from the desktop
	Remove-Item -Path "$([Environment]::GetFolderPath('Desktop'))\*.lnk" -Force -ErrorAction SilentlyContinue
	# Some apps create shortcuts in the public desktop
	Remove-Item -Path "$env:PUBLIC\Desktop\*.lnk" -Force -ErrorAction SilentlyContinue
}

<#
.SYNOPSIS
Configures the PowerToys settings backup directory to a WSL path.

.PARAMETER DotfilesPath
The path to the dotfiles repository on the WSL filesystem starting with `\\wsl.localhost`.

.NOTES
Requires access to the WSL filesystem via \\wsl.localhost.
This function only sets the registry key for PowerToys settings backup directory.
It does not restore the settings from the backup.
#>
# cspell:ignore powertoys
function Set-PowerToysBackupDirectory {
	[CmdletBinding()]
	param(
		[Parameter(Mandatory = $true)]
		[string]$DotfilesPath
	)
	$powertoys_backup_dir = "$DotfilesPath\win\powertoys"
	# cspell:ignore HKCU
	# Use -Force in case the key/value doesn't exist
	# ref: https://github.com/microsoft/PowerToys/blob/75121ca7f3491f769423ba2c141934d6b5402de8/src/settings-ui/Settings.UI.Library/SettingsBackupAndRestoreUtils.cs#L392
	Set-ItemProperty -Path HKCU:Software\Microsoft\PowerToys -Name SettingsBackupAndRestoreDir -Value "$powertoys_backup_dir" -Force

	# Delete existing PowerToys backup directory in Documents
	Remove-Item -Path "$([Environment]::GetFolderPath('MyDocuments'))\PowerToys" -Recurse -Force -ErrorAction SilentlyContinue
	Write-Host "PowerToys settings backup directory configured."
}

<#
.SYNOPSIS
Sets the WSLENV environment variable to share environment variables between Windows and WSL.
#>
function Set-WSLENV {
	[CmdletBinding()]
	param()

	# cspell:ignore WSLENV PATHEXT
	# Set WSLENV to share PATHEXT between Windows and WSL
	# ref: https://learn.microsoft.com/en-us/windows/wsl/filesystems#share-environment-variables-between-windows-and-wsl-with-wslenv
	[System.Environment]::SetEnvironmentVariable("WSLENV", "PATHEXT", [System.EnvironmentVariableTarget]::User)
}

<#
.SYNOPSIS
Runs a git setup script in WSL.

.PARAMETER RepoName
The name of the dotfiles repository to set up in WSL.

.NOTES
Requires a browser in Windows to be installed.
#>
function Invoke-GitSetupInWsl {
	[CmdletBinding()]
	param(
		[Parameter(Mandatory = $true)]
		[string]$RepoName
	)

	# source .bashrc is required to update PATH
	Invoke-WSLCommand -Interactive -Command "source ~/.bashrc; ~/ghq/github.com/$RepoName/wsl/setup-git.ts"
}

# ===== Main Script Execution =====

# must be edited by the worker to use the same script as requested by the user
$scriptOrigin = ""
# must be edited by the worker to use the correct GitHub repository
$repoName = ""
# might be edited by the worker to use a specific ref
$gitRef = ""
$wslDistribution = "Ubuntu-24.04"
$wslUsername = $env:USERNAME

$repoWindowsPath = $repoName -replace '/', '\'
$dotfilesPath = "\\wsl.localhost\$wslDistribution\home\$wslUsername\ghq\github.com\$repoWindowsPath"

Test-MinimumWindowsVersion -MinimumBuild 26100 -RequiredDisplayVersionString "24H2"

Invoke-ElevatedScript -ScriptOrigin $scriptOrigin -GitRef $gitRef

Install-Wsl

Install-WslDistribution -Distribution $wslDistribution -Username $wslUsername

Invoke-WslSetupScript -ScriptOrigin $scriptOrigin -GitRef $gitRef

Import-WingetPackages -DotfilesPath $dotfilesPath

Set-PowerToysBackupDirectory -DotfilesPath $dotfilesPath

Set-WSLENV

# Requires a browser in Windows to be installed, so run in the end
Invoke-GitSetupInWsl -RepoName $repoName
