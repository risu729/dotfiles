#!/usr/bin/env bats
# shellcheck shell=bash
# shellcheck disable=SC2154,SC2329

setup() {
	bats_require_minimum_version 1.7.0
	root=$(cd "${BATS_TEST_DIRNAME}/.." && pwd)
	fixture="${BATS_TEST_TMPDIR}/etc"
	mkdir -p "${fixture}/apt/sources.list.d" "${BATS_TEST_TMPDIR}/bin"
	cat >"${BATS_TEST_TMPDIR}/bin/sudo" <<'SH'
#!/usr/bin/env bash
exec "$@"
SH
	chmod +x "${BATS_TEST_TMPDIR}/bin/sudo"
	export PATH="${BATS_TEST_TMPDIR}/bin:${PATH}"
	for source in docker.list cloudflared.list google-chrome.sources google-chrome.list; do
		touch "${fixture}/apt/sources.list.d/${source}"
	done
	touch "${fixture}/apt/sources.list.d/mise-docker.sources" \
		"${fixture}/apt/sources.list.d/custom.sources"
}

@test "bare migration removes only the previously managed Docker list" {
	run -0 bash "${root}/unix/apt/prepare-vendor-sources.sh" bare "${fixture}"
	[[ ! -e ${fixture}/apt/sources.list.d/docker.list ]]
	[[ -e ${fixture}/apt/sources.list.d/cloudflared.list ]]
	[[ -e ${fixture}/apt/sources.list.d/google-chrome.sources ]]
	[[ ! -e ${fixture}/default/google-chrome ]]
}

@test "personal migration prevents Chrome postinst from recreating a second source" {
	mkdir -p "${fixture}/default"
	printf '%s\n' 'repo_add_once="true"' 'repo_reenable_on_distupgrade="true"' \
		'CUSTOM_OPTION=keep' >>"${fixture}/default/google-chrome"
	run -0 bash "${root}/unix/apt/prepare-vendor-sources.sh" personal "${fixture}"
	for source in docker.list cloudflared.list google-chrome.sources google-chrome.list; do
		[[ ! -e ${fixture}/apt/sources.list.d/${source} ]]
	done
	[[ -e ${fixture}/apt/sources.list.d/custom.sources ]]
	[[ -e ${fixture}/apt/sources.list.d/mise-docker.sources ]]
	grep -qx 'repo_add_once="false"' "${fixture}/default/google-chrome"
	grep -qx 'repo_reenable_on_distupgrade="true"' "${fixture}/default/google-chrome"
	grep -qx 'CUSTOM_OPTION=keep' "${fixture}/default/google-chrome"
	run -0 bash "${root}/unix/apt/prepare-vendor-sources.sh" personal "${fixture}"
	local flags
	flags=$(grep -c '^repo_add_once=' "${fixture}/default/google-chrome")
	[[ ${flags} == 1 ]]
}

@test "invalid profiles leave all existing sources alone" {
	run -2 bash "${root}/unix/apt/prepare-vendor-sources.sh" invalid "${fixture}"
	[[ -e ${fixture}/apt/sources.list.d/docker.list ]]
}
