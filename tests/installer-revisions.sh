#!/usr/bin/env bash
# Exercise real Git checkouts without installing packages or touching the home directory.
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
# shellcheck source=../unix/install.sh
source "${root}/unix/install.sh"

fixture=$(mktemp -d)
trap 'rm -rf "${fixture}"' EXIT
remote="${fixture}/remote"
checkout="${fixture}/checkout"
git -c init.defaultBranch=main init --quiet "${remote}"
git -C "${remote}" config user.name 'Installer test'
git -C "${remote}" config user.email 'installer@example.invalid'
git -C "${remote}" config commit.gpgsign false
git -C "${remote}" config core.hooksPath /dev/null
printf 'main\n' > "${remote}/managed"
git -C "${remote}" add managed
git -C "${remote}" commit --quiet -m initial
git clone --quiet "${remote}" "${checkout}"
# Create the requested revision after cloning to exercise fetching missing refs.
git -C "${remote}" checkout --quiet -b requested
printf 'requested\n' > "${remote}/managed"
git -C "${remote}" commit --quiet --all -m requested
requested=$(git -C "${remote}" rev-parse HEAD)
git -C "${remote}" checkout --quiet main
ln -s "${checkout}/managed" "${fixture}/installed"

# Stub only package/configuration work. Git operations remain real.
trust_configs() { :; }
mise() {
	if [[ $* == *'bootstrap repos update'* ]]; then
		test "$(git -C "${checkout}" branch --show-current)" = main
		git -C "${checkout}" pull --quiet --ff-only
	fi
}
install_mise() { :; }
clone_or_update_dotfiles_repo() {
	select_dotfiles_revision "${checkout}" "$1" "${remote}" >&2 || return
	printf '%s\n' "${checkout}"
}

git_ref=requested
main
test "$(git -C "${checkout}" rev-parse HEAD)" = "${requested}"
test "$(cat "${fixture}/installed")" = requested
test -z "$(git -C "${checkout}" branch --show-current)"
# Repeating a commit-pinned install preserves the installed configuration.
git_ref=${requested}
main
test "$(cat "${fixture}/installed")" = requested

printf 'updated main\n' > "${remote}/managed"
git -C "${remote}" commit --quiet --all -m update
git_ref=''
main
test "$(cat "${fixture}/installed")" = 'updated main'
test "$(git -C "${checkout}" branch --show-current)" = main

if select_dotfiles_revision "${checkout}" requested "${fixture}/wrong-origin"; then
	echo 'Unexpected origin was accepted' >&2
	exit 1
fi
# A failed fetch must not silently reuse the previous FETCH_HEAD.
if select_dotfiles_revision "${checkout}" nonexistent-ref "${remote}"; then
	echo 'Missing revision was accepted' >&2
	exit 1
fi
test "$(git -C "${checkout}" branch --show-current)" = main

printf 'local changes\n' > "${checkout}/managed"
if select_dotfiles_revision "${checkout}" requested "${remote}"; then
	echo 'Dirty checkout was accepted' >&2
	exit 1
fi
test "$(cat "${fixture}/installed")" = 'local changes'
echo 'Installer revision regressions passed.'

# The public curl | bash entry point has no BASH_SOURCE[0]. Stub the main
# function body, but execute the real script and its entry-point guard on stdin.
piped_result=$(
	awk '
		/^main\(\) \{/ { skip = 1; print "main() { echo stdin-entry-point; }"; next }
		skip && /^}/ { skip = 0; next }
		!skip { print }
	' "${root}/unix/install.sh" | bash
)
test "${piped_result}" = stdin-entry-point
