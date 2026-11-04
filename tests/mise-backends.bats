#!/usr/bin/env bats
# shellcheck shell=bash
# Bats supplies test paths and captured output.
# Each Bats test has its own shell and deliberately exports independent fixtures.
# shellcheck disable=SC2030,SC2031,SC2154

setup() {
	bats_require_minimum_version 1.7.0
	REAL_MISE=$(command -v mise)
	export REPOSITORY="${BATS_TEST_TMPDIR}/repository"
	export FAKE_CALLS="${BATS_TEST_TMPDIR}/calls"
	mkdir -p "${REPOSITORY}/tasks/verify" "${REPOSITORY}/unix/home/.config/mise" "${BATS_TEST_TMPDIR}/bin"
	cp "${BATS_TEST_DIRNAME}/../tasks/verify/mise-backends" "${REPOSITORY}/tasks/verify/mise-backends"
	for lockfile in mise.lock unix/home/.config/mise/mise.lock unix/home/.config/mise/mise.personal.lock; do
		printf '# fixture\n' >"${REPOSITORY}/${lockfile}"
	done
	cat >"${BATS_TEST_TMPDIR}/bin/mise" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
scope=project
[[ ${*} == *--global* ]] && scope=global
printf '%s|%s|%s|%s|%s\n' "${scope}" "${MISE_ENV:-bare}" "${MISE_CONFIG_DIR}" "${MISE_ENABLE_TOOLS:-unset}" "${MISE_GLOBAL_CONFIG_FILE:-unset}" >>"${FAKE_CALLS}"
[[ ${*} == *'backends switch --dry-run'* ]]
[[ ${MISE_AUTO_ENV} == true ]]
[[ ${MISE_LOG_LEVEL} == info ]]
if [[ ${scope}:${MISE_ENV:-bare} == "${FAKE_TARGET:-global:personal}" ]]; then
  case ${FAKE_RESULT:-clean} in
    switch) echo 'mise would switch jactionlint from github to packslip' >&2; exit 0 ;;
    replace) echo 'mise would replace stale jactionlint' >&2; exit 0 ;;
    error) echo 'resolver failed' >&2; exit 42 ;;
    empty) exit 0 ;;
    unknown) echo 'new output contract'; exit 0 ;;
    warning) echo 'mise WARN cannot load configuration' >&2 ;;
  esac
fi
printf "every tool in the %s lockfile already uses the registry's backend\n" "${scope}"
STUB
	chmod +x "${BATS_TEST_TMPDIR}/bin/mise"
	export PATH="${BATS_TEST_TMPDIR}/bin:${PATH}"
}

@test "backend check covers both scopes and profiles without caller filters" {
	export MISE_ENABLE_TOOLS=unrelated MISE_GLOBAL_CONFIG_FILE=/nonexistent
	export MISE_ENV=unrelated MISE_QUIET=true MISE_LOG_LEVEL=error
	run -0 bash "${REPOSITORY}/tasks/verify/mise-backends"
	count=$(wc -l <"${FAKE_CALLS}")
	[[ ${count} -eq 4 ]]
	grep -q '^project|bare|.*|unset|unset$' "${FAKE_CALLS}"
	grep -q '^project|personal|.*|unset|unset$' "${FAKE_CALLS}"
	grep -Fq "global|bare|${REPOSITORY}/unix/home/.config/mise|unset|unset" "${FAKE_CALLS}"
	grep -Fq "global|personal|${REPOSITORY}/unix/home/.config/mise|unset|unset" "${FAKE_CALLS}"
}

@test "backend check fails on migration stderr despite a zero exit status" {
	export FAKE_RESULT=switch FAKE_TARGET=project:bare
	run -1 bash "${REPOSITORY}/tasks/verify/mise-backends"
	[[ ${output} == *'would switch'* ]]
	# Report every scope even when the first one failed.
	count=$(wc -l <"${FAKE_CALLS}")
	[[ ${count} -eq 4 ]]
}

@test "backend check detects stale version replacements in the personal global lock" {
	export FAKE_RESULT=replace
	run -1 bash "${REPOSITORY}/tasks/verify/mise-backends"
	[[ ${output} == *'would replace stale'* ]]
}

