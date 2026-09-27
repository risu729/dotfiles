#!/usr/bin/env bash

set -euo pipefail

repo_name="risu729/dotfiles"
# might be edited by the worker to checkout a specific ref
git_ref=""
# Direct invocations can select the same revision as the Worker ref parameter.
git_ref="${DOTFILES_REF-${git_ref}}"
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
	# git and the C toolchain are provided by the Xcode Command Line Tools
	if ! xcode-select -p >/dev/null 2>&1; then
		log_info "Installing Xcode Command Line Tools..."
		# Fails when the installation dialog is already open
		xcode-select --install || true
		log_info "Accept the installation dialog. Waiting for it to finish..."
		log_info "Without a dialog, install the Command Line Tools entry listed by softwareupdate --list in another terminal."
		until xcode-select -p >/dev/null 2>&1; do
			sleep 5
		done
		log_info "Xcode Command Line Tools installed."
	fi

	# The installer puts mise here, which is not on the default macOS PATH. mise
	# also needs the Ruby 3 or newer it pours into the Homebrew prefix to
	# evaluate casks from third-party taps.
	export PATH="${HOME}/.local/bin:/opt/homebrew/bin:${PATH}"

	# The installer also upgrades an existing mise, like apt does on Linux, so
	# that `min_version` in mise.toml is met.
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

# Trust repository-local platform/profile configs and bootstrap fragments.
# Avoid `--all`: it also trusts configs in every parent directory.
trust_configs() {
	local repo_path="$1"
	local config
	for config in "${repo_path}"/mise.toml "${repo_path}"/mise.*.toml \
		"${repo_path}"/.config/mise/conf.d/*.toml; do
		# The glob stays literal when nothing matches
		[[ -e ${config} ]] || continue
		mise trust --yes "${config}" || return
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

	git -C "${repo_path}" checkout "${default_branch}" || return
	log_info "Successfully checked out ${default_branch}."
}

select_dotfiles_revision() {
	local repo_path="$1"
	local target_git_ref="$2"
	local expected_origin="$3"

	local actual_origin worktree_status
	actual_origin=$(git -C "${repo_path}" remote get-url origin) || return
	worktree_status=$(git -C "${repo_path}" status --porcelain) || return
	if [[ ${actual_origin} != "${expected_origin}" ]]; then
		log_error "Refusing to update a repository with a different origin: ${repo_path}"
		return 1
	fi

	if [[ -n ${worktree_status} ]]; then
		log_error "Refusing to switch revisions in a dirty repository: ${repo_path}"
		return 1
	fi

	if [[ -n ${target_git_ref} ]]; then
		# Fetch before checkout so an existing clone can install a new branch or
		# commit. Detaching keeps bootstrap's repository updates off this revision.
		git -C "${repo_path}" fetch origin -- "${target_git_ref}" || return
		git -C "${repo_path}" checkout --detach FETCH_HEAD || return
	else
		# A previous explicit-ref install may have left HEAD detached. Return to
		# the default branch before asking mise to update the repository.
		# shellcheck disable=SC2310 # Helpers explicitly propagate command failures.
		checkout_default_git_branch "${repo_path}" || return
		# shellcheck disable=SC2310 # Helpers explicitly propagate command failures.
		trust_configs "${repo_path}" || return
		mise --cd "${repo_path}" bootstrap repos update \
			"${repo_path}" --yes --skip-dirty
	fi
}

clone_or_update_dotfiles_repo() {
	local target_git_ref="$1"
	local repo_url="https://github.com/${repo_name}.git"
	local dotfiles_target_dir="${HOME}/.ghr/github.com/${repo_name}"

	log_info "Preparing dotfiles repository: ${repo_name} in ${dotfiles_target_dir}"
	if ! git -C "${dotfiles_target_dir}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
		mkdir -p "${dotfiles_target_dir}" || return
		git clone "${repo_url}" "${dotfiles_target_dir}" >&2 || return
	fi

	# shellcheck disable=SC2310 # Helpers explicitly propagate command failures.
	select_dotfiles_revision "${dotfiles_target_dir}" "${target_git_ref}" "${repo_url}" >&2 || return
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
	log_info "mise bootstrap completed."

	log_info "Setup script finished successfully!"
	log_info "Reminder: you might need to start a new shell for all changes to take effect."
}

# Sourcing exposes the revision helpers to isolated regression tests.
if [[ ${BASH_SOURCE[0]:-$0} == "$0" ]]; then
	main "$@"
fi
