#!/usr/bin/env bash

set -euo pipefail

git config --global init.defaultBranch main

# GitHub CLI does not support setting user.name and user.email automatically
# ref: https://github.com/cli/cli/issues/6096
git_username=$(git config --global user.email)
if [[ -z ${git_username} ]]; then
	# -r: raw input, -p: prompt
	read -r -p "Enter your Git username: " git_username
	git config --global user.name "${git_username}"
	echo configured git username
fi
git_email=$(git config --global user.email)
if [[ -z ${git_email} ]]; then
	read -r -p "Enter your Git email: " git_email
	git config --global user.email "${git_email}"
	echo configured git email
fi

# login to GitHub if not logged in or does not have write:gpg_key scope
if ! gh auth status | grep --quiet "write:gpg_key"; then
	gh auth login --web --git-protocol https --scopes write:gpg_key
fi

# cspell:ignore gpgsign
git config --global commit.gpgsign true

# cspell:ignore signingkey
git_signingKey=$(git config --global user.signingkey)
if [[ -n ${git_signingKey} ]]; then
	github_gpg_keys=$(gh api --header "Accept: application/vnd.github+json" --header "X-GitHub-Api-Version: 2022-11-28" /user/gpg_keys)
	# disable history to use `!` in jq
	set +o history
	# cspell:ignore subkeys
	gpg_key_already_exists=$(echo "${github_gpg_keys}" | jq "[.[].subkeys[].key_id] | map(. + \"!\") | any(. == \"${git_signingKey}\")")
	set -o history
fi
if [[ -z ${git_signingKey} || ${gpg_key_already_exists} == false ]]; then
	# generate GPG key
	gpg --quick-gen-key "${git_username} <${git_email}>" ed25519 cert 0

	# cspell:ignore keyid
	keys_list=$(gpg --list-keys --keyid-format=long)
	key_fingerprint=$(echo "${keys_list}" | grep --after-context=1 '^pub' | grep --invert-match '^pub' | sed 's/^[[:space:]]*//' || true)

	# add sub key for signing
	gpg --quick-add-key "${key_fingerprint}" ed25519 sign

	# set sub key as git signing key
	keys_list=$(gpg --list-keys --keyid-format=long)
	sub_key_id=$(echo "${keys_list}" | grep '^sub' | cut --delimiter='/' --fields=2 | cut --delimiter=' ' --fields=1 || true)
	git config --global user.signingkey "${sub_key_id}!"

	# register GPG key to GitHub
	pub_key=$(gpg --export --armor "${key_fingerprint}")
	hostname=$(hostname)
	username=$(whoami)
	echo "${pub_key}" | gh gpg-key add --title "${username}@${hostname}"

	echo configured git signing key
fi
