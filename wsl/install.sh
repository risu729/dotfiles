#!/usr/bin/env bash

set -euxo pipefail

# might be edited by the worker to checkout a specific ref
git_ref=""

# use apt-get instead of apt for scripts
# ref: https://manpages.ubuntu.com/manpages/trusty/man8/apt.8.html#:~:text=SCRIPT%20USAGE/
sudo apt-get update
sudo apt-get full-upgrade --yes
sudo apt-get autoremove --yes
# cspell:ignore autoclean
sudo apt-get autoclean --yes

# not pre-installed in wsl ubuntu
# ref: https://cloud-images.ubuntu.com/wsl/noble/current/ubuntu-noble-wsl-amd64-wsl.manifest
sudo apt-get install --yes zip unzip build-essential

# use PPA for wslu as recommended
# ref: https://wslu.wedotstud.io/wslu/install.html#ubuntu
# wslu is for wslview, which opens Windows browser from WSL
# cspell:ignore wslutilities wslu wslview
sudo add-apt-repository --yes ppa:wslutilities/wslu

# create keyrings directory
sudo install --directory --mode=755 /etc/apt/keyrings

# install mise
# ref: https://mise.jdx.dev/getting-started.html#apt
curl --fail-with-body --silent --show-error --location https://mise.jdx.dev/gpg-key.pub \
	| gpg --dearmor \
	| sudo tee /etc/apt/keyrings/mise-archive-keyring.gpg 1>/dev/null
echo "deb [signed-by=/etc/apt/keyrings/mise-archive-keyring.gpg arch=amd64] https://mise.jdx.dev/deb stable main" \
	| sudo tee /etc/apt/sources.list.d/mise.list

# install docker
# ref: https://docs.docker.com/engine/install/ubuntu/#install-using-the-repository
curl --fail-with-body --silent --show-error --location https://download.docker.com/linux/ubuntu/gpg --output /etc/apt/keyrings/docker.asc
arch="$(dpkg --print-architecture)"
# shellcheck source=/dev/null
codename="$(source /etc/os-release && echo "${UBUNTU_CODENAME:-${VERSION_CODENAME}}")"
echo "deb [arch=${arch} signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${codename} stable" \
	| sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
# cspell:ignore containerd buildx
sudo install --yes wslu mise docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# use --parents to avoid error if the directory exists
repo="github.com/risu729/dotfiles"
dotfiles_dir="${HOME}/ghq/${repo}"
mkdir --parents "${dotfiles_dir}"
cd "${dotfiles_dir}"
if git rev-parse --is-inside-work-tree 1>/dev/null 2>&1; then
	git fetch --all --prune
	git pull --all
else
	git clone "https://${repo}.git" "${dotfiles_dir}"
fi

# checkout a specific ref if specified
if [[ -n ${git_ref} ]]; then
	git checkout "${git_ref}"
fi

wsl_dir="${dotfiles_dir}/wsl"
cd "${wsl_dir}"
wsl_home_dir="${wsl_dir}/home"

# create symbolic links for home directory
# exclude .gitignore-sync
# postpone .gitconfig to avoid auth error while installing mise tools
home_paths="$(find ./home -type f ! -name ".gitignore-sync" ! -name ".gitconfig")"
for path in ${home_paths}; do
	path="$(realpath "${path}")"
	if [[ ${path} == */.config/git/.gitignore ]]; then
		# ignore-sync doesn't support filename `ignore-sync`, so rename generated .gitignore to ignore
		target=".config/git/ignore"
	else
		target="$(realpath --relative-to="${wsl_home_dir}" "${path}")"
	fi
	mkdir --parents "$(dirname "${HOME}/${target}")"
	ln --symbolic --no-dereference --force "${path}" "${HOME}/${target}"
	# shellcheck disable=SC2088 # intentionally print ~ instead of $HOME
	echo installed "~/${target}"
done

# create symbolic links for etc directory
etc_paths="$(find ./etc -type f)"
for path in ${etc_paths}; do
	path="$(realpath "${path}")"
	target="/etc/$(realpath --relative-to="${wsl_dir}/etc" "${path}")"
	sudo mkdir --parents "$(dirname "${target}")"
	sudo ln --symbolic --no-dereference --force "${path}" "${target}"
	sudo chown root:root "${target}"
	# shellcheck disable=SC2088 # intentionally print ~ instead of $HOME
	echo installed "${target}"
done

# trust mise configs in dotfiles
mise trust --all
# back to home directory
cd "${HOME}"
# set jobs to 1 to avoid mise to hang somehow
mise install --yes --jobs=1
# tools already installed are not upgraded by mise install
mise upgrade --yes --jobs=1
# activate to use installed tools in setup-git.ts
mise_activate="$(mise activate bash)"
eval "${mise_activate}"
echo installed mise

ln --symbolic --no-dereference --force "${wsl_home_dir}/.gitconfig" "${HOME}/.gitconfig"

echo installed dotfiles!

# shellcheck disable=SC2154 # CI is defined in GitHub Actions, SKIP_GIT_SETUP may be defined as environment variable
if [[ ${CI:-} != true && ${SKIP_GIT_SETUP:-} != true ]]; then
	if ! "${wsl_dir}/setup-git.ts"; then
		echo "Failed to setup Git. Please run ${wsl_dir}/setup-git.ts manually."
		exit 1
	fi
fi
