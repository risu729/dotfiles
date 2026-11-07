#!/usr/bin/env bats
# shellcheck shell=bash
# Bats supplies test paths and command output variables.
# shellcheck disable=SC2154

setup() {
	bats_require_minimum_version 1.7.0
	cd "${BATS_TEST_DIRNAME}/.." || return
	native_mise=${SIDECAR_TEST_MISE:-$(command -v mise)}
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

@test "native sidecar audit includes the personal lock and rejects its missing graph" {
	# Mise excludes the ceiling itself; canonical paths avoid macOS /var aliases.
	AUDIT_FIXTURE=$(cd "${AUDIT_FIXTURE}" && pwd -P)
	local fixture_ceiling
	fixture_ceiling=$(cd "${BATS_TEST_TMPDIR}" && pwd -P)
	local config="${AUDIT_FIXTURE}/unix/home/.config/mise"
	mkdir -p "${config}" "${AUDIT_FIXTURE}/tasks/verify" "${AUDIT_FIXTURE}/mise" "${AUDIT_FIXTURE}/bin"
	cp tasks/verify/lock-sidecars "${AUDIT_FIXTURE}/tasks/verify/lock-sidecars"
	cp mise/lock-sidecars.ts "${AUDIT_FIXTURE}/mise/lock-sidecars.ts"
	cp mise.lock "${AUDIT_FIXTURE}/mise.lock"
	cp -R .mise/locks/. "${AUDIT_FIXTURE}/.mise/locks/"
	cp unix/home/.config/mise/mise{,.personal}.lock "${config}/"
	cp -R unix/home/.config/mise/locks "${config}/locks"
	printf '[settings]\nexperimental = true\n' >"${AUDIT_FIXTURE}/mise.toml"
	printf '[tools]\nnode = "latest"\n' >"${config}/config.toml"
	printf '[tools]\n"npm:resend-cli" = "latest"\n' >"${config}/config.personal.toml"
	ln -s "${native_mise}" "${AUDIT_FIXTURE}/bin/mise"
	git -C "${AUDIT_FIXTURE}" add .
	native_audit() {
		env -u MISE_ENABLE_TOOLS -u MISE_DISABLE_TOOLS \
			PATH="${AUDIT_FIXTURE}/bin:${PATH}" CI=true MISE_OFFLINE=true \
			MISE_CONFIG_DIR="${BATS_TEST_TMPDIR}/host" MISE_GLOBAL_CONFIG_FILE="${BATS_TEST_TMPDIR}/host/config.toml" \
			MISE_SYSTEM_CONFIG_DIR="${BATS_TEST_TMPDIR}/system" MISE_CEILING_PATHS="${fixture_ceiling}" \
			MISE_DATA_DIR="${BATS_TEST_TMPDIR}/data" MISE_STATE_DIR="${BATS_TEST_TMPDIR}/state" MISE_CACHE_DIR="${BATS_TEST_TMPDIR}/cache" \
			MISE_TRUSTED_CONFIG_PATHS="${AUDIT_FIXTURE}" \
			"${AUDIT_FIXTURE}/tasks/verify/lock-sidecars"
	}
	run -0 native_audit
	# This is a committed generated profile graph; the shared lock uses other graphs.
	rm -rf "${config}/locks/mise.personal"
	run -1 native_audit
	[[ ${output} == *'mise.personal.lock: missing sidecar directory'* ]]
}
