#!/usr/bin/env bash

set -euo pipefail

repo_name="risu729/dotfiles"
# might be edited by the worker to checkout a specific ref
git_ref=""
# might be edited by the worker to select a profile
profile=""
# DOTFILES_PROFILE takes precedence. Without a profile only the shared part is
# installed, which is safe on a work machine; `personal` adds the rest.
profile="${DOTFILES_PROFILE-${profile}}"

RESET='\033[0m'
CYAN='\033[0;36m'
RED='\033[0;31m'

log_info() {
	echo -e "${CYAN}INFO: $1${RESET}" >&2
}

log_error() {
	echo -e "${RED}ERROR: $1${RESET}" >&2
}

# macOS ships BSD userland, so only flags common to GNU and BSD are used below.
os="$(uname -s)"

install_mise_linux() {
	log_info "Installing extrepo..."
	# ref: https://mise.jdx.dev/installing-mise.html#apt
	sudo apt-get update
	sudo apt-get install --yes extrepo

	log_info "Adding mise APT repository..."
	sudo extrepo enable mise

	log_info "Installing mise..."
	sudo apt-get update
	sudo apt-get install --yes mise
}

install_mise_macos() {
	# git is provided by the Xcode Command Line Tools
	if ! xcode-select -p >/dev/null 2>&1; then
		log_info "Installing Xcode Command Line Tools..."
		# Fails when the installation dialog is already open
		xcode-select --install || true
		log_error "Finish the installation dialog, then run this script again."
		exit 1
	fi

	# The installer puts mise here, which is not on the default macOS PATH.
	export PATH="${HOME}/.local/bin:${PATH}"
	if command -v mise >/dev/null 2>&1; then
		log_info "mise is already installed."
		return
	fi

	log_info "Installing mise..."
	# ref: https://mise.jdx.dev/installing-mise.html
	curl --fail --silent --show-error --location https://mise.run | sh
}

install_mise() {
	case "${os}" in
	Linux) install_mise_linux ;;
	Darwin) install_mise_macos ;;
	*)
		log_error "Unsupported operating system: ${os}"
		exit 1
		;;
	esac
	log_info "mise installed."
}

# Trust the platform and profile configs next to mise.toml as well. `--all` is
# avoided because it also trusts configs in every parent directory.
trust_configs() {
	local repo_path="$1"
	local config
	for config in "${repo_path}"/mise.toml "${repo_path}"/mise.*.toml; do
		# The glob stays literal when nothing matches
		[[ -e ${config} ]] || continue
		mise trust --yes "${config}"
	done
}

checkout_default_git_branch() {
	local repo_path="$1"
	log_info "Checking out default branch..."

	local git_remote
	# The label parsed below is translated in other locales
	git_remote=$(LC_ALL=C git -C "${repo_path}" remote show origin 2>/dev/null)
	local default_branch
	default_branch=$(echo "${git_remote}" | sed -n 's/^ *HEAD branch: //p')

	if [[ -z ${default_branch} ]]; then
		log_error "Could not determine the default branch for '${repo_path}'."
		exit 1
	fi

	git -C "${repo_path}" checkout "${default_branch}"
	log_info "Successfully checked out ${default_branch}."
}

clone_or_update_dotfiles_repo() {
	local target_git_ref="$1"

	local repo_url="github.com/${repo_name}"
	local dotfiles_target_dir="${HOME}/.ghr/${repo_url}"

	log_info "Preparing dotfiles repository: ${repo_name} in ${dotfiles_target_dir}"
	mkdir -p "${dotfiles_target_dir}"

	if git -C "${dotfiles_target_dir}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
		log_info "Existing repository found. Updating with mise..."
		# mise refuses to update a dirty worktree, a mismatched origin, or a
		# detached HEAD, so the installer does not stash or branch-check itself.
		trust_configs "${dotfiles_target_dir}" >&2
		mise --cd "${dotfiles_target_dir}" bootstrap repos update \
			"${dotfiles_target_dir}" --yes --skip-dirty >&2
	else
		log_info "Cloning repository https://${repo_url}.git into ${dotfiles_target_dir}..."
		git clone "https://${repo_url}.git" "${dotfiles_target_dir}" >&2
	fi

	# Checkout a specific ref if specified
	if [[ -n ${target_git_ref} ]]; then
		log_info "Checking out specified git ref for setup: ${target_git_ref}..."
		git -C "${dotfiles_target_dir}" checkout "${target_git_ref}" >&2
		log_info "Successfully checked out ${target_git_ref}."
	else
		# If not checking out a specific ref, ensure we are on the default branch.
		# An existing repository may have had a different branch checked out.
		checkout_default_git_branch "${dotfiles_target_dir}" >&2
	fi

	echo "${dotfiles_target_dir}"
}

main() {
	install_mise

	# `.miserc.toml` is discovered from the working directory, not from `--cd`, and
	# `~/.config/mise/miserc.toml` does not exist on the first run, so enable the
	# platform configs (`mise.linux.toml`, `mise.macos.toml`) explicitly.
	export MISE_AUTO_ENV=true

	# mise reads the profile as its environment, which selects `mise.personal.toml`
	# and the `profile = "personal"` dotfile variants. The bootstrap renders it into
	# `~/.config/mise/miserc.toml`, so later runs keep the profile without this.
	if [[ -n ${profile} ]]; then
		log_info "Using the ${profile} profile."
		export MISE_ENV="${profile}"
	fi

	local dotfiles_dir
	dotfiles_dir=$(clone_or_update_dotfiles_repo "${git_ref}")

	log_info "Bootstrapping packages, dotfiles, and tools with mise..."
	trust_configs "${dotfiles_dir}"
	mise --cd "${dotfiles_dir}" bootstrap --yes --update --force-dotfiles --locked --skip-dirty
	# A path that moved from a directory entry to a narrower one is unlinked by the
	# directory entry's cleanup and only comes back on the next apply.
	mise --cd "${dotfiles_dir}" bootstrap --only dotfiles --yes --force-dotfiles
	log_info "mise bootstrap completed."

	if [[ -n ${git_ref} ]]; then
		checkout_default_git_branch "${dotfiles_dir}"
	fi

	log_info "Setup script finished successfully!"
	log_info "Reminder: you might need to start a new shell for all changes to take effect."
}

main "$@"
