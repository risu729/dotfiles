# Compatible with the pre-installed Windows PowerShell 5.1.
<#
.SYNOPSIS
Keeps new projectless Codex chats outside the Windows Documents backup.
.DESCRIPTION
Uses Codex's single-key config writer, preserving other settings and credentials.
Existing chats, CODEX_HOME, project folders and Drive backup settings are unchanged.
Requires the native Codex CLI supplied by the desktop app on PATH.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$workspaceRoot = Join-Path ([Environment]::GetFolderPath('UserProfile')) 'Codex'
$settingKey = 'desktop.projectlessWorkspaceRoot'

if (-not $PSCmdlet.ShouldProcess($workspaceRoot, 'Set the default folder for new projectless Codex chats')) {
	return
}

# Reject junctions/symlinks before creating or using the destination.
$ancestor = $workspaceRoot
while ($ancestor) {
	if (Test-Path -LiteralPath $ancestor) {
		$item = Get-Item -LiteralPath $ancestor -Force
		if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
			throw 'The Codex workspace folder must not traverse a reparse point.'
		}
		if (-not $item.PSIsContainer) {
			throw 'The Codex workspace path must be a directory.'
		}
	}

	$ancestor = Split-Path -Path $ancestor -Parent
}

$codex = Get-Command codex.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1
$startInfo = New-Object System.Diagnostics.ProcessStartInfo
$startInfo.FileName = $codex.Source
$startInfo.Arguments = 'app-server --listen stdio://'
$startInfo.UseShellExecute = $false
$startInfo.CreateNoWindow = $true
$startInfo.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
$startInfo.RedirectStandardInput = $true
$startInfo.RedirectStandardOutput = $true
$startInfo.RedirectStandardError = $true
$startInfo.StandardOutputEncoding = New-Object System.Text.UTF8Encoding($false)
$startInfo.StandardErrorEncoding = New-Object System.Text.UTF8Encoding($false)
$process = New-Object System.Diagnostics.Process
$process.StartInfo = $startInfo
$started = $false

function Invoke-CodexConfigRequest {
	[CmdletBinding()]
	param(
		[Parameter(Mandatory = $true)] [int]$Id,
		[Parameter(Mandatory = $true)] [string]$Method,
		[Parameter(Mandatory = $true)] [hashtable]$RequestParams
	)

	$request = @{ id = $Id; method = $Method; params = $RequestParams } | ConvertTo-Json -Depth 20 -Compress
	$process.StandardInput.WriteLine($request)
	$process.StandardInput.Flush()
	$deadline = [DateTime]::UtcNow.AddSeconds(30)
	while ([DateTime]::UtcNow -lt $deadline) {
		$read = $process.StandardOutput.ReadLineAsync()
		$remaining = [int][Math]::Max(1, ($deadline - [DateTime]::UtcNow).TotalMilliseconds)
		if (-not $read.Wait($remaining)) {
			throw 'Codex configuration request timed out.'
		}
		if ($null -eq $read.Result) {
			throw 'Codex exited before returning the configuration response.'
		}
		$response = $read.Result | ConvertFrom-Json
		if ($response.PSObject.Properties['id'] -and $response.id -eq $Id) {
			if ($response.PSObject.Properties['error']) {
				# Do not print server/config payloads, which can contain private data.
				throw "Codex rejected configuration request '$Method'."
			}
			return $response.result
		}
	}
	throw 'Codex configuration request timed out.'
}

try {
	$null = $process.Start()
	$started = $true
	# Drain stderr without forwarding private server diagnostics to installer output.
	$stderr = $process.StandardError.ReadToEndAsync()
	$null = Invoke-CodexConfigRequest -Id 1 -Method initialize -RequestParams @{
		clientInfo = @{ name = 'risu_dotfiles'; title = 'Windows dotfiles'; version = '1.0.0' }
	}
	$process.StandardInput.WriteLine('{"method":"initialized","params":{}}')
	$process.StandardInput.Flush()
	$written = Invoke-CodexConfigRequest -Id 2 -Method 'config/value/write' -RequestParams @{
		keyPath = $settingKey
		value = $workspaceRoot
		mergeStrategy = 'replace'
	}
	if ($written.status -ne 'ok') {
		throw 'A higher-priority configuration overrides the Codex workspace setting.'
	}
	$readBack = Invoke-CodexConfigRequest -Id 3 -Method 'config/read' -RequestParams @{ includeLayers = $false }
	if ($readBack.config.desktop.projectlessWorkspaceRoot -ne $workspaceRoot) {
		throw 'Codex workspace configuration readback did not match.'
	}
	$null = New-Item -ItemType Directory -Path $workspaceRoot -Force
	[PSCustomObject]@{ Setting = $settingKey; Value = $workspaceRoot; ConfigPath = $written.filePath }
}
finally {
	if ($started) {
		$process.StandardInput.Close()
		if (-not $process.WaitForExit(5000)) {
			$process.Kill()
		}
		$null = $stderr.GetAwaiter().GetResult()
	}
	$process.Dispose()
}
