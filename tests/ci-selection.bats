#!/usr/bin/env bats
# shellcheck shell=bash
# Bats supplies its test directory and captures command output.
# shellcheck disable=SC2154

setup() {
	bats_require_minimum_version 1.7.0
	export CI_PULL_REQUEST=false
	root=$(cd "${BATS_TEST_DIRNAME}/.." && pwd)
	cd "${root}" || exit
	# shellcheck source=tasks/ci/select
	source "${root}/tasks/ci/select"
}

assert_selection() {
	local installers="$1" worker="$2" expected
	shift 2
	expected=$(printf 'installers=%s\nworker=%s' "${installers}" "${worker}")
	run -0 select_checks "$@"
	[[ ${output} == "${expected}" ]]
}

@test "empty path list skips expensive checks" {
	assert_selection false false
}

@test "documentation skips expensive checks" {
	assert_selection false false README.md 'docs/file with spaces.md'
}

@test "installed Markdown selects installers" {
	assert_selection true false unix/home/.agents/AGENTS.md
}

@test "Linux system configuration selects installers" {
	assert_selection true false unix/codex/config.toml
	assert_selection true false unix/ssh/ca.pub
	assert_selection true false unix/systemd/wsl-cloudflare-ip.service
}

@test "Unix installer selects both expensive checks" {
	assert_selection true true unix/install.sh
}

@test "Worker source selects both expensive checks" {
	assert_selection true true worker/src/index.ts
}

@test "Windows scripts select Worker checks" {
	assert_selection false true win/install.ps1
}

@test "toolchain changes select both expensive checks" {
	assert_selection true true mise.toml mise.lock
}

@test "shared task configuration selects both expensive checks" {
	assert_selection true true hk.pkl tasks/verify/installation
}

@test "workflow changes select both expensive checks" {
	assert_selection true true .github/workflows/ci.yml
}

@test "unknown paths select both expensive checks" {
	assert_selection true true unknown-new-file
}

@test "mixed paths retain every affected check" {
	assert_selection true true README.md unix/home/.bashrc worker/src/index.ts
}

@test "full runs select both expensive checks" {
	run -0 env CI_FULL=true bash tasks/ci/select
	[[ ${output} == $'installers=true\nworker=true' ]]
}

@test "unavailable base falls back to both expensive checks" {
	run -0 --separate-stderr env BASE_SHA=nonexistent-base HEAD_SHA=HEAD CI_FULL=false bash tasks/ci/select
	[[ ${output} == $'installers=true\nworker=true' ]]
	[[ ${stderr} == *'running the full suite'* ]]
}

@test "identical revisions skip expensive checks" {
	run -0 env BASE_SHA=HEAD HEAD_SHA=HEAD CI_FULL=false bash tasks/ci/select
	[[ ${output} == $'installers=false\nworker=false' ]]
}

setup_changed_repository() {
	cd "${BATS_TEST_TMPDIR}" || exit
	git -c init.defaultBranch=main init --quiet
	git config user.name 'Selection test'
	git config user.email 'selection@example.invalid'
	git config commit.gpgsign false
	git config core.hooksPath /dev/null
	mkdir -p unix/home
	printf 'managed\n' >unix/home/.bashrc
	git add .
	git commit --quiet -m initial
}

@test "renaming a managed file into docs still selects installers" {
	setup_changed_repository
	mkdir docs
	git mv unix/home/.bashrc 'docs/file with spaces.md'
	git commit --quiet -m rename
	run -0 env BASE_SHA=HEAD^ HEAD_SHA=HEAD CI_FULL=false bash "${root}/tasks/ci/select"
	[[ ${output} == $'installers=true\nworker=false' ]]
}

@test "deleting a managed file still selects installers" {
	setup_changed_repository
	git rm unix/home/.bashrc
	git commit --quiet -m delete
	run -0 env BASE_SHA=HEAD^ HEAD_SHA=HEAD CI_FULL=false bash "${root}/tasks/ci/select"
	[[ ${output} == $'installers=true\nworker=false' ]]
}

setup_diverged_repository() {
	setup_changed_repository
	git checkout --quiet -b proposal
	printf 'documentation\n' >README.md
	git add README.md
	git commit --quiet -m docs
	git checkout --quiet main
	mkdir -p worker/src
	printf 'base-only change\n' >worker/src/index.ts
	git add worker/src/index.ts
	git commit --quiet -m 'advance target'
}

@test "PR selection ignores changes made only on an advancing target branch" {
	setup_diverged_repository
	run -0 env BASE_SHA=main HEAD_SHA=proposal CI_PULL_REQUEST=true bash "${root}/tasks/ci/select"
	[[ ${output} == $'installers=false\nworker=false' ]]
}

@test "direct revision comparisons still include differences on both sides" {
	setup_diverged_repository
	run -0 env BASE_SHA=main HEAD_SHA=proposal bash "${root}/tasks/ci/select"
	[[ ${output} == $'installers=true\nworker=true' ]]
}

@test "stacked PR selection excludes inherited parent changes" {
	setup_changed_repository
	printf 'parent change\n' >>unix/home/.bashrc
	git commit --quiet --all -m parent
	git branch parent
	printf 'child documentation\n' >README.md
	git add README.md
	git commit --quiet -m child
	run -0 env BASE_SHA=parent HEAD_SHA=HEAD CI_PULL_REQUEST=true bash "${root}/tasks/ci/select"
	[[ ${output} == $'installers=false\nworker=false' ]]
}

@test "PR selection preserves changed and deleted installer inputs" {
	setup_diverged_repository
	git checkout --quiet proposal
	git rm unix/home/.bashrc
	git commit --quiet -m 'remove managed shell'
	run -0 env BASE_SHA=main HEAD_SHA=HEAD CI_PULL_REQUEST=true bash "${root}/tasks/ci/select"
	[[ ${output} == $'installers=true\nworker=false' ]]
}

@test "PR selection falls back to the full suite without a common ancestor" {
	setup_changed_repository
	git checkout --quiet --orphan unrelated
	git commit --quiet -m unrelated
	run -0 --separate-stderr env BASE_SHA=main HEAD_SHA=HEAD CI_PULL_REQUEST=true bash "${root}/tasks/ci/select"
	[[ ${output} == $'installers=true\nworker=true' ]]
	[[ ${stderr} == *'Cannot find PR merge base'* ]]
}
