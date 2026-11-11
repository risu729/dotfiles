# Exercise command construction without running the installer or changing a machine.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$installer = Join-Path $PSScriptRoot '../win/install.ps1'
$tokens = $null
$parseErrors = $null
$tree = [System.Management.Automation.Language.Parser]::ParseFile($installer, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -ne 0) {
	throw 'Windows installer did not parse.'
}

# Load only these function definitions, never the installer's top-level statements.
$names = @(
	'Invoke-ExternalCommand', 'Invoke-WSLExecutable', 'Invoke-WSLCommand',
	'Test-WslDistributionInstalled', 'Install-Wsl', 'Install-WslDistribution',
	'Import-WingetPackagesFile'
)
foreach ($name in $names) {
	$definition = $tree.Find({
			param($node)
			$node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
		}, $false)
	if ($null -eq $definition) {
		throw "Missing function: $name"
	}
	. ([scriptblock]::Create($definition.Extent.Text))
}

function Assert-Argument {
	param([object[]]$Actual, [object[]]$Expected)
	$actualJson = ConvertTo-Json -Compress -InputObject @($Actual)
	$expectedJson = ConvertTo-Json -Compress -InputObject @($Expected)
	if ($actualJson -cne $expectedJson) {
		throw "Arguments differ: $actualJson; expected $expectedJson"
	}
}

