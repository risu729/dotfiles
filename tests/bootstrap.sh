#!/usr/bin/env bash
# Assertions for a clean bare/personal installation, repeated after each pass.
set -euo pipefail

assert_link() {
	test -L "$1" && test -e "$1"
}
assert_absent() {
	test ! -e "$1" && test ! -L "$1"
}

if [[ -n ${GIT_COMMIT_SHA:-} ]]; then
	installed_revision=$(git rev-parse HEAD)
	test "${installed_revision}" = "${GIT_COMMIT_SHA}"
fi
assert_link "${HOME}/.config/mise/config.toml"
assert_link "${HOME}/.config/git/config"
mise bootstrap files status --missing
mise which eza
mise which kubectl

case "${TEST_PROFILE:?Set TEST_PROFILE=bare or personal}" in
personal)
	grep --quiet '^env = \["personal"\]$' "${HOME}/.config/mise/miserc.toml"
	assert_link "${HOME}/.ssh/config"
	assert_link "${HOME}/.config/git/personal.gitconfig"
	assert_link "${HOME}/.config/git/unsw.gitconfig"
	test -d "${HOME}/.ghr/github.com/risu729/biwa/.git"
	mise which glab
	;;
bare)
	if grep --quiet '^env =' "${HOME}/.config/mise/miserc.toml"; then
		echo 'Bare installation enabled a mise profile' >&2
		exit 1
	fi
	assert_absent "${HOME}/.ssh/config"
	assert_absent "${HOME}/.config/git/personal.gitconfig"
	assert_absent "${HOME}/.config/git/unsw.gitconfig"
	assert_absent "${HOME}/.ghr/github.com/risu729/biwa"
	if mise which glab; then
		echo 'Bare installation enabled a personal tool' >&2
		exit 1
	fi
	;;
*)
	echo 'TEST_PROFILE must be bare or personal' >&2
	exit 1
	;;
esac

case "$(uname -s)" in
Darwin)
	mise bootstrap macos defaults status --missing
	test -d "${HOME}/Pictures/Screenshots"
	grep --quiet '^source .*/\.config/zsh/zshrc"$' "${HOME}/.zshrc"
	assert_link "${HOME}/.config/zsh/zshrc"
	test ! -L "${HOME}/.bashrc"
	assert_absent "${HOME}/.config/mimeapps.list"
	assert_absent "${HOME}/.config/pitchfork"
	assert_absent "${HOME}/.local/bin/wsl-open"
	test -d /Applications/Orca.app
	test -d /Applications/Ghostty.app
	zsh -ic 'eza --version && btop --version'
	zsh -ic 'whence -w compdef | grep --quiet function && [[ -n ${_comps[gh]} && -n ${_comps[mise]} && -n ${_comps[ghr]} ]]'
	;;
Linux)
	assert_link "${HOME}/.bashrc"
	assert_link "${HOME}/.config/mimeapps.list"
	assert_link "${HOME}/.local/bin/wsl-open"
	cmp unix/codex/config.toml /etc/codex/config.toml
	if [[ ${TEST_PROFILE} == personal ]]; then
		test -d "${HOME}/.config/pitchfork"
		test -f /etc/ssh/sshd_config.d/10-cloudflare-access.conf
	else
		assert_absent "${HOME}/.config/pitchfork"
		assert_absent /etc/ssh/sshd_config.d/10-cloudflare-access.conf
	fi
	bash -ic 'eza --version && command -v mise && command -v ghr'
	;;
*)
	echo 'Unsupported bootstrap verification platform' >&2
	exit 1
	;;
esac
