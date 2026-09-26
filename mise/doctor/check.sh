#!/usr/bin/env bash
# Read-only probes used by mise/doctor/mise.toml. Use bash -x for failure details.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

assert_link() {
	test -L "$1" && test -e "$1"
}
assert_absent() {
	test ! -e "$1" && test ! -L "$1"
}

case "${1:?Specify shared, profile, linux, or macos}" in
shared)
	assert_link "${HOME}/.config/mise/config.toml"
	assert_link "${HOME}/.config/git/config"
	mise which eza
	mise which kubectl
	mise bootstrap files status --missing
	;;
# `mise current` exits 0 even when no version is selected; inspect stdout.
profile)
	selected_glab=$(mise current glab)
	case "${TEST_PROFILE:-}" in
	personal)
		grep --quiet '^env = \["personal"\]$' "${HOME}/.config/mise/miserc.toml"
		assert_link "${HOME}/.ssh/config"
		assert_link "${HOME}/.config/git/personal.gitconfig"
		assert_link "${HOME}/.config/git/unsw.gitconfig"
		test -d "${HOME}/.ghr/github.com/risu729/biwa/.git"
		[[ -n ${selected_glab} ]]
		;;
	bare)
		test -f "${HOME}/.config/mise/miserc.toml"
		if grep --quiet '^env =' "${HOME}/.config/mise/miserc.toml"; then
			echo 'Bare installation enabled a mise profile' >&2
			exit 1
		fi
		assert_absent "${HOME}/.ssh/config"
		assert_absent "${HOME}/.config/git/personal.gitconfig"
		assert_absent "${HOME}/.config/git/unsw.gitconfig"
		assert_absent "${HOME}/.ghr/github.com/risu729/biwa"
		if [[ -n ${selected_glab} ]]; then
			echo 'Bare installation enabled a personal tool' >&2
			exit 1
		fi
		;;
	*)
		echo 'Set TEST_PROFILE=bare or personal' >&2
		exit 1
		;;
	esac
	;;
linux)
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
	;;
macos)
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
	;;
*)
	echo 'Unknown installation probe' >&2
	exit 1
	;;
esac
