#!/usr/bin/env bash

set -euo pipefail

# must be edited by the worker to use the correct GitHub repository
repo_name=""
# might be edited by the worker to checkout a specific ref
git_ref=""

RESET='\033[0m'
CYAN='\033[0;36m'
YELLOW='\033[0;33m'
RED='\033[0;31m'

log_info() {
	echo -e "${CYAN}INFO: $1${RESET}" >&2
}

log_warn() {
	echo -e "${YELLOW}WARNING: $1${RESET}" >&2
}

log_error() {
	echo -e "${RED}ERROR: $1${RESET}" >&2
}

update_system_packages() {
	log_info "Updating system packages..."
	sudo apt-get update
	sudo apt-get full-upgrade --yes
	sudo apt-get autoremove --yes
	# cspell:ignore autoclean
	sudo apt-get autoclean --yes
	log_info "System packages updated."
}

install_system_packages() {
	log_info "Installing system packages..."
	# not pre-installed in wsl ubuntu
	# ref: https://cdimages.ubuntu.com/ubuntu-wsl/noble/daily-live/current/noble-wsl-amd64.manifest
	sudo apt-get install --yes zip unzip build-essential pkg-config libssl-dev
	log_info "Core packages installed."
}

install_custom_registry_packages() {
	log_info "Setting up custom APT repositories and installing additional packages..."

	# use PPA for wslu as recommended
	# ref: https://wslu.wedotstud.io/wslu/install.html#ubuntu
	# wslu is for wslview, which opens Windows browser from WSL
	# cspell:ignore wslutilities wslu wslview
	sudo add-apt-repository --yes ppa:wslutilities/wslu

	sudo install --directory --mode=0755 /etc/apt/keyrings

	log_info "Adding mise APT repository..."
	# ref: https://mise.jdx.dev/getting-started.html#apt
	curl --fail-with-body --silent --show-error --location https://mise.jdx.dev/gpg-key.pub |
		gpg --dearmor |
		sudo tee /etc/apt/keyrings/mise-archive-keyring.gpg >/dev/null
	echo "deb [signed-by=/etc/apt/keyrings/mise-archive-keyring.gpg arch=amd64] https://mise.jdx.dev/deb stable main" |
		sudo tee /etc/apt/sources.list.d/mise.list >/dev/null

	log_info "Adding Docker APT repository..."
	# ref: https://docs.docker.com/engine/install/ubuntu/#install-using-the-repository
	curl --fail-with-body --silent --show-error --location https://download.docker.com/linux/ubuntu/gpg |
		sudo tee /etc/apt/keyrings/docker.asc >/dev/null
	local arch
	arch="$(dpkg --print-architecture)"
	local codename
	# shellcheck source=/dev/null
	codename="$(source /etc/os-release && echo "${UBUNTU_CODENAME:-${VERSION_CODENAME}}")"
	echo "deb [arch=${arch} signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${codename} stable" |
		sudo tee /etc/apt/sources.list.d/docker.list >/dev/null

	log_info "All repositories set up. Installing packages..."
	sudo apt-get update
	# cspell:ignore containerd buildx
	sudo apt-get install --yes wslu mise docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
	log_info "Additional packages installed."
}

configure_docker_group() {
	log_info "Configuring Docker group..."
	local username
	username=$(whoami)
	if groups "${username}" | grep --quiet --word-regexp 'docker'; then
		log_info "User ${username} is already in the docker group."
	else
		# cspell:ignore usermod
		sudo usermod --append --groups docker "${username}"
		log_info "User ${username} added to the docker group."
	fi
}

checkout_default_git_branch() {
	local repo_path="$1"
	log_info "Checking out default branch..."

	local original_dir
	original_dir=$(pwd)

	cd "${repo_path}"

	local git_remote
	git_remote=$(git remote show origin 2>/dev/null)
	local default_branch
	default_branch=$(echo "${git_remote}" | grep --only-matching --perl-regexp 'HEAD branch: \K.+')
	default_branch=$(echo "${default_branch}" | tr --delete '\n')

	if [[ -z ${default_branch} ]]; then
		log_error "Could not determine the default branch for '${repo_path}'."
		exit 1
	fi

	git checkout "${default_branch}"
	log_info "Successfully checked out ${default_branch}."

	cd "${original_dir}"
}

clone_or_update_dotfiles_repo() {
	local target_repo_name="$1"
	local target_git_ref="$2"

	if [[ -z ${target_repo_name} ]]; then
		log_error "Repository name not provided to clone_or_update_dotfiles_repo function."
		exit 1
	fi

	local repo_url="github.com/${target_repo_name}"
	local dotfiles_target_dir="${HOME}/.ghr/${repo_url}"

	log_info "Preparing dotfiles repository: ${target_repo_name} in ${dotfiles_target_dir}"
	mkdir --parents "${dotfiles_target_dir}"

	local original_dir
	original_dir=$(pwd)
	cd "${dotfiles_target_dir}"

	if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
		log_info "Existing repository found. Pulling updates..."
		# Do not pull if on a detached HEAD.
		if git symbolic-ref --quiet HEAD >/dev/null; then
			git pull --all --prune >&2
		else
			git fetch --all --prune >&2
		fi
	else
		log_info "Cloning repository https://${repo_url}.git into ${dotfiles_target_dir}..."
		git clone --origin origin "https://${repo_url}.git" "${dotfiles_target_dir}" >&2
	fi

	# Checkout a specific ref if specified
	if [[ -n ${target_git_ref} ]]; then
		log_info "Checking out specified git ref for setup: ${target_git_ref}..."
		git checkout "${target_git_ref}" >&2
		log_info "Successfully checked out ${target_git_ref}."
	else
		checkout_default_git_branch "${dotfiles_target_dir}" >&2
	fi

	cd "${original_dir}"
	echo "${dotfiles_target_dir}"
}

