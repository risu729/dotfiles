#!/usr/bin/env bats
# shellcheck shell=bash
# Bats supplies these variables; the setup function is invoked by Bats.
# shellcheck disable=SC2154,SC2310,SC2329

setup() {
	bats_require_minimum_version 1.7.0
	root=$(cd "${BATS_TEST_DIRNAME}/.." && pwd)
	mkdir -p "${BATS_TEST_TMPDIR}/bin"
	export XDG_CACHE_HOME="${BATS_TEST_TMPDIR}/cache"
	export KANATA_TEST_CALLS="${BATS_TEST_TMPDIR}/calls"
	export PATH="${BATS_TEST_TMPDIR}/bin:${PATH}"
	cat >"${BATS_TEST_TMPDIR}/bin/sudo" <<'STUB'
#!/bin/bash
printf 'sudo\n' >>"${KANATA_TEST_CALLS}"
exit 99
STUB
	chmod +x "${BATS_TEST_TMPDIR}/bin/sudo"
}

@test "invalid mode never downloads or elevates" {
	run -2 bash "${root}/macos/setup-kanata.sh" unknown
	[[ ${output} == *'Usage:'* ]]
	[[ ! -e ${XDG_CACHE_HOME} ]]
	[[ ! -e ${KANATA_TEST_CALLS} ]]
}

@test "unsupported platform never downloads or elevates" {
	printf '#!/bin/sh\nprintf "Linux\\n"\n' >"${BATS_TEST_TMPDIR}/bin/uname"
	chmod +x "${BATS_TEST_TMPDIR}/bin/uname"
	run -1 bash "${root}/macos/setup-kanata.sh"
	[[ ${output} == *'only supported on macOS'* ]]
	[[ ! -e ${XDG_CACHE_HOME} ]]
	[[ ! -e ${KANATA_TEST_CALLS} ]]
}

@test "unverified archive stops installation before modifying system settings" {
	cat >"${BATS_TEST_TMPDIR}/bin/uname" <<'STUB'
#!/bin/sh
case "$1" in
-s) echo Darwin ;;
-m) echo arm64 ;;
esac
STUB
	cat >"${BATS_TEST_TMPDIR}/bin/curl" <<'STUB'
#!/bin/bash
while [[ $# -gt 0 ]]; do
	if [[ $1 == -o ]]; then
		printf 'invalid archive' >"$2"
		exit 0
	fi
	shift
done
exit 1
STUB
	chmod +x "${BATS_TEST_TMPDIR}/bin/"*
	run -1 bash "${root}/macos/setup-kanata.sh"
	[[ ${output} == *FAILED* ]]
	[[ ! -e ${KANATA_TEST_CALLS} ]]
	[[ ! -e ${XDG_CACHE_HOME}/dotfiles/kanata/1.12.0-6.2.0/kanata-arm64.zip ]]
}
