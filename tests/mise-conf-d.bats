#!/usr/bin/env bats
# shellcheck shell=bash
# Bats supplies test paths/output; the installer invokes the mise stub indirectly.
# shellcheck disable=SC2154,SC2310,SC2329

setup() {
	bats_require_minimum_version 1.7.0
	root=$(cd "${BATS_TEST_DIRNAME}/.." && pwd)
	cd "${root}" || return
	export HOME="${BATS_TEST_TMPDIR}/home"
	export XDG_CONFIG_HOME="${HOME}/.config" XDG_DATA_HOME="${HOME}/.local/share"
	export XDG_CACHE_HOME="${HOME}/.cache" XDG_STATE_HOME="${HOME}/.local/state"
	export MISE_CONFIG_DIR="${XDG_CONFIG_HOME}/mise"
	export MISE_DATA_DIR="${XDG_DATA_HOME}/mise" MISE_CACHE_DIR="${XDG_CACHE_HOME}/mise"
	export MISE_STATE_DIR="${XDG_STATE_HOME}/mise" MISE_SYSTEM_CONFIG_DIR="${HOME}/system"
	export MISE_GLOBAL_CONFIG_FILE="${MISE_CONFIG_DIR}/config.toml"
	export MISE_TRUSTED_CONFIG_PATHS="${root}" MISE_AUTO_ENV=true MISE_ENV=''
	export CI=true MISE_OFFLINE=true
	mkdir -p "${HOME}"
}

@test "bootstrap fragments load without moving repository tool ownership" {
	run -0 mise config ls --json
	[[ ${output} == *'/.config/mise/conf.d/bootstrap-hooks.toml'* ]]
	[[ ${output} == *'/.config/mise/conf.d/bootstrap.toml'* ]]
	run -0 mise ls bun --json
	[[ ${output} == *'"path": "'"${root}"'/mise.toml"'* ]]
}

@test "root task includes still discover repository and Worker tasks" {
	run -0 mise tasks ls --name-only
	[[ ${output} == *'test:bats'* ]]
	[[ ${output} == *'worker:test'* ]]
}

@test "bare and personal dotfiles retain existing source paths" {
	local selected_profile
	for selected_profile in '' personal; do
		run -0 env MISE_ENV="${selected_profile}" mise bootstrap dotfiles status --json
		[[ ${output} != *'source_missing'* ]]
		[[ ${output} == *'/unix/home/.codex/AGENTS.md'* ]]
		if [[ -z ${selected_profile} ]]; then
			[[ ${output} != *'personal.gitconfig'* ]]
		else
			[[ ${output} == *'personal.gitconfig'* ]]
		fi
	done
}

@test "personal repositories extend the common bootstrap fragment" {
	run -0 mise bootstrap repos status --json
	[[ ${output} == *'https://github.com/risu729/dotfiles.git'* ]]
	[[ ${output} != *'https://github.com/risu729/mise.git'* ]]
	run -0 env MISE_ENV=personal mise bootstrap repos status --json
	[[ ${output} == *'https://github.com/risu729/dotfiles.git'* ]]
	[[ ${output} == *'https://github.com/risu729/mise.git'* ]]
}

@test "bootstrap dry-run registers moved tool and final hooks without applying them" {
	run -0 mise bootstrap --dry-run --only tools,final-hook --yes
	[[ ${output} == *'post-tools'* ]]
	[[ ${output} == *'final'* ]]
	[[ ! -e ${HOME}/.agents ]]
}

@test "installer trusts only repository configs including fragments" {
	# shellcheck source=unix/install.sh
	source "${root}/unix/install.sh"
	local fixture="${BATS_TEST_TMPDIR}/parent/repository"
	mkdir -p "${fixture}/.config/mise/conf.d"
	touch "${fixture}/../mise.toml" "${fixture}/mise.toml" "${fixture}/mise.personal.toml" \
		"${fixture}/.config/mise/conf.d/bootstrap.toml"
	mise() { printf '%s\n' "$*"; }
	run -0 trust_configs "${fixture}"
	[[ ${output} == "$(printf 'trust --yes %s\n' \
		"${fixture}/mise.toml" "${fixture}/mise.personal.toml" \
		"${fixture}/.config/mise/conf.d/bootstrap.toml")" ]]
}

@test "installer supports older revisions without fragments and propagates trust failures" {
	# shellcheck source=unix/install.sh
	source "${root}/unix/install.sh"
	local fixture="${BATS_TEST_TMPDIR}/repository"
	mkdir -p "${fixture}"
	touch "${fixture}/mise.toml"
	mise() { printf '%s\n' "$*"; }
	run -0 trust_configs "${fixture}"
	[[ ${output} == "trust --yes ${fixture}/mise.toml" ]]
	mise() { return 23; }
	run -23 trust_configs "${fixture}"
}
