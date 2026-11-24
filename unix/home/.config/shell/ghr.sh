# shellcheck shell=bash
# Shared Bash/Zsh wrapper. Source after the shell's completion setup.
# `command ghr` bypasses this wrapper and invokes the installed executable.

__ghr_cd() {
	local repo_path selected

	if (($# > 0)); then
		repo_path=$(command ghr path "$@") || return
		cd "${repo_path}" || return
		return
	fi

	if ! command -v fzf >/dev/null 2>&1; then
		printf 'error: fzf is required for interactive ghr cd\n' >&2
		return 1
	fi

	# shellcheck disable=SC2312 # Repository selection is best-effort interactive input.
	selected=$(
		paste <(command ghr list) <(command ghr list --path) |
			fzf --prompt='ghr cd> ' --height=80% --reverse --with-nth=1
	) || return
	[[ -n ${selected} ]] || return 1
	repo_path=${selected#*$'\t'}
	[[ -n ${repo_path} ]] || return 1
	cd "${repo_path}" || return
}
ghr() {
	local arg has_cd=false
	local -a cd_args=()

	for arg in "$@"; do
		if [[ ${arg} == "-h" || ${arg} == "--help" ]]; then
			command ghr "$@"
			return
		fi
	done

	if (($# > 0)); then
		case "$1" in
		cd)
			shift
			__ghr_cd "$@"
			return
			;;
		clone | init)
			for arg in "${@:2}"; do
				if [[ ${arg} == "--cd" ]]; then
					has_cd=true
				else
					cd_args+=("${arg}")
				fi
			done
			if [[ ${has_cd} == true ]]; then
				command ghr "$@" || return
				__ghr_cd "${cd_args[@]}"
				return
			fi
			;;
		*) ;;
		esac
	fi

	command ghr "$@"
}
