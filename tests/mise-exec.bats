#!/usr/bin/env bats
# shellcheck shell=bash
# Bats supplies test paths and captured output.
# shellcheck disable=SC2154

setup() {
	bats_require_minimum_version 1.7.0
	cd "${BATS_TEST_DIRNAME}/.." || return
	export MISE_CONFIG_DIR="${BATS_TEST_TMPDIR}/mise"
	export MISE_GLOBAL_CONFIG_FILE="${MISE_CONFIG_DIR}/config.toml"
	export MISE_TRUSTED_CONFIG_PATHS="${PWD}:${MISE_CONFIG_DIR}"
	# Keep the regression offline even if automatic installation is re-enabled.
	export CI=true MISE_OFFLINE=true MISE_ENABLE_TOOLS=usage
	mkdir -p "${MISE_CONFIG_DIR}"
	printf '[tools]\nusage = "0.0.0"\n' >"${MISE_GLOBAL_CONFIG_FILE}"
}

@test "mise exec runs commands with an unavailable global tool" {
	run -0 mise exec -- sh -c 'echo hook-ran'
	[[ ${output} == *'usage@0.0.0'* ]]
	[[ ${output} == *'hook-ran'* ]]
}

@test "mise exec preserves check failures with an unavailable global tool" {
	run -23 mise exec -- sh -c 'echo check-failed; exit 23'
	[[ ${output} == *'check-failed'* ]]
}
