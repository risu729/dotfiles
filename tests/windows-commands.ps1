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
$names = @('Invoke-ExternalCommand', 'Invoke-WSLExecutable', 'Invoke-WSLCommand', 'Install-Wsl')
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
ConvertTo-Json -Compress -InputObject @($args | Select-Object -Skip 1)
exit $code
'@
	$executable = (Get-Process -Id $PID).Path
	$payload = @('path with spaces', 'literal;semicolon', '$(throw unexpected)', 'owner/repo')
	$output = Invoke-ExternalCommand -FilePath $executable -ArgumentList (@('-NoProfile', '-File', $receiver, '0') + $payload)
	Assert-Argument -Actual (ConvertFrom-Json $output) -Expected $payload
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
function Invoke-ExternalCommand {
	param([string]$FilePath, [string[]]$ArgumentList)
	$calls.Add(@($FilePath) + $ArgumentList)
	return 'fixture output'
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

Write-Output 'Windows command construction checks passed.'
