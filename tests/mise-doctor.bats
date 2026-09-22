#!/usr/bin/env bats
# shellcheck shell=bash
# Bats supplies test paths and captured output.
# shellcheck disable=SC2154

setup() {
	bats_require_minimum_version 1.7.0
	root=$(cd "${BATS_TEST_DIRNAME}/.." && pwd)
	mkdir "${BATS_TEST_TMPDIR}/bin"
	cat >"${BATS_TEST_TMPDIR}/bin/mise" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
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
