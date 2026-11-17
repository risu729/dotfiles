#!/bin/bash
set -euo pipefail

readonly repo_url="https://github.com/risu729/dotfiles.git"

# Environment Variables:
# GIT_COMMIT_SHA: Exact commit SHA to checkout

if [[ -z ${GIT_COMMIT_SHA:-} ]]; then
	echo "Error: GIT_COMMIT_SHA environment variable is not set."
	exit 1
fi

echo "==> Preparing to clone repository ${repo_url} at commit ${GIT_COMMIT_SHA}"

git init .
echo "==> Initialized git repository."

git remote add origin "${repo_url}"
echo "==> Added remote 'origin' for ${repo_url}"

git sparse-checkout init
echo "==> Initialized sparse-checkout."

git sparse-checkout set \
	"mise.toml" \
	"tasks.toml" \
	"tasks/" \
	"worker/"
echo "==> Sparse checkout paths configured."

echo "==> Fetching commit ${GIT_COMMIT_SHA}..."
git fetch --depth 1 origin "${GIT_COMMIT_SHA}"
echo "==> Fetch complete."

git checkout FETCH_HEAD
echo "==> Checked out FETCH_HEAD (commit ${GIT_COMMIT_SHA})."

echo "==> Successfully sparse-cloned and checked out commit ${GIT_COMMIT_SHA}."

# The sparse checkout has no root package.json, so install only the Worker
# dependencies and keep `mise run` from running the root deps provider.
mise deps aube-worker
# --host required to be accessible from other containers
exec mise run --no-deps worker:preview --host
