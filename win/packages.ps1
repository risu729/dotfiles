# Compatible with Windows PowerShell 5.1 and PowerShell 7.
[CmdletBinding()]
param(
	[ValidateSet('Apply', 'Status', 'Upgrade')]
	[string]$Action = 'Status',
	[switch]$DryRun,
	[switch]$BootstrapMise
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$InformationPreference = 'Continue'

function Invoke-WindowsPackage {
	[CmdletBinding()]
	param(
		[ValidateSet('Apply', 'Status', 'Upgrade')]
		[string]$Action,
		[switch]$DryRun,
		[switch]$BootstrapMise
	)

	if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
		throw 'Run this script in native Windows PowerShell, not WSL.'
	}
	if ($BootstrapMise -and ($Action -ne 'Apply' -or $DryRun)) {
		throw '-BootstrapMise is only allowed with Apply without -DryRun.'
	}
	if ($DryRun -and $Action -eq 'Status') {
		throw 'Status is already read-only; omit -DryRun.'
	}
	if (-not (Get-Command winget.exe -CommandType Application -ErrorAction SilentlyContinue)) {
		throw 'winget.exe is required. Install/update App Installer, then reopen PowerShell.'
	}

	if (-not (Get-Command mise.exe -CommandType Application -ErrorAction SilentlyContinue)) {
		# WinGet portable aliases may have been added since this shell started.
		$env:PATH += ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine') +
		';' + [Environment]::GetEnvironmentVariable('Path', 'User')
	}
	if (-not (Get-Command mise.exe -CommandType Application -ErrorAction SilentlyContinue)) {
		if (-not $BootstrapMise) {
			throw 'Native mise.exe is required. See win/README.md for the bootstrap command.'
		}
		& winget.exe install --id jdx.mise --exact --source winget --no-upgrade --silent `
			--accept-source-agreements --accept-package-agreements --disable-interactivity
		# WinGet also returns this no-op code when mise is already installed.
		if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne -1978335189) {
			throw "WinGet mise bootstrap failed (exit $LASTEXITCODE)."
		}
		$env:PATH += ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine') +
		';' + [Environment]::GetEnvironmentVariable('Path', 'User')
	}
	if (-not (Get-Command mise.exe -CommandType Application -ErrorAction SilentlyContinue)) {
		throw 'mise.exe is still missing from PATH. Reopen PowerShell and rerun; no apps were changed.'
	}

	# Global/system overrides prevent other package declarations from entering an
	# upgrade. A unique project filename prevents loading the Unix parent config.
	# Restore all process settings even if mise fails; do not persist any of them.
	$config = Join-Path $PSScriptRoot 'mise.toml'
	$settings = @{
		MISE_GLOBAL_CONFIG_FILE = $config
		MISE_SYSTEM_CONFIG_FILE = $config
		MISE_OVERRIDE_CONFIG_FILENAMES = "dotfiles-$([guid]::NewGuid()).toml"
		MISE_OVERRIDE_TOOL_VERSIONS_FILENAMES = 'none'
		MISE_AUTO_ENV = '0'
		MISE_ENV = 'apps'
		MISE_AUTO_UPDATE = '0'
		MISE_NO_CONFIG = '0'
	}
	if ($Action -eq 'Upgrade') {
		$settings.MISE_ENV = 'managed'
	}
	$previous = @{}
	try {
		foreach ($name in $settings.Keys) {
			$previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
			[Environment]::SetEnvironmentVariable($name, $settings[$name], 'Process')
		}
		$version = & mise.exe --version
		if ($LASTEXITCODE -ne 0 -or $version -notmatch '^(\d+\.\d+\.\d+)') {
			throw 'Cannot determine the native mise version.'
		}
		if ([version]$Matches[1] -lt [version]'2026.9.3') {
			throw 'mise 2026.9.3+ is required. Upgrade mise explicitly; this script will not upgrade it.'
		}

		$miseArgs = @('--no-hooks', '--no-env', 'bootstrap', 'packages', $Action.ToLowerInvariant(), '--manager', 'winget')
		if ($DryRun) {
			$miseArgs += '--dry-run'
		}
		if ($Action -eq 'Apply') {
			$miseArgs += '--yes'
		}
		# Upgrade deliberately retains mise's confirmation prompt.
		Write-Information "Windows packages: $Action (environment: $($settings.MISE_ENV))."
		& mise.exe @miseArgs
		if ($LASTEXITCODE -ne 0) {
			throw "mise packages $Action failed (exit $LASTEXITCODE). See win/README.md."
		}
	}
	finally {
		foreach ($name in $previous.Keys) {
			[Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process')
		}
	}
}

if ($MyInvocation.InvocationName -ne '.') {
	Invoke-WindowsPackage -Action $Action -DryRun:$DryRun -BootstrapMise:$BootstrapMise
}
