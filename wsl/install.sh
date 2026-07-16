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

	if [[ -z ${default_branch} ]]; then
		log_error "Could not determine the default branch for '${repo_path}'."
		exit 1
	fi

	git checkout "${default_branch}"
	log_info "Successfully checked out ${default_branch}."

	cd "${original_dir}"
}

clone_or_update_dotfiles_repo() {
	local target_git_ref="$1"

	local repo_url="github.com/${repo_name}"
	local dotfiles_target_dir="${HOME}/.ghr/${repo_url}"

	log_info "Preparing dotfiles repository: ${repo_name} in ${dotfiles_target_dir}"
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
		git clone "https://${repo_url}.git" "${dotfiles_target_dir}" >&2
	fi

	# Checkout a specific ref if specified
	if [[ -n ${target_git_ref} ]]; then
		log_info "Checking out specified git ref for setup: ${target_git_ref}..."
		git checkout "${target_git_ref}" >&2
		log_info "Successfully checked out ${target_git_ref}."
	else
		# If not checking out a specific ref, ensure we are on the default branch
		# and that it's up-to-date (which pull/fetch should have handled).
		# An existing repository may have had a different branch checked out.
		checkout_default_git_branch "${dotfiles_target_dir}" >&2
	fi

	cd "${original_dir}"
	echo "${dotfiles_target_dir}"
}

main() {
	install_mise

	local dotfiles_dir
	dotfiles_dir=$(clone_or_update_dotfiles_repo "${git_ref}")

	log_info "Bootstrapping packages, dotfiles, and tools with mise..."
	mise trust --yes "${dotfiles_dir}/mise.toml"
	mise --cd "${dotfiles_dir}" bootstrap --yes --update --force-dotfiles --locked
	log_info "mise bootstrap completed."

	if [[ -n ${git_ref} ]]; then
		checkout_default_git_branch "${dotfiles_dir}"
	fi

	log_info "WSL setup script finished successfully!"
	log_info "Reminder: you might need to start a new shell for all changes to take effect."
}

main "$@"
