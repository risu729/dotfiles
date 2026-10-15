#!/usr/bin/env bats
# shellcheck shell=bash
# Bats supplies test paths and command output variables.
# shellcheck disable=SC2154

setup() {
	bats_require_minimum_version 1.7.0
	cd "${BATS_TEST_DIRNAME}/.." || return
	export LOCK_BUMP_LOG="${BATS_TEST_TMPDIR}/arguments"
	mkdir -p "${BATS_TEST_TMPDIR}/bin"
	cat >"${BATS_TEST_TMPDIR}/bin/mise" <<'MOCK'
#!/usr/bin/env bash
printf '%s\n' "$MISE_GLOBAL_CONFIG_FILE" "$MISE_ENV" "$@" >"$LOCK_BUMP_LOG"
[[ "$MISE_SYSTEM_CONFIG_FILE" == "$MISE_SYSTEM_CONFIG_DIR/config.toml" ]] || exit 3
exit "${LOCK_BUMP_STATUS:-0}"
MOCK
	chmod +x "${BATS_TEST_TMPDIR}/bin/mise"
	export PATH="${BATS_TEST_TMPDIR}/bin:${PATH}"
}

@test "lock bump defaults to a preview of checked-in shared global configuration" {
	run -0 tasks/maintenance/lock-bump
	first=$(sed -n '1p' "${LOCK_BUMP_LOG}")
	[[ ${first} == "${PWD}/unix/home/.config/mise/config.toml" ]]
	second=$(sed -n '2p' "${LOCK_BUMP_LOG}")
	[[ ${second} == '' ]]
	arguments=$(tail -n +3 "${LOCK_BUMP_LOG}")
	[[ ${arguments} == $'lock\n--global\n--bump\n--json\n--dry-run' ]]
}

@test "write mode selects personal configuration and forwards only tool names" {
	run -0 tasks/maintenance/lock-bump --write personal node npm:ccusage
	second=$(sed -n '2p' "${LOCK_BUMP_LOG}")
	[[ ${second} == personal ]]
	arguments=$(tail -n +3 "${LOCK_BUMP_LOG}")
	[[ ${arguments} == $'lock\n--global\n--bump\n--json\nnode\nnpm:ccusage' ]]
}

@test "lock bump rejects exact versions and option arguments before running mise" {
	run -2 tasks/maintenance/lock-bump shared node@26.11.1
	[[ ! -e ${LOCK_BUMP_LOG} ]]
	run -2 tasks/maintenance/lock-bump shared --force
	[[ ! -e ${LOCK_BUMP_LOG} ]]
}

@test "lock bump propagates native failures" {
	export LOCK_BUMP_STATUS=7
	run -7 tasks/maintenance/lock-bump
}
