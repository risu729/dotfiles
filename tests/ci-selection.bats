#!/usr/bin/env bats
# shellcheck shell=bash
# Bats supplies its test directory and captures command output.
# shellcheck disable=SC2154

setup() {
	bats_require_minimum_version 1.7.0
	root=$(cd "${BATS_TEST_DIRNAME}/.." && pwd)
	cd "${root}"
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
	assert_selection true false wsl/home/.agents/AGENTS.md
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
	assert_selection true true README.md wsl/home/.bashrc worker/src/index.ts
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
	cd "${BATS_TEST_TMPDIR}"
	git -c init.defaultBranch=main init --quiet
	git config user.name 'Selection test'
	git config user.email 'selection@example.invalid'
	git config commit.gpgsign false
	git config core.hooksPath /dev/null
	mkdir -p wsl/home
	printf 'managed\n' >wsl/home/.bashrc
	git add .
	git commit --quiet -m initial
}

@test "renaming a managed file into docs still selects installers" {
	setup_changed_repository
	mkdir docs
	git mv wsl/home/.bashrc 'docs/file with spaces.md'
	git commit --quiet -m rename
	run -0 env BASE_SHA=HEAD^ HEAD_SHA=HEAD CI_FULL=false bash "${root}/tasks/ci/select"
	[[ ${output} == $'installers=true\nworker=false' ]]
}

@test "deleting a managed file still selects installers" {
	setup_changed_repository
	git rm wsl/home/.bashrc
	git commit --quiet -m delete
	run -0 env BASE_SHA=HEAD^ HEAD_SHA=HEAD CI_FULL=false bash "${root}/tasks/ci/select"
	[[ ${output} == $'installers=true\nworker=false' ]]
}
