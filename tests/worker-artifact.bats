#!/usr/bin/env bats
# shellcheck shell=bash
# Bats supplies its temporary directories and command output variables.
# Failure cases deliberately exercise helpers with errexit disabled by run.
# shellcheck disable=SC2154,SC2310

setup() {
	bats_require_minimum_version 1.7.0
	root=$(cd "${BATS_TEST_DIRNAME}/.." && pwd)
	# shellcheck source=tasks/ci/worker-artifact
	source "${root}/tasks/ci/worker-artifact"
	cd "${BATS_TEST_TMPDIR}" || exit
	mkdir -p worker/dist/dotfiles_worker/.vite
	printf '{"no_bundle":true}\n' >worker/dist/dotfiles_worker/wrangler.json
	printf 'export default {};\n' >worker/dist/dotfiles_worker/index.js
	printf 'hidden metadata\n' >worker/dist/dotfiles_worker/.vite/manifest.json
	pack_worker test-revision
}

@test "Worker artifact round trip preserves the bundle and hidden files" {
	mv worker/dist original
	run -0 restore_worker test-revision
	diff -r original worker/dist
}

@test "Worker artifact rejects a mismatched source revision" {
	run ! restore_worker wrong-revision
	[[ ${output} == *'different revision'* ]]
}

@test "Worker artifact rejects archive corruption" {
	printf 'corruption\n' >>out/worker-artifact/worker.tar.gz
	run ! restore_worker test-revision
	[[ ${output} == *'FAILED'* ]]
}

@test "Worker artifact rejects a configuration that enables bundling" {
	printf '{"no_bundle":false}\n' >worker/dist/dotfiles_worker/wrangler.json
	pack_worker test-revision
	run ! restore_worker test-revision
	[[ ${output} == *'must disable builds and bundling'* ]]
}

@test "Worker artifact rejects a configuration with a build command" {
	printf '{"no_bundle":true,"build":{"command":"false"}}\n' >worker/dist/dotfiles_worker/wrangler.json
	pack_worker test-revision
	run ! restore_worker test-revision
	[[ ${output} == *'must disable builds and bundling'* ]]
}