@test "backend check propagates resolver failures" {
	export FAKE_RESULT=error
	run -1 bash "${REPOSITORY}/tasks/verify/mise-backends"
	[[ ${output} == *'resolver failed'* ]]
}

@test "backend check fails closed on empty or changed command output" {
	for result in empty unknown warning; do
		export FAKE_RESULT=${result}
		run -1 bash "${REPOSITORY}/tasks/verify/mise-backends"
	done
}

@test "backend check rejects a missing lockfile rather than reporting no migrations" {
	rm "${REPOSITORY}/unix/home/.config/mise/mise.personal.lock"
	run -1 bash "${REPOSITORY}/tasks/verify/mise-backends"
	[[ ${output} == *'Missing lockfile: unix/home/.config/mise/mise.personal.lock'* ]]
	[[ ! -e ${FAKE_CALLS} ]]
}

# Use the installed mise too: stubs alone cannot prove that profile files are
# discovered or that an identical project tool does not mask a global one.
real_fixture() {
	PATH="$(dirname "${REAL_MISE}"):${PATH}"
	export PATH
	cat >"${REPOSITORY}/mise.toml" <<'CONFIG'
[settings]
experimental = true
lockfile = true
[tools]
jactionlint = "2.3.0"
CONFIG
	cat >"${REPOSITORY}/unix/home/.config/mise/config.toml" <<'CONFIG'
[settings]
experimental = true
lockfile = true
CONFIG
	printf '[tools]\njactionlint = "2.3.0"\n' >"${REPOSITORY}/unix/home/.config/mise/config.personal.toml"
	cat >"${REPOSITORY}/mise.lock" <<'LOCK'
lockfile_version = 3
[[tools.jactionlint]]
version = "2.3.0"
backend = "packslip:github.com/jdx/jactionlint"
specifiers = ["2.3.0"]
LOCK
	cp "${REPOSITORY}/mise.lock" "${REPOSITORY}/unix/home/.config/mise/mise.personal.lock"
	printf 'lockfile_version = 3\n' >"${REPOSITORY}/unix/home/.config/mise/mise.lock"
}

@test "real mise detects an old project backend and leaves the lock unchanged" {
	real_fixture
	sed 's|packslip:github.com/jdx/jactionlint|github:jdx/jactionlint|' "${REPOSITORY}/mise.lock" >"${BATS_TEST_TMPDIR}/old.lock"
	cp "${BATS_TEST_TMPDIR}/old.lock" "${REPOSITORY}/mise.lock"
	run -1 bash "${REPOSITORY}/tasks/verify/mise-backends"
	[[ ${output} == *'would switch jactionlint@2.3.0'* ]]
	cmp "${BATS_TEST_TMPDIR}/old.lock" "${REPOSITORY}/mise.lock"
}

@test "real mise detects a personal global migration even with the same project tool" {
	real_fixture
	lockfile="${REPOSITORY}/unix/home/.config/mise/mise.personal.lock"
	sed 's|packslip:github.com/jdx/jactionlint|github:jdx/jactionlint|' "${lockfile}" >"${BATS_TEST_TMPDIR}/old.lock"
	cp "${BATS_TEST_TMPDIR}/old.lock" "${lockfile}"
	run -1 bash "${REPOSITORY}/tasks/verify/mise-backends"
	[[ ${output} == *'would switch jactionlint@2.3.0'* ]]
	[[ ${output} == *'mise.personal.lock'* ]]
	cmp "${BATS_TEST_TMPDIR}/old.lock" "${lockfile}"
}

@test "real mise accepts current backends repeatedly without rewriting lockfiles" {
	real_fixture
	cp "${REPOSITORY}/mise.lock" "${BATS_TEST_TMPDIR}/current.lock"
	run -0 bash "${REPOSITORY}/tasks/verify/mise-backends"
	run -0 bash "${REPOSITORY}/tasks/verify/mise-backends"
	cmp "${BATS_TEST_TMPDIR}/current.lock" "${REPOSITORY}/mise.lock"
	cmp "${BATS_TEST_TMPDIR}/current.lock" "${REPOSITORY}/unix/home/.config/mise/mise.personal.lock"
}
