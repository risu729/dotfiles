# Disposable native Windows runner only. Installs Microsoft.Edit, not all apps.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repo = Split-Path $PSScriptRoot -Parent
$fixture = Join-Path ([IO.Path]::GetTempPath()) "dotfiles-winget-real-$([guid]::NewGuid())"
New-Item -ItemType Directory -Path $fixture | Out-Null
try {
	Copy-Item "$repo/win/packages.ps1" "$fixture/packages.ps1"
	@'
min_version = "2026.9.3"
[settings]
experimental = true
[bootstrap.packages]
"winget:Microsoft.Edit" = { os = "windows" }
'@ | Set-Content "$fixture/mise.toml"
	'[bootstrap.packages]' | Set-Content "$fixture/mise.apps.toml"
	& winget.exe --version
	if ($LASTEXITCODE -ne 0) { throw 'WinGet unavailable.' }
	# Read-only dry runs deliberately cannot accept source agreements. Accept
	# them explicitly once on this disposable runner without installing an app.
	& winget.exe list --id Microsoft.Edit --exact --accept-source-agreements --disable-interactivity
	if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne -1978335212) { throw 'WinGet sources unavailable.' }
	& "$fixture/packages.ps1" -Action Apply -DryRun
	& "$fixture/packages.ps1" -Action Apply
	& "$fixture/packages.ps1" -Action Apply
	& "$fixture/packages.ps1" -Action Status
	& "$fixture/packages.ps1" -Action Upgrade -DryRun
	& winget.exe list --id Microsoft.Edit --exact --source winget --disable-interactivity
	if ($LASTEXITCODE -ne 0) { throw 'Microsoft.Edit was not installed.' }
	Write-Output 'PASS: real WinGet install, rerun, status and upgrade dry-run for Microsoft.Edit.'
	if ($PSVersionTable.PSVersion.Major -eq 5) {
		# Query/preview the complete inventory, without installing the other apps.
		& "$repo/win/packages.ps1" -Action Status
		& "$repo/win/packages.ps1" -Action Apply -DryRun
		& "$repo/win/packages.ps1" -Action Upgrade -DryRun
		Write-Output 'PASS: full inventory status and dry runs with real WinGet.'
	}
}
finally {
	Remove-Item $fixture -Recurse -Force
}
