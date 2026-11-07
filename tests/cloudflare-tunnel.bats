#!/usr/bin/env bats
# shellcheck shell=bash
# Bats supplies test variables and runs each test in its own subshell.
# shellcheck disable=SC2030,SC2031,SC2154

setup() {
	bats_require_minimum_version 1.7.0
	host_os=$(uname -s)
	root=$(cd "${BATS_TEST_DIRNAME}/.." && pwd)
	export HOME="${BATS_TEST_TMPDIR}/home"
	export MISE_CONFIG_DIR="${HOME}/config"
	export MISE_GLOBAL_CONFIG_FILE="${MISE_CONFIG_DIR}/config.toml"
	export MISE_SYSTEM_CONFIG_DIR="${HOME}/system"
	export MISE_DATA_DIR="${HOME}/data"
	export MISE_CACHE_DIR="${HOME}/cache"
	export MISE_STATE_DIR="${HOME}/state"
	export MISE_AUTO_ENV=false MISE_ENV='' CI=true MISE_OFFLINE=true
	unset CLOUDFLARE_TUNNEL_TOKEN
	project="${BATS_TEST_TMPDIR}/project"
	export MISE_TRUSTED_CONFIG_PATHS="${project}"
	mkdir -p "${HOME}" "${project}/unix/cloudflared"
	cp "${root}/mise.cloudflare-tunnel.toml" "${project}/"
	cp "${root}/unix/cloudflared/tunnel-token.tera" "${project}/unix/cloudflared/"
	printf '[settings]\nexperimental = true\n' >"${project}/mise.toml"
	cd "${project}" || return
	token_path="${HOME}/.config/cloudflared/tunnel-token"
}

seed_token() {
	mkdir -p "${token_path%/*}"
	printf 'previous-token' >"${token_path}"
	chmod 0600 "${token_path}"
}

assert_token() {
	local actual
	actual=$(cat "${token_path}")
	[[ ${actual} == "$1" ]]
}

apply_token() {
	mise -E personal,cloudflare-tunnel dot apply --yes --force "${token_path}"
}

enable_rendering_on_host() {
	# Exercise rendering on macOS too, changing only the fixture's OS selector.
	# Scope tests use the unchanged declaration; Linux CI uses it for every test.
	if [[ ${host_os} == Darwin ]]; then
		sed 's/os = "linux"/os = "macos"/' mise.cloudflare-tunnel.toml >mise.fixture.toml
		mv mise.fixture.toml mise.cloudflare-tunnel.toml
	fi
}

assert_private_token() {
	local permissions
	if [[ ${host_os} == Darwin ]]; then
		permissions=$(stat -f '%Lp' "${token_path}")
	else
		permissions=$(stat -c '%a' "${token_path}")
	fi
	[[ ${permissions} == 600 ]]
}

@test "ordinary bare and personal dotfiles apply need no tunnel token" {
	run -0 mise dot apply --yes --force
	[[ ! -e ${token_path} ]]
	run -0 mise -E personal dot apply --yes --force
	[[ ! -e ${token_path} ]]
}

@test "ordinary bare and personal dotfiles apply preserve an existing tunnel token without input" {
	seed_token
	run -0 mise dot apply --yes --force
	assert_token previous-token
	run -0 mise -E personal dot apply --yes --force
	assert_token previous-token
}

@test "tunnel profile alone does not provision a token" {
	export CLOUDFLARE_TUNNEL_TOKEN=fixture-tunnel-token
	run -0 mise -E cloudflare-tunnel dot apply --yes --force
	[[ ! -e ${token_path} ]]
	[[ ${output} != *"${CLOUDFLARE_TUNNEL_TOKEN}"* ]]
}

@test "non-Linux personal tunnel profile needs no secret and preserves an existing token" {
	[[ ${host_os} != Linux ]] || skip 'Non-Linux scope check.'
	seed_token
	run -0 mise -E personal,cloudflare-tunnel dot apply --yes --force
	assert_token previous-token
}

@test "tunnel template provisions a private regular file and reapplies idempotently" {
	enable_rendering_on_host
	export CLOUDFLARE_TUNNEL_TOKEN=fixture-tunnel-token
	run -0 apply_token
	[[ ${output} != *"${CLOUDFLARE_TUNNEL_TOKEN}"* ]]
	[[ -f ${token_path} && ! -L ${token_path} ]]
	assert_token "${CLOUDFLARE_TUNNEL_TOKEN}"
	assert_private_token
	run -0 apply_token
	[[ ${output} != *"${CLOUDFLARE_TUNNEL_TOKEN}"* ]]
	assert_token "${CLOUDFLARE_TUNNEL_TOKEN}"
}

@test "tunnel template replaces a manual token and corrects its permissions" {
	enable_rendering_on_host
	seed_token
	chmod 0644 "${token_path}"
	export CLOUDFLARE_TUNNEL_TOKEN=rotated-fixture-token
	run -0 apply_token
	[[ ${output} != *"${CLOUDFLARE_TUNNEL_TOKEN}"* ]]
	assert_token "${CLOUDFLARE_TUNNEL_TOKEN}"
	assert_private_token
}

@test "missing or empty tunnel secret does not replace an existing token" {
	enable_rendering_on_host
	seed_token
	run ! apply_token
	assert_token previous-token
	[[ ${output} != *previous-token* ]]
	export CLOUDFLARE_TUNNEL_TOKEN=''
	run ! apply_token
	assert_token previous-token
	[[ ${output} != *previous-token* ]]
}

@test "tunnel dry run does not create a token or print its value" {
	enable_rendering_on_host
	export CLOUDFLARE_TUNNEL_TOKEN=fixture-tunnel-token
	run -0 mise -E personal,cloudflare-tunnel dot apply --dry-run "${token_path}"
	[[ ! -e ${token_path} ]]
	[[ ${output} != *"${CLOUDFLARE_TUNNEL_TOKEN}"* ]]
}
