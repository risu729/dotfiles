#!/usr/bin/env bash

cd ~ || exit

# use apt-get instead of apt for scripts
# ref: https://manpages.ubuntu.com/manpages/trusty/man8/apt.8.html#:~:text=SCRIPT%20USAGE/
sudo apt-get update
sudo apt-get upgrade --yes

# from build-essential to git are required by Homebrew
# ref: https://docs.brew.sh/Homebrew-on-Linux#requirements
# wsl is required to open a browser from WSL
# cspell:ignore procps
sudo apt-get install --yes build-essential procps curl file git wslu

mkdir --parents ~/github
cd ~/github || exit

if [[ -d dotfiles ]]; then
	cd dotfiles || exit
	git pull
	cd ..
else
	git clone https://github.com/risu729/dotfiles.git dotfiles
fi
cd dotfiles/wsl || exit

wsl_dir="$(realpath .)"
cd "${wsl_dir}" || exit

paths="$(find . -type f ! -name "install.sh")"
for path in ${paths}; do
	# append to .bashrc or .profile because WSL has default .bashrc and .profile
	if [[ -f ${path} && ${path#./} == ".bashrc" ]]; then
		echo >>~/.bashrc
		cat "${path}" >>~/.bashrc
		echo installed "${path}"
		continue
	fi
	if [[ -f ${path} && ${path#./} == ".profile" ]]; then
		echo >>~/.profile
		cat "${path}" >>~/.profile
		echo installed "${path}"
		continue
	fi
	mkdir --parents "$(dirname "${HOME}/${path#./}")"
	ln --symbolic --no-dereference --force "${wsl_dir}/${path#./}" "${HOME}/${path#./}"
	echo installed "${path}"
done

# back to home directory
cd ~ || exit

brew_install="$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
echo "${brew_install}" | NONINTERACTIVE=1 bash
brew_env="$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"
eval "${brew_env}"
brew bundle install --global --no-lock
echo installed Homebrew

mise install --yes
echo installed mise

echo installed dotfiles!

# GitHub CLI does not support setting user.name and user.email automatically
# ref: https://github.com/cli/cli/issues/6096
# shellcheck disable=SC2154 # CI is defined in GitHub Actions
if [[ ${CI} == true ]]; then
	exit 0
fi

git config --global init.defaultBranch main

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
