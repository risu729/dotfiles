#!/usr/bin/env bats
# shellcheck shell=bash
# Bats supplies test paths and captured output.
# Each Bats test has its own environment; doctor messages contain literal backticks.
# shellcheck disable=SC2154,SC2030,SC2031,SC2016

setup() {
	bats_require_minimum_version 1.7.0
	root=$(cd "${BATS_TEST_DIRNAME}/.." && pwd)
	mkdir "${BATS_TEST_TMPDIR}/bin"
	cat >"${BATS_TEST_TMPDIR}/bin/mise" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
if [[ $* == 'tool usage --json' ]]; then
  printf '%s\n' "${DOCTOR_TOOL}"
  exit 0
fi
[[ $* == 'doctor --json' ]]
printf '%s\n' "${DOCTOR_REPORT}"
exit "${DOCTOR_STATUS}"
STUB
	chmod +x "${BATS_TEST_TMPDIR}/bin/mise"
	export PATH="${BATS_TEST_TMPDIR}/bin:${PATH}"
	export DOCTOR_REPORT='{"warnings":[],"errors":[]}' DOCTOR_STATUS=0
}

@test "mise diagnostics accept a clean report" {
	run -0 bash "${root}/tasks/verify/mise-doctor"
	[[ -z ${output} ]]
}

@test "mise diagnostics reject warnings even when doctor exits successfully" {
	run ! env DOCTOR_REPORT='{"warnings":["warning fixture"],"errors":[]}' bash "${root}/tasks/verify/mise-doctor"
	[[ ${output} == 'warning fixture' ]]
}

@test "mise diagnostics reject errors even when doctor exits successfully" {
	run ! env DOCTOR_REPORT='{"warnings":[],"errors":["error fixture"]}' bash "${root}/tasks/verify/mise-doctor"
	[[ ${output} == 'error fixture' ]]
}

@test "mise diagnostics propagate command failure and print its report" {
	run ! env DOCTOR_STATUS=2 bash "${root}/tasks/verify/mise-doctor"
	[[ ${output} == "${DOCTOR_REPORT}" ]]
}

@test "mise diagnostics reject malformed JSON" {
	run ! env DOCTOR_REPORT='not json' bash "${root}/tasks/verify/mise-doctor"
}

@test "mise diagnostics allow only the effective lazy tool's missing error" {
	export DOCTOR_REPORT='{"toolset":{"usage":[{"version":"0.0.0","missing":true}]},"errors":["tool aqua:jdx/usage@0.0.0 is not installed, install with `mise install`"]}'
	export DOCTOR_TOOL='{"backend":"aqua:jdx/usage","active_versions":["0.0.0"],"tool_options":{"lazy":true}}' DOCTOR_STATUS=1
	run -0 bash "${root}/tasks/verify/mise-doctor"
	[[ -z ${output} ]]
	export DOCTOR_TOOL='{"backend":"aqua:jdx/usage","active_versions":["0.0.0"],"tool_options":{"lazy":false}}'
	run ! bash "${root}/tasks/verify/mise-doctor"
	[[ ${output} == *'is not installed'* ]]
}

@test "lazy allowance never hides other doctor warnings or broken installs" {
	export DOCTOR_REPORT='{"warnings":["warning fixture"],"toolset":{"usage":[{"version":"0.0.0","missing":true}]},"errors":["tool aqua:jdx/usage@0.0.0 is not installed, install with `mise install`","broken install"]}'
	export DOCTOR_TOOL='{"backend":"aqua:jdx/usage","active_versions":["0.0.0"],"tool_options":{"lazy":true}}' DOCTOR_STATUS=1
	run ! bash "${root}/tasks/verify/mise-doctor"
	[[ ${output} == $'warning fixture\nbroken install' ]]
}
