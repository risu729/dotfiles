#!/usr/bin/env bats
# shellcheck shell=bash
# Bats supplies test paths and captured output.
# shellcheck disable=SC2154

setup() {
	bats_require_minimum_version 1.7.0
	root=$(cd "${BATS_TEST_DIRNAME}/.." && pwd)
	project="${BATS_TEST_TMPDIR}/project"
	mkdir -p "${project}/worker" "${BATS_TEST_TMPDIR}/bin"
	project=$(cd "${project}" && pwd -P)
	# Load the actual task definitions without tools, deps, hooks or bootstrap.
	awk '/^\[/ { shared = /^\[task_(config|templates[.])/ } shared' \
		"${root}/mise.toml" >"${project}/mise.toml"
	cp "${root}/tasks.toml" "${project}/"
	cp -R "${root}/tasks" "${project}/"
	cp "${root}/worker/tasks.toml" "${project}/worker/"
	cp -R "${root}/worker/tasks" "${project}/worker/"
	export MISE_CONFIG_DIR="${BATS_TEST_TMPDIR}/config"
	export MISE_GLOBAL_CONFIG_FILE="${MISE_CONFIG_DIR}/config.toml"
	export MISE_SYSTEM_CONFIG_DIR="${BATS_TEST_TMPDIR}/system"
	export MISE_DATA_DIR="${BATS_TEST_TMPDIR}/data"
	export MISE_CACHE_DIR="${BATS_TEST_TMPDIR}/cache"
	export MISE_STATE_DIR="${BATS_TEST_TMPDIR}/state"
	export MISE_TRUSTED_CONFIG_PATHS="${project}"
	export MISE_ENV='' MISE_AUTO_ENV=false MISE_OFFLINE=true
	export TASK_TRACE="${BATS_TEST_TMPDIR}/trace"
	cat >"${BATS_TEST_TMPDIR}/bin/bun" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
printf '%s' "${PWD}" >>"${TASK_TRACE}"
printf ' <%s>' "$@" >>"${TASK_TRACE}"
printf '\n' >>"${TASK_TRACE}"
STUB
	chmod +x "${BATS_TEST_TMPDIR}/bin/bun"
	export PATH="${BATS_TEST_TMPDIR}/bin:${PATH}"
	cd "${project}" || return
}

@test "Worker templates preserve prerequisites, command arguments and cwd from a subdirectory" {
	cd worker
	for task in dev test test:watch preview; do
		run -0 mise run "worker:${task}"
	done
	expected="${project}/worker <run> <wrangler> <types> <src/worker-configuration.d.ts>
${project}/worker <run> <vite> <dev>
${project}/worker <run> <wrangler> <types> <src/worker-configuration.d.ts>
${project}/worker <run> <vitest> <run>
${project}/worker <run> <wrangler> <types> <src/worker-configuration.d.ts>
${project}/worker <run> <vitest> <watch> <--ui>
${project}/worker <run> <vite> <build>
${project}/worker <run> <vite> <preview>"
	actual=$(cat "${TASK_TRACE}")
	[[ ${actual} == "${expected}" ]]
}

@test "Worker file task executes its script and does not inherit a template run" {
	# A future shared run must not supersede the file task's script.
	awk '{ print } /^\[task_templates.worker\]$/ { print "run = \"exit 91\"" }' \
		mise.toml >probe.toml
	mv probe.toml mise.toml
	run -0 mise run worker:build
	actual=$(cat "${TASK_TRACE}")
	[[ ${actual} == "${project}/worker <run> <vite> <build>" ]]
}

@test "Task discovery and help retain hidden Worker tasks and installer entry points" {
	run -0 mise tasks ls --name-only
	[[ ${output} != *'worker:build'* ]]
	[[ ${output} != *'worker:generate:types'* ]]
	run -0 mise tasks ls --hidden --name-only
	[[ ${output} == *'worker:build'* ]]
	[[ ${output} == *'worker:generate:types'* ]]
	[[ ${output} != *'worker:runtime'* ]]
	for task in worker:dev worker:preview worker:test worker:test:watch worker:build worker:generate:types test:installer-linux test:installer-macos test:installer-container; do
		run -0 mise run "${task}" --help
		[[ ${output} == *"${task}"* ]]
	done
	# Help must never execute a build or installer.
	[[ ! -e ${TASK_TRACE} ]]
}
