@{
	# ref: https://learn.microsoft.com/en-us/powershell/utility-modules/psscriptanalyzer/rules/readme
	Rules = @{
		PSAvoidExclaimOperator = @{
			Enable = $true
		}

		PSAvoidLongLines = @{
			# Disable because there are no ways to suppress this rule
			# ref: https://github.com/PowerShell/PSScriptAnalyzer/issues/1957
			Enable = $false
		}

		PSAvoidSemicolonsAsLineTerminators = @{
			Enable = $true
		}

		PSAvoidUsingDoubleQuotesForConstantString = @{
			Enable = $true
		}

		PSPlaceCloseBrace = @{
			Enable = $true
			NoEmptyLineBefore = $true
		}

		PSPlaceOpenBrace = @{
			Enable = $true
		}

		PSUseCompatibleCommands = @{
			Enable = $true
			TargetProfiles = @(
				# Windows 10 Pro, PowerShell 5.1
				'win-48_x64_10.0.17763.0_5.1.17763.316_x64_4.0.30319.42000_framework'
				# Windows 10.0.18362, PowerShell 7.0
				'win-4_x64_10.0.18362.0_7.0.0_x64_3.1.2_core'
			)
		}

		PSUseCompatibleSyntax = @{
			Enable = $true

			TargetVersions = @(
				# Pre-installed version
				'5.1'
				# Latest version
				'7.0'
			)
		}

		PSUseCompatibleTypes = @{
			Enable = $true
			TargetProfiles = @(
				# Windows 10 Pro, PowerShell 5.1
				'win-48_x64_10.0.17763.0_5.1.17763.316_x64_4.0.30319.42000_framework'
				# Windows 10.0.18362, PowerShell 7.0
				'win-4_x64_10.0.18362.0_7.0.0_x64_3.1.2_core'
			)
		}

		PSUseConsistentIndentation = @{
			Enable = $true
			Kind = 'tab'
		}

		PSUseConsistentWhitespace = @{
			Enable = $true
			CheckPipeForRedundantWhitespace = $true
			CheckParameter = $true
		}

		PSUseCorrectCasing = @{
			Enable = $true
		}
	}
}
