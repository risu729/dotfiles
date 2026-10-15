#!/usr/bin/env bats
# shellcheck shell=bash
# Bats supplies test paths and command output variables.
# shellcheck disable=SC2154

setup() {
	bats_require_minimum_version 1.7.0
	cd "${BATS_TEST_DIRNAME}/.." || return
	native_mise=${LOCK_BUMP_TEST_MISE:-$(command -v mise)}
	export LOCK_BUMP_LOG="${BATS_TEST_TMPDIR}/arguments"
	mkdir -p "${BATS_TEST_TMPDIR}/bin"
	cat >"${BATS_TEST_TMPDIR}/bin/mise" <<'MOCK'
#!/usr/bin/env bash
[[ -z ${MISE_GLOBAL_CONFIG_FILE+x} ]] || exit 4
[[ "$1" == --cd ]] || exit 4
[[ "$2" == "$MISE_CEILING_PATHS" ]] || exit 4
shift 2
printf '%s\n' "$MISE_CONFIG_DIR/config.toml" "$MISE_ENV" "$@" >"$LOCK_BUMP_LOG"
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

prepare_native_fixture() {
	native_root="${BATS_TEST_TMPDIR}/native"
	native_config="${native_root}/unix/home/.config/mise"
	mkdir -p "${native_config}" "${native_root}/tasks/maintenance" "${native_root}/bin" \
		"${native_root}/host" "${native_root}/system"
	cp tasks/maintenance/lock-bump "${native_root}/tasks/maintenance/lock-bump"
	ln -s "${native_mise}" "${native_root}/bin/mise"
	printf '[tools]\n"asdf:lock-shared" = "1.0.0"\n' >"${native_config}/config.toml"
	printf '[tools]\n"asdf:lock-personal" = "2.0.0"\n' >"${native_config}/config.personal.toml"
	printf '[tools]\n"asdf:lock-project" = "9.0.0"\n' >"${native_root}/mise.toml"
	printf '[tools]\n"asdf:lock-host" = "8.0.0"\n' >"${native_root}/host/config.toml"
	cp "${native_root}/host/config.toml" "${native_root}/system/config.toml"
	for tool in lock-shared lock-personal lock-project lock-host; do
		mkdir -p "${native_root}/data/plugins/asdf-${tool}/bin"
		printf '#!/bin/sh\nprintf "1.0.0 2.0.0 8.0.0 9.0.0\\n"\n' >"${native_root}/data/plugins/asdf-${tool}/bin/list-all"
		chmod +x "${native_root}/data/plugins/asdf-${tool}/bin/list-all"
	done
}

native_bump() {
	env -u MISE_ENABLE_TOOLS -u MISE_DISABLE_TOOLS \
		PATH="${native_root}/bin:${PATH}" CI=true MISE_OFFLINE=true \
		MISE_CONFIG_DIR="${native_root}/host" MISE_GLOBAL_CONFIG_FILE="${native_root}/host/config.toml" \
		MISE_SYSTEM_CONFIG_DIR="${native_root}/system" MISE_SYSTEM_CONFIG_FILE="${native_root}/system/config.toml" \
		MISE_DATA_DIR="${native_root}/data" MISE_STATE_DIR="${native_root}/state" MISE_CACHE_DIR="${native_root}/cache" \
		MISE_TRUSTED_CONFIG_PATHS="${native_root}" \
		"${native_root}/tasks/maintenance/lock-bump" "$@"
}

@test "native personal bump includes its own lock without changing host or project locks" {
	prepare_native_fixture
	native_bump personal
	[[ ! -e ${native_config}/mise.lock && ! -e ${native_config}/mise.personal.lock ]]
	native_bump --write personal
	grep -F 'version = "1.0.0"' "${native_config}/mise.lock"
	grep -F 'version = "2.0.0"' "${native_config}/mise.personal.lock"
	[[ ! -e ${native_root}/mise.lock ]]
	[[ ! -e ${native_root}/host/mise.lock && ! -e ${native_root}/system/mise.lock ]]
}

@test "native shared bump does not select personal tools" {
	prepare_native_fixture
	native_bump --write shared
	grep -F 'version = "1.0.0"' "${native_config}/mise.lock"
	[[ ! -e ${native_config}/mise.personal.lock ]]
}
