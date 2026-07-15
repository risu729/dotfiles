#!/usr/bin/env bash

set -euo pipefail

repo_name="risu729/dotfiles"
# might be edited by the worker to checkout a specific ref
git_ref=""

RESET='\033[0m'
CYAN='\033[0;36m'
RED='\033[0;31m'

log_info() {
	echo -e "${CYAN}INFO: $1${RESET}" >&2
}

log_error() {
	echo -e "${RED}ERROR: $1${RESET}" >&2
}

install_mise() {
	log_info "Adding mise PPA..."
	# ref: https://mise.jdx.dev/installing-mise.html#apt
	sudo add-apt-repository --yes --no-update ppa:jdxcode/mise

	log_info "Installing mise..."
	sudo apt-get update
	sudo apt-get install --yes mise
	log_info "mise installed."
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
		log_info "Existing repository found."

		local has_changes
		has_changes=false
		if ! git diff --quiet HEAD || ! git diff --cached --quiet HEAD; then
			has_changes=true
		else
			local untracked_files
			untracked_files=$(git ls-files --others --exclude-standard)
			if [[ -n ${untracked_files} ]]; then
				has_changes=true
			fi
		fi
		if [[ ${has_changes} == true ]]; then
			log_info "Local changes detected. Stashing..."
			git stash push --include-untracked --message "Auto-stashed by dotfiles installer script" >&2
			log_info "Changes stashed."
		fi

		log_info "Pulling updates..."
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
		# If not checking out a specific ref, ensure we are on the default branch
		# and that it's up-to-date (which pull/fetch should have handled).
		# The checkout_default_git_branch might be redundant if pull/fetch worked,
		# but it ensures the correct branch is checked out if it wasn't already.
		checkout_default_git_branch "${dotfiles_target_dir}" >&2
	fi

	cd "${original_dir}"
	echo "${dotfiles_target_dir}"
}

create_etc_symlinks() {
	local wsl_config_dir="$1"
	local repo_root
	repo_root="$(realpath "${wsl_config_dir}/..")"
	local wsl_etc_config_dir
	wsl_etc_config_dir="$(realpath "${wsl_config_dir}/etc")"

	log_info "Creating symbolic links for etc directory files from ${wsl_etc_config_dir}..."
	local wsl_etc_config_relative_dir
	wsl_etc_config_relative_dir="$(realpath --relative-to="${repo_root}" "${wsl_etc_config_dir}")"
	local etc_paths_file
	etc_paths_file="$(mktemp)"
	git -C "${repo_root}" ls-files -z -- "${wsl_etc_config_relative_dir}" >"${etc_paths_file}"
	local etc_paths=()
	while IFS= read -r -d '' path; do
		etc_paths+=("${repo_root}/${path}")
	done <"${etc_paths_file}"
	rm -- "${etc_paths_file}"

	if ((${#etc_paths[@]} == 0)); then
		log_error "No etc directory files found to symlink."
		exit 1
	fi

	for path in "${etc_paths[@]}"; do
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

main() {
	install_mise

	local dotfiles_dir
	dotfiles_dir=$(clone_or_update_dotfiles_repo "${repo_name}" "${git_ref}")

	local wsl_config_dir="${dotfiles_dir}/wsl"
	create_etc_symlinks "${wsl_config_dir}"

	log_info "Bootstrapping packages, dotfiles, and tools with mise..."
	mise trust --yes "${dotfiles_dir}/mise.toml"
	mise --cd "${dotfiles_dir}" bootstrap --yes --update --force-dotfiles --locked
	log_info "mise bootstrap completed."

	checkout_default_git_branch "${dotfiles_dir}"

	log_info "WSL setup script finished successfully!"
	log_info "Reminder: you might need to start a new shell for all changes to take effect."
}

main "$@"