# A real child PowerShell process proves arguments survive native invocation.
$scratch = Join-Path ([System.IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString())
$receiver = Join-Path $scratch 'argument receiver.ps1'
$null = New-Item -ItemType Directory -Path $scratch
try {
	Set-Content -LiteralPath $receiver -Encoding UTF8 -Value @'
$code = [int]$args[0]
if ($args.Count -gt 1) {
	ConvertTo-Json -Compress -InputObject @($args | Select-Object -Skip 1)
}
exit $code
'@
	$executable = (Get-Process -Id $PID).Path
	# Cover the argument forms used by this installer. Windows PowerShell 5.1
	# still uses legacy native marshalling for empty strings and embedded double quotes.
	$payload = @('path with spaces', 'literal;semicolon', '$(throw unexpected)', 'owner/repo')
	$output = Invoke-ExternalCommand -FilePath $executable -ArgumentList (@('-NoProfile', '-File', $receiver, '0') + $payload)
	Assert-Argument -Actual (ConvertFrom-Json $output) -Expected $payload
	$output = Invoke-ExternalCommand -FilePath $executable -ArgumentList @('-NoProfile', '-File', $receiver, '0')
	if ($null -ne $output) {
		throw 'A successful native command without stdout produced output.'
	}
	$failed = $false
	try {
		$null = Invoke-ExternalCommand -FilePath $executable -ArgumentList @('-NoProfile', '-File', $receiver, '17')
	}
	catch {
		$failed = $_.Exception.Message -like '*exit code 17*'
	}
	if (-not $failed) {
		throw 'A failed native command did not propagate its exit code.'
	}
}
finally {
	Remove-Item -LiteralPath $receiver -Force -ErrorAction SilentlyContinue
	Remove-Item -LiteralPath $scratch -Force
}

# Replace the one native boundary; every WSL entry point below stays inert.
$calls = [System.Collections.Generic.List[object]]::new()
$nativeOutput = 'fixture output'
$failAtCall = 0
function Invoke-ExternalCommand {
	param([string]$FilePath, [string[]]$ArgumentList)
	$calls.Add(@($FilePath) + $ArgumentList)
	if ($failAtCall -gt 0 -and $calls.Count -eq $failAtCall) {
		throw 'Fixture native failure'
	}
	return $nativeOutput
}

$output = Invoke-WSLExecutable -FilePath '/path with spaces/tool' -ArgumentList @('literal;value', '$(not-code)')
if ($output -ne 'fixture output') {
	throw 'WSL output was not preserved.'
}
Assert-Argument -Actual $calls[0] -Expected @('wsl', '--exec', '/path with spaces/tool', 'literal;value', '$(not-code)')

$null = Invoke-WSLExecutable -Root -FilePath '/usr/bin/id'
Assert-Argument -Actual $calls[1] -Expected @('wsl', '--user', 'root', '--exec', '/usr/bin/id')

$null = Invoke-WSLCommand -Interactive -Root -Command 'printf %s "literal value"'
Assert-Argument -Actual $calls[2] -Expected @('wsl', '--user', 'root', '--exec', '/usr/bin/env', 'bash', '-i', '-c', 'printf %s "literal value"')

$null = Install-Wsl
Assert-Argument -Actual $calls[3] -Expected @('wsl', '--install', '--no-distribution')
Assert-Argument -Actual $calls[4] -Expected @('wsl', '--set-default-version', '2')
Assert-Argument -Actual $calls[5] -Expected @('wsl', '--update', '--pre-release')

# A failed install must not continue updating or changing the default version.
$calls.Clear()
$failAtCall = 1
try {
	$null = Install-Wsl
	throw 'Install-Wsl ignored a native failure.'
}
catch {
	if ($_.Exception.Message -ne 'Fixture native failure') { throw }
}
if ($calls.Count -ne 1) { throw 'Install-Wsl continued after a native failure.' }
$failAtCall = 0

# Exercise the migrated list call, including WSL's embedded NULL characters.
$calls.Clear()
$nativeOutput = @('  NAME STATE VERSION', "* U`0b`0u`0n`0t`0u`0-`026.04 Running 2")
if (-not (Test-WslDistributionInstalled -Name 'Ubuntu-26.04')) {
	throw 'The WSL distribution list was not recognized.'
}
Assert-Argument -Actual $calls[0] -Expected @('wsl', '--list', '--verbose')
if (Test-WslDistributionInstalled -Name 'Absent') { throw 'An absent distribution was found.' }
$calls.Clear()
$failAtCall = 1
if (Test-WslDistributionInstalled -Name 'Ubuntu-26.04') { throw 'A failed WSL list command was accepted.' }
$failAtCall = 0

# Load the actual distribution orchestration, but replace user creation itself.
function Test-WslDistributionInstalled {
	param([string]$Name)
	if ($Name -ne 'Fixture Distro') { throw 'Unexpected distribution lookup.' }
	return $distributionInstalled
}
function New-WslUser {
	[Diagnostics.CodeAnalysis.SuppressMessageAttribute(
		'PSUseShouldProcessForStateChangingFunctions', '',
		Justification = 'Fixture records calls without creating a user'
	)]
	[CmdletBinding()]
	param([string]$Distribution, [string]$Username)
	$calls.Add(@('new-user', $Distribution, $Username))
}
$nativeOutput = $null
$distributionInstalled = $false
$calls.Clear()
$null = Install-WslDistribution -Distribution 'Fixture Distro' -Username 'fixture-user'
Assert-Argument -Actual $calls[0] -Expected @('wsl', '--install', '--distribution', 'Fixture Distro', '--no-launch')
Assert-Argument -Actual $calls[1] -Expected @('wsl', '--set-default', 'Fixture Distro')
Assert-Argument -Actual $calls[2] -Expected @('new-user', 'Fixture Distro', 'fixture-user')
Assert-Argument -Actual $calls[3] -Expected @('wsl', '--manage', 'Fixture Distro', '--set-default-user', 'fixture-user')
if ($calls.Count -ne 4) { throw 'Unexpected new-distribution operations.' }

$distributionInstalled = $true
$calls.Clear()
$null = Install-WslDistribution -Distribution 'Fixture Distro' -Username 'fixture-user'
Assert-Argument -Actual $calls[0] -Expected @('wsl', '--set-default', 'Fixture Distro')
if ($calls.Count -ne 1) { throw 'An existing distribution was reinstalled or its user changed.' }

$distributionInstalled = $false
$calls.Clear()
$failAtCall = 2
try {
	$null = Install-WslDistribution -Distribution 'Fixture Distro' -Username 'fixture-user'
	throw 'Distribution setup ignored a native failure.'
}
catch {
	if ($_.Exception.Message -ne 'Fixture native failure') { throw }
}
if ($calls.Count -ne 2) { throw 'Distribution setup continued after a native failure.' }
$failAtCall = 0

# Guard both shortcut-removal boundaries before invoking the real WinGet wrapper.
$removals = [System.Collections.Generic.List[object]]::new()
function Remove-Item {
	[Diagnostics.CodeAnalysis.SuppressMessageAttribute(
		'PSAvoidOverwritingBuiltInCmdlets', '',
		Justification = 'Intercept shortcut removal so the fixture cannot delete host files'
	)]
	[Diagnostics.CodeAnalysis.SuppressMessageAttribute(
		'PSUseShouldProcessForStateChangingFunctions', '',
		Justification = 'Fixture records calls without deleting files'
	)]
	[CmdletBinding()]
	param([string]$Path, [switch]$Force)
	$removals.Add(@($Path, $Force.IsPresent, [string]$PSBoundParameters['ErrorAction']))
}
$calls.Clear()
$dotfilesPath = '\\wsl.localhost\Fixture Distro\home\fixture user\dotfiles'
$null = Import-WingetPackagesFile -DotfilesPath $dotfilesPath
Assert-Argument -Actual $calls[0] -Expected @(
	'winget', 'import', '--import-file', "$dotfilesPath\win\winget.json",
	'--disable-interactivity', '--accept-package-agreements', '--no-upgrade'
)
if ($calls.Count -ne 1) { throw 'Unexpected WinGet operations.' }
Assert-Argument -Actual $removals[0] -Expected @("$([Environment]::GetFolderPath('Desktop'))\*.lnk", $true, 'SilentlyContinue')
Assert-Argument -Actual $removals[1] -Expected @("$env:PUBLIC\Desktop\*.lnk", $true, 'SilentlyContinue')
if ($removals.Count -ne 2) { throw 'Unexpected shortcut operations.' }

$calls.Clear()
$removals.Clear()
$failAtCall = 1
try {
	$null = Import-WingetPackagesFile -DotfilesPath $dotfilesPath
	throw 'WinGet import ignored a native failure.'
}
catch {
	if ($_.Exception.Message -ne 'Fixture native failure') { throw }
}
if ($removals.Count -ne 0) { throw 'Shortcuts were removed after WinGet failed.' }

Write-Output 'Windows command construction checks passed.'
