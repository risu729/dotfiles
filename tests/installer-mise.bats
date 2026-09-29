#!/usr/bin/env bats
# shellcheck shell=bash
# Bats calls stubs indirectly and deliberately disables errexit in failure tests.
# shellcheck disable=SC2310,SC2154,SC2329

setup() {
	bats_require_minimum_version 1.7.0
	root=$(cd "${BATS_TEST_DIRNAME}/.." && pwd)
	# shellcheck source=unix/install.sh
	source "${root}/unix/install.sh"
	install_path="${BATS_TEST_TMPDIR}/bin/mise"
	export INSTALLER_LOG="${BATS_TEST_TMPDIR}/installer.log"

	# Exercise the real pipeline and version check, without network or host writes.
	curl() {
		cat <<'INSTALLER'
set -eu
printf '%s\n' "$MISE_VERSION" "$MISE_INSTALL_PATH" "$MISE_INSTALL_SKIP_IF_EXISTS" >> "$INSTALLER_LOG"
mkdir -p "$(dirname "$MISE_INSTALL_PATH")"
printf '#!/bin/sh\necho "%s test-build"\n' "${FAKE_MISE_VERSION:-${MISE_VERSION#v}}" > "$MISE_INSTALL_PATH"
chmod +x "$MISE_INSTALL_PATH"
INSTALLER
	}
}

@test "installer enforces its pin and destination despite inherited overrides" {
	export MISE_VERSION=v9999.1.1 MISE_INSTALL_PATH="${BATS_TEST_TMPDIR}/wrong"
	install_mise_binary "${install_path}"
	run cat "${INSTALLER_LOG}"
	[[ ${status} == 0 ]]
	[[ ${lines[0]} == "v${mise_version}" ]]
	[[ ${lines[1]} == "${install_path}" ]]
	[[ ${lines[2]} == 1 ]]
	run command -v mise
	[[ ${status} == 0 && ${output} == "${install_path}" ]]
	run mise --version
	[[ ${status} == 0 && ${output} == "${mise_version} test-build" ]]
	[[ ! -e ${MISE_INSTALL_PATH} ]]
}

@test "installer replaces a newer binary and can run twice" {
	mkdir -p "$(dirname "${install_path}")"
	printf '#!/bin/sh\necho 9999.1.1\n' >"${install_path}"
	chmod +x "${install_path}"
	install_mise_binary "${install_path}"
	install_mise_binary "${install_path}"
	run mise --version
	[[ ${status} == 0 && ${output} == "${mise_version} test-build" ]]
}

@test "failed download cannot report installation success" {
	curl() { return 22; }
	run install_mise_binary "${install_path}"
	[[ ${status} == 22 ]]
	[[ ${output} != *'installed.'* ]]
	[[ ! -e ${install_path} ]]
}

@test "upstream installer failure propagates" {
	curl() { printf 'exit 17\n'; }
	run install_mise_binary "${install_path}"
	[[ ${status} == 17 ]]
	[[ ${output} != *'installed.'* ]]
}

@test "an unexpected installed version stops bootstrap" {
	export FAKE_MISE_VERSION=9999.1.1
	run install_mise_binary "${install_path}"
	[[ ${status} == 1 ]]
	[[ ${output} == *"Expected mise ${mise_version}, but found 9999.1.1"* ]]
}
