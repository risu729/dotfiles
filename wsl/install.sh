#!/usr/bin/env bash

cd ~ || exit

# use apt-get instead of apt for scripts
# ref: https://manpages.ubuntu.com/manpages/trusty/man8/apt.8.html#:~:text=SCRIPT%20USAGE/
# cspell:ignore wslutilities wslu
sudo add-apt-repository ppa:wslutilities/wslu
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

paths="$(find . -type f ! -name "install.sh" ! -name "setup-git.sh")"
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

# shellcheck disable=SC2154 # CI is defined in GitHub Actions, SKIP_GIT_SETUP may be defined as environment variable
if [[ ${CI} != true || ${SKIP_GIT_SETUP} != true ]]; then
	~/github/dotfiles/wsl/setup-git.sh
fi
