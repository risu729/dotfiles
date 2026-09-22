#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
# shellcheck source=tasks/ci/select
source "${root}/tasks/ci/select"

assert_selection() {
	local installers="$1" worker="$2" actual expected
	shift 2
	actual=$(select_checks "$@")
	expected=$(printf 'installers=%s\nworker=%s' "${installers}" "${worker}")
	test "${actual}" = "${expected}"
}

assert_selection false false
assert_selection false false README.md 'docs/file with spaces.md'
assert_selection true false wsl/home/.agents/AGENTS.md
assert_selection true true unix/install.sh
assert_selection true true worker/src/index.ts
assert_selection false true win/install.ps1
assert_selection true true mise.toml mise.lock
assert_selection true true hk.pkl tasks/verify/installation
assert_selection true true .github/workflows/ci.yml
assert_selection true true unknown-new-file
# Deleted and renamed source paths must not be hidden by a docs destination.
assert_selection true false wsl/home/.bashrc docs/old-bashrc.md
assert_selection true true README.md wsl/home/.bashrc worker/src/index.ts

full=$(CI_FULL=true main)
fallback=$(BASE_SHA=nonexistent-base HEAD_SHA=HEAD CI_FULL=false main)
test "${full}" = "${fallback}"
empty=$(BASE_SHA=HEAD HEAD_SHA=HEAD CI_FULL=false main)
expected_empty=$(printf 'installers=false\nworker=false')
test "${empty}" = "${expected_empty}"
echo 'CI change selection regressions passed.'
