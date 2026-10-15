#!/usr/bin/env bats
# shellcheck shell=bash
# Bats supplies test paths and command output variables.
# shellcheck disable=SC2154

setup() {
	bats_require_minimum_version 1.7.0
	cd "${BATS_TEST_DIRNAME}/.." || return
	export AUDIT_HELPER="${PWD}/mise/lock-sidecars.ts"
	export AUDIT_FIXTURE="${BATS_TEST_TMPDIR}/repo"
	mkdir -p "${AUDIT_FIXTURE}/.mise/locks/example"
	git -C "${AUDIT_FIXTURE}" init --quiet
	printf '{}\n' >"${AUDIT_FIXTURE}/.mise/locks/example/package.json"
	git -C "${AUDIT_FIXTURE}" add .mise/locks/example/package.json
}

audit_inventory() {
	cd "${AUDIT_FIXTURE}" || return
	printf '%s\n' "$1" | bun "${AUDIT_HELPER}"
}

@test "sidecar audit accepts Git-tracked native sidecar files" {
	local inventory='[{"lockfile":"mise.lock","sidecars":[{"path":".mise/locks/example","exists":true}]}]'
	run -0 audit_inventory "${inventory}"
	[[ ${output} == *'Checked 1 referenced sidecar directories against Git'* ]]
}

@test "sidecar audit detects untracked and ignored files" {
	local inventory='[{"lockfile":"mise.lock","sidecars":[{"path":".mise/locks/example","exists":true}]}]'
	printf 'native-lock\n' >"${AUDIT_FIXTURE}/.mise/locks/example/ignored.cache"
	printf '*.cache\n' >"${AUDIT_FIXTURE}/.gitignore"
	run -1 audit_inventory "${inventory}"
	[[ ${output} == *'untracked sidecar file .mise/locks/example/ignored.cache'* ]]
}

@test "sidecar audit fails when a referenced directory is missing" {
	local inventory='[{"lockfile":"mise.lock","sidecars":[{"path":".mise/locks/missing","exists":false}]}]'
	run -1 audit_inventory "${inventory}"
	[[ ${output} == *'missing sidecar directory .mise/locks/missing'* ]]
}

@test "sidecar audit detects a deleted tracked file" {
	local inventory='[{"lockfile":"mise.lock","sidecars":[{"path":".mise/locks/example","exists":true}]}]'
	rm "${AUDIT_FIXTURE}/.mise/locks/example/package.json"
	run -1 audit_inventory "${inventory}"
	[[ ${output} == *'missing tracked sidecar file .mise/locks/example/package.json'* ]]
}

@test "sidecar audit rejects references outside the checkout" {
	local inventory='[{"lockfile":"mise.lock","sidecars":[{"path":"..","exists":true}]}]'
	run -1 audit_inventory "${inventory}"
	[[ ${output} == *'sidecar is outside this checkout'* ]]
}

@test "sidecar audit rejects missing or malformed inventories" {
	run -1 audit_inventory '[]'
	run -1 audit_inventory '[{"lockfile":"mise.lock","sidecars":[{"path":"unknown"}]}]'
}

@test "sidecar audit preserves native command failure" {
	mkdir -p "${BATS_TEST_TMPDIR}/bin"
	cat >"${BATS_TEST_TMPDIR}/bin/mise" <<'MOCK'
#!/usr/bin/env bash
printf '%s\n' '[{"lockfile":"mise.lock","sidecars":[]}]'
exit 7
MOCK
	chmod +x "${BATS_TEST_TMPDIR}/bin/mise"
	run -7 env PATH="${BATS_TEST_TMPDIR}/bin:${PATH}" tasks/verify/lock-sidecars
}
