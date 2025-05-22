#!/bin/bash
set -euo pipefail

# Environment Variables:
# GIT_REPO_URL:  URL of the repository to clone
# GIT_COMMIT_SHA: Exact commit SHA to checkout

ROOT_DIR="/dotfiles"

if [[ -z ${GIT_REPO_URL:-} ]]; then
	echo "Error: GIT_REPO_URL environment variable is not set."
	exit 1
fi

if [[ -z ${GIT_COMMIT_SHA:-} ]]; then
	echo "Error: GIT_COMMIT_SHA environment variable is not set."
	exit 1
fi

echo "==> Preparing to clone repository ${GIT_REPO_URL} at commit ${GIT_COMMIT_SHA}"
echo "==> Target directory for repository root: ${ROOT_DIR}"

mkdir -p "${ROOT_DIR}"
cd "${ROOT_DIR}"

git init .
echo "==> Initialized git repository."

git remote add origin "${GIT_REPO_URL}"
echo "==> Added remote 'origin' for ${GIT_REPO_URL}"

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

exec /bin/bash -c "mise run worker:preview"
