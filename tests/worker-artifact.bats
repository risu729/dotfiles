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
	mkdir -p worker/.cloudflare/output/v0/workers/default/bundle/.vite
	printf '{"buildContext":{"mode":"production","isPreview":false}}\n' >worker/.cloudflare/output/v0/config.json
	printf '{"name":"dotfiles-worker","manifest":{"mainModule":"index.js"}}\n' >worker/.cloudflare/output/v0/workers/default/worker.config.json
	printf 'export default {};\n' >worker/.cloudflare/output/v0/workers/default/bundle/index.js
	printf 'hidden metadata\n' >worker/.cloudflare/output/v0/workers/default/bundle/.vite/manifest.json
	pack_worker test-revision
}

@test "Worker artifact round trip preserves the bundle and hidden files" {
	mv worker/.cloudflare/output/v0 original
	run -0 restore_worker test-revision
	diff -r original worker/.cloudflare/output/v0
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

@test "Worker artifact rejects a non-production build" {
	printf '{"buildContext":{"mode":"development","isPreview":false}}\n' >worker/.cloudflare/output/v0/config.json
	pack_worker test-revision
	run ! restore_worker test-revision
	[[ ${output} == *'must be built for production'* ]]
}

@test "Worker artifact rejects a different Worker" {
	printf '{"name":"other-worker","manifest":{"mainModule":"index.js"}}\n' >worker/.cloudflare/output/v0/workers/default/worker.config.json
	pack_worker test-revision
	run ! restore_worker test-revision
	[[ ${output} == *'unexpected Worker or entrypoint'* ]]
}

@test "Worker artifact rejects a missing bundle" {
	rm worker/.cloudflare/output/v0/workers/default/bundle/index.js
	pack_worker test-revision
	run ! restore_worker test-revision
}
