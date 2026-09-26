# Run in native Windows PowerShell 5.1. Uses real mise and a fake winget.exe.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repo = Split-Path $PSScriptRoot -Parent
$fixture = Join-Path ([IO.Path]::GetTempPath()) "dotfiles-winget-$([guid]::NewGuid())"
New-Item -ItemType Directory -Path $fixture | Out-Null
$originalPath = $env:PATH
$originalEnv = $env:MISE_ENV
$originalYes = $env:MISE_YES
$originalGlobal = $env:MISE_GLOBAL_CONFIG_FILE

function Assert-True([bool]$Condition, [string]$Message) {
	if (-not $Condition) { throw $Message }
}

try {
	Add-Type -Path "$PSScriptRoot/fixtures/winget.cs" -OutputAssembly "$fixture/winget.exe" -OutputType ConsoleApplication
	$env:PATH = "$fixture;$env:PATH"
	$env:WINGET_TEST_LOG = "$fixture/calls.log"
	$env:MISE_ENV = 'apps,personal'
	$env:MISE_YES = '1'
	$env:MISE_GLOBAL_CONFIG_FILE = "$fixture/poison.toml"
	@'
[bootstrap.packages]
"winget:Must.Not.Run" = "latest"
[hooks]
enter = "exit 99"
'@ | Set-Content $env:MISE_GLOBAL_CONFIG_FILE
	$script = "$repo/win/packages.ps1"
	$expected = @('CrystalDewWorld.CrystalDiskInfo.AoiEdition', 'GIMP.GIMP.Nightly', 'Inkscape.Inkscape', 'Microsoft.Edit')

	& $script -Action Status
	$lines = @(Get-Content $env:WINGET_TEST_LOG)
	Assert-True ($lines.Count -eq 22) 'Status must inspect all 22 apps, excluding global/Unix configs.'
	Assert-True (@($lines | Where-Object { $_ -notlike 'list *' }).Count -eq 0) 'Status mutated WinGet.'
	Assert-True ($env:MISE_ENV -eq 'apps,personal') 'Environment was not restored.'
	Assert-True ($env:MISE_GLOBAL_CONFIG_FILE -eq "$fixture/poison.toml") 'Config override leaked.'

	Clear-Content $env:WINGET_TEST_LOG
	& $script -Action Apply
	Assert-True (@(Get-Content $env:WINGET_TEST_LOG | Where-Object { $_ -notlike 'list *' }).Count -eq 0) 'Apply changed installed apps, including newer ones.'

	$env:WINGET_TEST_MISSING = 'Google.Chrome.Beta'
	Clear-Content $env:WINGET_TEST_LOG
	& $script -Action Apply -DryRun
	Assert-True (@(Get-Content $env:WINGET_TEST_LOG | Where-Object { $_ -notlike 'list *' }).Count -eq 0) 'Dry-run mutated WinGet.'
	& $script -Action Apply
	$installs = @(Get-Content $env:WINGET_TEST_LOG | Where-Object { $_ -like 'install *' })
	Assert-True ($installs.Count -eq 1 -and $installs[0] -like 'install --id Google.Chrome.Beta --exact *') 'Missing self-updating app was not installed exactly once.'
	Remove-Item Env:WINGET_TEST_MISSING

	Clear-Content $env:WINGET_TEST_LOG
	& $script -Action Upgrade -DryRun
	Assert-True (@(Get-Content $env:WINGET_TEST_LOG | Where-Object { $_ -notlike 'list *' }).Count -eq 0) 'Upgrade dry-run mutated WinGet.'
	Clear-Content $env:WINGET_TEST_LOG
	& $script -Action Upgrade
	$upgrades = @(Get-Content $env:WINGET_TEST_LOG | Where-Object { $_ -like 'upgrade *' })
	Assert-True ($upgrades.Count -eq 4) 'Upgrade must target exactly four managed apps.'
	foreach ($id in $expected) {
		Assert-True (@($upgrades | Where-Object { $_ -like "upgrade --id $id --exact *" }).Count -eq 1) "Wrong upgrade target: $id"
	}
	Assert-True (@($upgrades | Where-Object { $_ -match '--all|--force|--version|--include-unknown' }).Count -eq 0) 'Unsafe upgrade flags.'

	# Reproduce upstream's case-sensitive row parsing, despite WinGet's
	# case-insensitive ID matching. The real config uses canonical casing.
	Copy-Item $script "$fixture/packages.ps1"
	(Get-Content "$repo/win/mise.toml" -Raw).Replace('Tailscale.Tailscale', 'tailscale.tailscale') |
		Set-Content "$fixture/mise.toml"
	$caseFailed = $false
	try { & "$fixture/packages.ps1" -Action Status } catch { $caseFailed = $true }
	Assert-True $caseFailed 'Upstream now handles case differences; revisit the documented workaround.'

	$env:WINGET_TEST_FAIL = '1'
	$failed = $false
	try { & $script -Action Apply } catch { $failed = $true }
	Assert-True $failed 'A WinGet failure was swallowed.'
	Assert-True ($env:MISE_ENV -eq 'apps,personal') 'Environment leaked after failure.'
	Write-Output 'PASS: native mise policy, isolation, adoption, dry-run and failure propagation (fake WinGet).'
}
finally {
	$env:PATH = $originalPath
	$env:MISE_ENV = $originalEnv
	$env:MISE_YES = $originalYes
	$env:MISE_GLOBAL_CONFIG_FILE = $originalGlobal
	Remove-Item Env:WINGET_TEST_LOG, Env:WINGET_TEST_FAIL, Env:WINGET_TEST_MISSING -ErrorAction SilentlyContinue
	Remove-Item $fixture -Recurse -Force
}