create_home_symlinks() {
	local wsl_config_dir="$1"
	local wsl_home_config_dir="${wsl_config_dir}/home"

	log_info "Creating symbolic links for home directory files from ${wsl_home_config_dir}..."
	# Exclude .gitignore-sync and postpone .gitconfig
	local home_paths
	home_paths="$(find "${wsl_home_config_dir}" -type f ! -name ".gitignore-sync" ! -name ".gitconfig")"

	if [[ -z ${home_paths} ]]; then
		log_error "No home directory files found to symlink."
		exit 1
	fi

	for path in ${home_paths}; do
		local target_name
		local full_path
		full_path=$(realpath "${path}")

		if [[ ${full_path} == */.config/git/.gitignore ]]; then
			# ignore-sync doesn't support filename `ignore-sync`, so rename generated .gitignore to ignore
			target_name=".config/git/ignore"
		else
			target_name="$(realpath --relative-to="${wsl_home_config_dir}" "${full_path}")"
		fi
		local target_path="${HOME}/${target_name}"

		mkdir --parents "$(dirname "${target_path}")"
		ln --symbolic --no-dereference --force "${full_path}" "${target_path}"
		# shellcheck disable=SC2088 # intentionally print ~ instead of $HOME
		log_info "Installed symlink: ~/${target_name}"
	done
}

create_etc_symlinks() {
	local wsl_config_dir="$1"
	local wsl_etc_config_dir="${wsl_config_dir}/etc"

	log_info "Creating symbolic links for etc directory files from ${wsl_etc_config_dir}..."
	local etc_paths
	etc_paths="$(find "${wsl_etc_config_dir}" -type f)"

	if [[ -z ${etc_paths} ]]; then
		log_error "No etc directory files found to symlink."
		exit 1
	fi

	for path in ${etc_paths}; do
		local full_path
		full_path=$(realpath "${path}")
		local target_name
		target_name="$(realpath --relative-to="${wsl_etc_config_dir}" "${full_path}")"
		local target_path="/etc/${target_name}"

		sudo mkdir --parents "$(dirname "${target_path}")"
		sudo ln --symbolic --no-dereference --force "${full_path}" "${target_path}"
		sudo chown root:root "${target_path}"
		log_info "Installed symlink: ${target_path}"
	done
}

install_mise_tools() {
	log_info "Installing global mise tools..."

	mise trust --all

	log_info "Installing tools..."
	mise install --yes
	log_info "Upgrading tools..."
	mise upgrade --yes
	log_info "mise tools installed and upgraded."
}

symlink_gitconfig() {
	local wsl_config_dir="$1"
	local gitconfig_source="${wsl_config_dir}/home/.gitconfig"
	local gitconfig_target="${HOME}/.gitconfig"

	log_info "Symlinking .gitconfig from ${gitconfig_source} to ${gitconfig_target}..."
	ln --symbolic --no-dereference --force "${gitconfig_source}" "${gitconfig_target}"
	# shellcheck disable=SC2088 # intentionally print ~ instead of $HOME
	log_info "Installed symlink for ~/.gitconfig"
}

init_gnupg_dir() {
	local gnupg_home
	gnupg_home="${HOME}/.gnupg"

	log_info "Initializing GnuPG directory: ${gnupg_home}"

	mkdir -p "${gnupg_home}"
	chmod 700 "${gnupg_home}"

	echo "GnuPG directory created."
}

run_git_setup_script() {
	local dotfiles_repo_root_path="$1"
	local setup_script_path="${dotfiles_repo_root_path}/wsl/setup-git.ts"

	if [[ ${CI:-false} == "true" ]]; then
		log_info "CI environment detected. Skipping git setup script: ${setup_script_path}"
		return
	fi
	if [[ ${SKIP_GIT_SETUP:-false} == "true" ]]; then
		log_info "SKIP_GIT_SETUP is true. Skipping git setup script: ${setup_script_path}"
		return
	fi

	log_info "Running git setup script: ${setup_script_path}"

	if "${setup_script_path}"; then
		log_info "Git setup script completed successfully."
	else
		log_error "Failed to run ${setup_script_path}. Please run it manually if needed."
	fi
}

main() {
	update_system_packages
	install_system_packages
	install_custom_registry_packages
	configure_docker_group

	local dotfiles_dir
	dotfiles_dir=$(clone_or_update_dotfiles_repo "${repo_name}" "${git_ref}")

	local wsl_config_dir="${dotfiles_dir}/wsl"
	create_home_symlinks "${wsl_config_dir}"
	create_etc_symlinks "${wsl_config_dir}"

	install_mise_tools

	# Postpone .gitconfig to avoid authentication errors in install_mise_tools
	symlink_gitconfig "${wsl_config_dir}"

	init_gnupg_dir

	run_git_setup_script "${dotfiles_dir}"

	checkout_default_git_branch "${dotfiles_dir}"

	log_info "WSL setup script finished successfully!"
	log_info "Reminder: you might need to start a new shell for all changes to take effect."
}

main "$@"
