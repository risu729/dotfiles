#!/usr/bin/env bats
# shellcheck shell=bash
# Bats supplies its test directory and captures command output.
# shellcheck disable=SC2030,SC2031,SC2154

setup() {
	bats_require_minimum_version 1.7.0
	root=$(cd "${BATS_TEST_DIRNAME}/.." && pwd)
	export ACCOUNT_ID=account API_TOKEN=token CI_DEPENDABOT=false
	export PR_NUMBER=123 EXPECTED_HEAD=current
	export GITHUB_STEP_SUMMARY="${BATS_TEST_TMPDIR}/summary" GITHUB_OUTPUT="${BATS_TEST_TMPDIR}/output"
	export PR_RESPONSE='{"state":"OPEN","headRefOid":"current"}'
	export GH_CALLS="${BATS_TEST_TMPDIR}/gh-calls"
	mkdir "${BATS_TEST_TMPDIR}/bin"
	cat >"${BATS_TEST_TMPDIR}/bin/gh" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"${GH_CALLS}"
[[ ${GH_FAIL:-false} != true ]] || exit 1
printf '%s\n' "${PR_RESPONSE}"
SH
	chmod +x "${BATS_TEST_TMPDIR}/bin/gh"
	export PATH="${BATS_TEST_TMPDIR}/bin:${PATH}"
}

@test "a current open PR with credentials permits Preview deployment" {
	run -0 bash "${root}/tasks/ci/preview-check"
	[[ $(<"${GITHUB_OUTPUT}") == run=true ]]
	[[ $(<"${GH_CALLS}") == 'pr view 123 --json state,headRefOid' ]]
}

@test "Dependabot skips Preview with an account variable but no Actions secret" {
	export API_TOKEN='' CI_DEPENDABOT=true
	run -0 bash "${root}/tasks/ci/preview-check"
	[[ ! -e ${GITHUB_OUTPUT} && ! -e ${GH_CALLS} ]]
	[[ $(<"${GITHUB_STEP_SUMMARY}") == 'No Preview credentials; skipped the Preview deployment.' ]]
}

@test "missing both credentials skips Preview before querying GitHub" {
	export ACCOUNT_ID='' API_TOKEN=''
	run -0 bash "${root}/tasks/ci/preview-check"
	[[ ! -e ${GITHUB_OUTPUT} && ! -e ${GH_CALLS} ]]
}

@test "an ordinary PR with incomplete credentials fails" {
	export API_TOKEN=''
	run -1 bash "${root}/tasks/ci/preview-check"
	[[ ! -e ${GITHUB_OUTPUT} && ! -e ${GH_CALLS} ]]
}

@test "a token without an account fails even for Dependabot" {
	export ACCOUNT_ID='' CI_DEPENDABOT=true
	run -1 bash "${root}/tasks/ci/preview-check"
	[[ ! -e ${GITHUB_OUTPUT} && ! -e ${GH_CALLS} ]]
}

@test "a superseded PR head skips Preview" {
	export PR_RESPONSE='{"state":"OPEN","headRefOid":"newer"}'
	run -0 bash "${root}/tasks/ci/preview-check"
	[[ ! -e ${GITHUB_OUTPUT} ]]
}

@test "a closed PR skips Preview" {
	export PR_RESPONSE='{"state":"CLOSED","headRefOid":"current"}'
	run -0 bash "${root}/tasks/ci/preview-check"
	[[ ! -e ${GITHUB_OUTPUT} ]]
}

@test "a failed GitHub query blocks Preview" {
	export GH_FAIL=true
	run -1 bash "${root}/tasks/ci/preview-check"
	[[ ! -e ${GITHUB_OUTPUT} ]]
}

@test "an invalid GitHub response blocks Preview instead of appearing stale" {
	export PR_RESPONSE='invalid JSON'
	run bash "${root}/tasks/ci/preview-check"
	[[ ${status} != 0 && ! -e ${GITHUB_OUTPUT} ]]
}
