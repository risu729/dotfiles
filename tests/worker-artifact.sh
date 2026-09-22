#!/usr/bin/env bash
# The failure cases deliberately call a helper that explicitly returns errors.
# shellcheck disable=SC2310
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
# shellcheck source=tasks/ci/worker-artifact
source "${root}/tasks/ci/worker-artifact"

fixture=$(mktemp -d)
trap 'rm -rf "${fixture}"' EXIT
cd "${fixture}"
mkdir -p worker/dist/dotfiles_worker/.vite
printf '{"no_bundle":true}\n' >worker/dist/dotfiles_worker/wrangler.json
printf 'export default {};\n' >worker/dist/dotfiles_worker/index.js
printf 'hidden metadata\n' >worker/dist/dotfiles_worker/.vite/manifest.json
pack_worker test-revision
mv worker/dist original
restore_worker test-revision
diff -r original worker/dist
if restore_worker wrong-revision; then
	echo 'Accepted an artifact from a different commit' >&2
	exit 1
fi
printf 'corruption\n' >>out/worker-artifact/worker.tar.gz
if restore_worker test-revision; then
	echo 'Accepted a corrupt artifact' >&2
	exit 1
fi
for config in '{"no_bundle":false}' '{"no_bundle":true,"build":{"command":"false"}}'; do
	printf '%s\n' "${config}" >worker/dist/dotfiles_worker/wrangler.json
	pack_worker test-revision
	if restore_worker test-revision; then
		echo 'Accepted an artifact that would rebuild during deployment' >&2
		exit 1
	fi
done
echo 'Worker artifact regressions passed.'
