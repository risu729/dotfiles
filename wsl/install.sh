#!/usr/bin/env bash

# might be edited by the worker to checkout a specific ref
git_ref=""

set -e

cd ~ || exit

# use apt-get instead of apt for scripts
# ref: https://manpages.ubuntu.com/manpages/trusty/man8/apt.8.html#:~:text=SCRIPT%20USAGE/
sudo apt-get update
sudo apt-get upgrade --yes

# from build-essential to git are required by Homebrew
# ref: https://docs.brew.sh/Homebrew-on-Linux#requirements
# wslu is required to open a browser from WSL
# cspell:ignore procps wslu
sudo apt-get install --yes build-essential procps curl file git wslu

mkdir --parents ~/github
cd ~/github || exit

if [[ -d dotfiles ]]; then
	cd dotfiles || exit
	git fetch --all --prune
	git pull
	cd ..
else
	git clone https://github.com/risu729/dotfiles.git dotfiles
fi
cd dotfiles || exit

# checkout a specific ref if specified
if [[ -n ${git_ref} ]]; then
	git checkout "${git_ref}"
fi

wsl_dir="$(realpath ./wsl)"
cd "${wsl_dir}" || exit

paths="$(find . -type f ! -name "install.sh" ! -name "setup-git.sh" ! -name ".gitignore-sync")"
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
	if [[ -f ${path} && ${path#./} == ".config/git/.gitignore" ]]; then
		# ignore-sync doesn't support filename `ignore-sync`, so rename generated .gitignore to ignore
		ln --symbolic --no-dereference --force "${wsl_dir}/${path#./}" "${HOME}/.config/git/ignore"
		continue
	else
		ln --symbolic --no-dereference --force "${wsl_dir}/${path#./}" "${HOME}/${path#./}"
	fi
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

# specifying the source file is not supported by vscode extension
# ref: https://github.com/vscode-shellcheck/vscode-shellcheck/issues/19
# Homebrew
brew_env="$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"
eval "${brew_env}"

# mise-en-place
mise_activate="$(mise activate bash)"
eval "${mise_activate}"
alias mr="mise run"

# mise-en-place
mise_shims="$(mise activate bash --shims)"
eval "${mise_shims}"

# cspell:ignore reshim
# mise reshim is required to avoid "No such file or directory" error
# ref: https://github.com/jdx/mise/issues/2260
# exit with 0 to ignore the error
mise install --yes || true
mise reshim
mise install --yes
echo installed mise

echo installed dotfiles!

# shellcheck disable=SC2154 # CI is defined in GitHub Actions, SKIP_GIT_SETUP may be defined as environment variable
if [[ ${CI} != true && ${SKIP_GIT_SETUP} != true ]]; then
	~/github/dotfiles/wsl/setup-git.sh
fi
