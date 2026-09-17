#!/usr/bin/env bash

set -euo pipefail

repo_name="risu729/dotfiles"
# Only the shared part is installed by default, which is safe on a work machine.
# Set DOTFILES_PROFILE=personal to add the personal part.
profile="${DOTFILES_PROFILE-}"

RESET='\033[0m'
CYAN='\033[0;36m'
RED='\033[0;31m'

log_info() {
	echo -e "${CYAN}INFO: $1${RESET}" >&2
}

log_error() {
	echo -e "${RED}ERROR: $1${RESET}" >&2
}

ensure_command_line_tools() {
	# git is provided by the Xcode Command Line Tools
	if xcode-select -p >/dev/null 2>&1; then
		return
	fi
	log_info "Installing Xcode Command Line Tools..."
	xcode-select --install
	log_error "Finish the installation dialog, then run this script again."
	exit 1
}

install_mise() {
	if command -v mise >/dev/null 2>&1; then
		log_info "mise is already installed."
		return
	fi
	log_info "Installing mise..."
	# ref: https://mise.jdx.dev/installing-mise.html
	curl --fail --silent --show-error --location https://mise.run | sh
	export PATH="${HOME}/.local/bin:${PATH}"
	log_info "mise installed."
}

clone_or_update_dotfiles_repo() {
	local repo_url="github.com/${repo_name}"
	local dotfiles_target_dir="${HOME}/.ghr/${repo_url}"

	log_info "Preparing dotfiles repository: ${repo_name} in ${dotfiles_target_dir}"
	mkdir -p "${dotfiles_target_dir}"

	if git -C "${dotfiles_target_dir}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
		log_info "Existing repository found. Updating with mise..."
		# mise refuses to update a dirty worktree, a mismatched origin, or a
		# detached HEAD, so the installer does not stash or branch-check itself.
		mise trust --yes --all --cd "${dotfiles_target_dir}" >&2
		mise --cd "${dotfiles_target_dir}" bootstrap repos update \
			"${dotfiles_target_dir}" --yes --skip-dirty >&2
	else
		log_info "Cloning repository https://${repo_url}.git into ${dotfiles_target_dir}..."
		git clone "https://${repo_url}.git" "${dotfiles_target_dir}" >&2
	fi

	echo "${dotfiles_target_dir}"
}

main() {
	ensure_command_line_tools
	install_mise

	# mise reads the profile as its environment, which selects `mise.personal.toml`
	# and the `profile = "personal"` dotfile variants.
	if [[ -n ${profile} ]]; then
		export MISE_ENV="${profile}"
	fi

	local dotfiles_dir
	dotfiles_dir=$(clone_or_update_dotfiles_repo)

	log_info "Bootstrapping packages, dotfiles, and tools with mise..."
	mise trust --yes --all --cd "${dotfiles_dir}"
	mise --cd "${dotfiles_dir}" bootstrap --yes --update --force-dotfiles --locked --skip-dirty
	log_info "mise bootstrap completed."

	log_info "macOS setup script finished successfully!"
	log_info "Reminder: log out and back in for all changes to take effect."
}

main "$@"
