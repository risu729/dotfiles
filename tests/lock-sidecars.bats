#!/usr/bin/env bats
# shellcheck shell=bash
# Bats supplies test paths and command output variables.
# shellcheck disable=SC2154

setup() {
	bats_require_minimum_version 1.7.0
	cd "${BATS_TEST_DIRNAME}/.." || return
	mkdir -p "${BATS_TEST_TMPDIR}/bin"
	cat >"${BATS_TEST_TMPDIR}/bin/mise" <<'MOCK'
#!/usr/bin/env bash
printf '%s\n' "${SIDECAR_INVENTORY:-[]}"
exit "${SIDECAR_STATUS:-0}"
MOCK
	chmod +x "${BATS_TEST_TMPDIR}/bin/mise"
	export PATH="${BATS_TEST_TMPDIR}/bin:${PATH}"
}

@test "sidecar audit accepts existing referenced directories" {
	local inventory='[{"lockfile":"mise.lock","sidecars":[{"path":".mise/locks/example","exists":true}]}]'
	run -0 env SIDECAR_INVENTORY="${inventory}" tasks/verify/lock-sidecars
	[[ ${output} == *'Checked 1 referenced sidecar directories'* ]]
}

@test "sidecar audit fails when a referenced directory is missing" {
	local inventory='[{"lockfile":"mise.lock","sidecars":[{"path":".mise/locks/missing","exists":false}]}]'
	run -1 env SIDECAR_INVENTORY="${inventory}" tasks/verify/lock-sidecars
	[[ ${output} == *'missing sidecar directory .mise/locks/missing'* ]]
}

@test "sidecar audit rejects missing or malformed inventories" {
	run -1 tasks/verify/lock-sidecars
	local inventory='[{"lockfile":"mise.lock","sidecars":[{"path":"unknown"}]}]'
	run -1 env SIDECAR_INVENTORY="${inventory}" tasks/verify/lock-sidecars
}

@test "sidecar audit preserves native command failure" {
	local inventory='[{"lockfile":"mise.lock","sidecars":[]}]'
	run -7 env SIDECAR_INVENTORY="${inventory}" SIDECAR_STATUS=7 tasks/verify/lock-sidecars
}
