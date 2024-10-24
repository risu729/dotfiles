#!/usr/bin/env bash

set -euo pipefail

# might be edited by the worker to checkout a specific ref
git_ref=""

# use apt-get instead of apt for scripts
# ref: https://manpages.ubuntu.com/manpages/trusty/man8/apt.8.html#:~:text=SCRIPT%20USAGE/
sudo apt-get update
sudo apt-get upgrade --yes

# not pre-installed in wsl2 ubuntu (at least in 24.04)
# software-properties-common is required for add-apt-repository
sudo apt-get install --yes zip unzip software-properties-common

# use PPA for wslu as recommended
# ref: https://wslutiliti.es/wslu/install.html#ubuntu
# wslu is for wslview, which opens Windows browser from WSL
# cspell:ignore wslutilities wslu wslview
sudo add-apt-repository ppa:wslutilities/wslu
sudo apt-get update
sudo apt-get install --yes wslu

# install mise
# ref: https://mise.jdx.dev/getting-started.html#apt
sudo install -dm 755 /etc/apt/keyrings
wget -qO - https://mise.jdx.dev/gpg-key.pub | gpg --dearmor | sudo tee /etc/apt/keyrings/mise-archive-keyring.gpg 1>/dev/null
echo "deb [signed-by=/etc/apt/keyrings/mise-archive-keyring.gpg arch=amd64] https://mise.jdx.dev/deb stable main" | sudo tee /etc/apt/sources.list.d/mise.list
sudo apt-get update
sudo apt-get install -y mise

# use --parents to avoid error if the directory exists
mkdir --parents "${HOME}/github"
dotfiles_dir="${HOME}/github/dotfiles"
if [[ -d ${dotfiles_dir} ]]; then
	cd "${HOME}/github/dotfiles"
	git fetch --all --prune
	git pull
else
	cd "${HOME}/github"
	git clone https://github.com/risu729/dotfiles.git dotfiles
fi

cd "${dotfiles_dir}"
# checkout a specific ref if specified
if [[ -n ${git_ref} ]]; then
	git checkout "${git_ref}"
fi

wsl_dir="${dotfiles_dir}/wsl"
cd "${wsl_dir}"

paths="$(find . -type f ! -name "install.sh" ! -name "setup-git.ts" ! -name ".gitignore-sync")"
for path in ${paths}; do
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
cd "${HOME}"

mise install --yes
# activate mise shims for bun scripts
mise_shims="$(mise activate bash --shims)"
eval "${mise_shims}"
echo installed mise

echo installed dotfiles!

# shellcheck disable=SC2154 # CI is defined in GitHub Actions, SKIP_GIT_SETUP may be defined as environment variable
if [[ ${CI} != true && ${SKIP_GIT_SETUP} != true ]]; then
	if ! "${wsl_dir}/setup-git.ts"; then
		echo "Failed to setup Git. Please run ${wsl_dir}/setup-git.ts manually."
		exit 1
	fi
fi
