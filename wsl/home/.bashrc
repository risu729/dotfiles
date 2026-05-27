# ~/.bashrc: executed by bash(1) for non-login shells.
# see /usr/share/doc/bash/examples/startup-files (in the package bash-doc) for examples

# shellcheck disable=SC2148 # shebang is not required in .bashrc

# Activate mise
if command -v mise &>/dev/null; then
	mise_activate="$(mise activate bash)"
	eval "${mise_activate}"
fi

# If not running interactively, skip other steps
if [[ ! $- =~ i ]]; then
	return
fi

# VSCode extensions call bash in interactive mode
# ref: https://code.visualstudio.com/docs/editor/command-line#_how-do-i-detect-when-a-shell-was-launched-by-vs-code
if [[ ${VSCODE_RESOLVING_ENVIRONMENT:-} == 1 ]]; then
	return
fi

# Don't put duplicate lines or lines starting with space in the history.
export HISTCONTROL=ignoreboth

# Append to the history file, don't overwrite it
shopt -s histappend

# For setting history length
export HISTSIZE=1000
export HISTFILESIZE=2000

shopt -s checkwinsize
shopt -s globstar

# Make less more friendly for non-text input files
if [[ -x /usr/bin/lesspipe ]]; then
	lesspipe="$(SHELL=/bin/sh lesspipe)"
	eval "${lesspipe}"
fi

# Set variable identifying the chroot you work in (used in the prompt below)
if [[ -z ${debian_chroot:-} ]] && [[ -r /etc/debian_chroot ]]; then
	debian_chroot=$(cat /etc/debian_chroot)
fi

# Set a fancy prompt (non-color, unless we know we "want" color)
if [[ ${TERM:-} == "xterm-color" || ${TERM:-} == *-256color ]] ||
	# We have color support; assume it's compliant with Ecma-48 (ISO/IEC-6429).
	# (Lack of such support is extremely rare, and such a case would tend to support setf rather than setaf.)
	{ [[ -x /usr/bin/tput ]] && tput setaf 1 >&/dev/null; }; then
	PS1='${debian_chroot:+($debian_chroot)}\[\033[01;32m\]\u@\h\[\033[00m\]:\[\033[01;34m\]\w\[\033[00m\]\$ '
else
	PS1='${debian_chroot:+($debian_chroot)}\u@\h:\w\$ '
fi

# If this is an xterm set the title to user@host:dir
if [[ ${TERM:-} == xterm* || ${TERM:-} == rxvt* ]]; then
	PS1="\[\e]0;${debian_chroot:+(${debian_chroot})}\u@\h: \w\a\]${PS1}"
fi

# Enable color support of ls and also add handy aliases
if [[ -x /usr/bin/dircolors ]]; then
	dircolors="$(dircolors -b)"
	eval "${dircolors}"
fi

# Colored GCC warnings and errors
export GCC_COLORS='error=01;31:warning=01;35:note=01;36:caret=01;32:locus=01:quote=01'

# Enable programmable completion features
if ! shopt -oq posix && [[ -f /usr/share/bash-completion/bash_completion ]]; then
	# shellcheck source=/dev/null
	source /usr/share/bash-completion/bash_completion
fi

# kubectl completion (`__start_kubectl` is required for kubecolor below)
# ref: https://kubernetes.io/docs/tasks/tools/install-kubectl-linux/#enable-shell-autocompletion
# ref: https://kubernetes.io/docs/reference/kubectl/generated/kubectl_completion/
if command -v kubectl &>/dev/null; then
	kubectl_completion="$(kubectl completion bash)"
	eval "${kubectl_completion}"
fi

# kubecolor and the mise `k` shell_alias share kubectl’s completion
# ref: https://kubecolor.github.io/setup/shells/bash/
if command -v kubectl &>/dev/null && command -v kubecolor &>/dev/null; then
	complete -o default -F __start_kubectl kubecolor
	complete -o default -F __start_kubectl k
fi

# ref: https://mikefarah.gitbook.io/yq/v/v4.x/commands/shell-completion
if command -v yq &>/dev/null; then
	yq_completion="$(yq shell-completion bash)"
	eval "${yq_completion}"
fi

# Activate zoxide
if command -v zoxide &>/dev/null; then
	zoxide_init="$(zoxide init bash --cmd z)"
	eval "${zoxide_init}"
	unset zoxide_init
fi

# Activate pitchfork
if command -v mise &>/dev/null; then
	mise_activate="$(pitchfork activate bash)"
	eval "${mise_activate}"
fi

# Enable mise completion
if command -v mise &>/dev/null; then
	# bash-completion 2.12 or later is required, but 2.11 is installed
	# ref: https://cdimages.ubuntu.com/ubuntu-wsl/noble/daily-live/current/noble-wsl-amd64.manifest
	mise_completion="$(mise completion bash --include-bash-completion-lib)"
	eval "${mise_completion}"
fi

# Enable pitchfork completion
if command -v pitchfork &>/dev/null; then
	pitchfork_completion="$(pitchfork completion bash)"
	eval "${pitchfork_completion}"
fi

# Enable gh completion
if command -v gh &>/dev/null; then
	gh_completion="$(gh completion --shell bash)"
	eval "${gh_completion}"
fi

# Install ghr shell extension and enable completion
if command -v ghr &>/dev/null; then
	# The generated shell wrapper requires an argument after `ghr cd`.
	__GHR=$(type -P ghr) || :
	__ghr_cd() {
		local ghr_bin="${__GHR:-}" path selected

		if [[ -z ${ghr_bin} ]]; then
			ghr_bin=$(type -P ghr) || return
		fi

		if (($# > 0)); then
			path=$("${ghr_bin}" path "$@") || return
			cd "${path}" || return
			return
		fi

		if ! command -v fzf &>/dev/null; then
			printf 'error: fzf is required for interactive ghr cd\n' >&2
			return 1
		fi

		# shellcheck disable=SC2312 # repo list selection is best-effort interactive input
		selected=$(
			paste <("${ghr_bin}" list) <("${ghr_bin}" list --path) |
				fzf --prompt='ghr cd> ' --height=80% --reverse --with-nth=1
		) || return
		[[ -n ${selected} ]] || return 1
		path=${selected#*$'\t'}
		[[ -n ${path} ]] || return 1
		cd "${path}" || return
	}
	ghr() {
		local arg ghr_bin="${__GHR:-}" has_cd=false
		local -a cd_args

		if [[ -z ${ghr_bin} ]]; then
			ghr_bin=$(type -P ghr) || return
		fi

		for arg in "$@"; do
			if [[ ${arg} == "-h" || ${arg} == "--help" ]]; then
				"${ghr_bin}" "$@"
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
				cd_args=()
				for arg in "${@:2}"; do
					if [[ ${arg} == "--cd" ]]; then
						has_cd=true
					else
						cd_args+=("${arg}")
					fi
				done
				if [[ ${has_cd} == true ]]; then
					"${ghr_bin}" "$@" || return
					__ghr_cd "${cd_args[@]}"
					return
				fi
				;;
			*) ;;
			esac
		fi

		"${ghr_bin}" "$@"
	}
	ghr_completion="$("${__GHR}" shell bash --completion)"
	eval "${ghr_completion}"
fi

# ref: https://hk.jdx.dev/cli/completion.html — requires `usage` on PATH (mise installs it globally)
if command -v hk &>/dev/null; then
	hk_completion="$(hk completion bash)"
	eval "${hk_completion}"
fi

# mise shell_alias completions (`m` → mise, `mx` → mise x)
if declare -f _mise >/dev/null; then
	complete -F _mise m
	_mx_complete() {
		local original_words=("${COMP_WORDS[@]}")
		local original_cword=${COMP_CWORD}

		COMP_WORDS=("mise" "x" "${original_words[@]:1}")
		COMP_CWORD=$((original_cword + 1))
		_mise
	}
	complete -F _mx_complete mx
fi

# Codex tmux launcher completion (`c` → `mise run codex-tmux`)
_c_codex_tmux_usage_candidates() {
	local spec_file="${CODEX_TMUX_USAGE_SPEC:-${HOME}/.config/mise/tasks/codex-tmux}"

	if [[ -r ${spec_file} ]] && command -v usage >/dev/null 2>&1; then
		usage complete-word --shell bash -f "${spec_file}" --cword="${cword}" -- "${words[@]}" 2>/dev/null
	fi
}

_c_codex_tmux_non_file_usage_candidates() {
	local candidate

	# shellcheck disable=SC2312 # completion candidates are best-effort
	while IFS= read -r candidate; do
		[[ -n ${candidate} ]] || continue
		if [[ ${candidate} == */ && -d ${candidate%/} ]]; then
			continue
		fi
		if [[ -e ${candidate} ]]; then
			continue
		fi
		printf '%s\n' "${candidate}"
	done < <(_c_codex_tmux_usage_candidates)
}

_c_codex_tmux_repo_candidates() {
	local current=$1

	if ! command -v ghr >/dev/null 2>&1; then
		return
	fi

	if [[ -z ${current} ]]; then
		ghr list
	else
		ghr search "${current}"
	fi
}

_c_codex_tmux_complete_lines() {
	local current=$1
	local candidate
	local -A seen=()

	COMPREPLY=()
	while IFS= read -r candidate; do
		[[ -n ${candidate} ]] || continue
		[[ -z ${seen[${candidate}]+x} ]] || continue
		seen[${candidate}]=1
		COMPREPLY+=("${candidate}")
	done

	if declare -f _comp_ltrim_colon_completions >/dev/null; then
		_comp_ltrim_colon_completions "${current}"
	fi
}

_c_codex_tmux_has_cleanup() {
	local word

	for word in "${words[@]:1:cword}"; do
		if [[ ${word} == "cleanup" ]]; then
			return 0
		fi
	done
	return 1
}

_c_codex_tmux_has_root_repo() {
	local index word

	for ((index = 1; index < cword; index++)); do
		word=${words[index]}
		case "${word}" in
		-*)
			;;
		*)
			return 0
			;;
		esac
	done
	return 1
}

_c_codex_tmux_complete() {
	local cur prev words cword

	_comp_initialize -n : -- "$@" || return

	if _c_codex_tmux_has_cleanup; then
		if [[ ${prev} == "--repo" ]]; then
			# shellcheck disable=SC2312 # completion candidates are best-effort
			_c_codex_tmux_complete_lines "${cur}" < <(_c_codex_tmux_repo_candidates "${cur}")
			return 0
		fi
		if [[ ${cur} == -* ]]; then
			# shellcheck disable=SC2312 # completion candidates are best-effort
			_c_codex_tmux_complete_lines "${cur}" < <(_c_codex_tmux_usage_candidates)
			return 0
		fi
		return 0
	fi

	if [[ ${cur} == -* ]]; then
		# shellcheck disable=SC2312 # completion candidates are best-effort
		_c_codex_tmux_complete_lines "${cur}" < <(_c_codex_tmux_usage_candidates)
		return 0
	fi

	if _c_codex_tmux_has_root_repo; then
		return 0
	fi

	# shellcheck disable=SC2312 # completion candidates are best-effort
	_c_codex_tmux_complete_lines "${cur}" < <(
		_c_codex_tmux_non_file_usage_candidates
		_c_codex_tmux_repo_candidates "${cur}"
	)
}

complete -o nospace -o bashdefault -F _c_codex_tmux_complete c

# gpg requires tty
# GitHub Actions doesn't have tty
# ref: https://github.com/actions/runner/issues/241
if [[ -n ${PS1} ]]; then
	GPG_TTY=$(tty)
	export GPG_TTY
fi

# Set GITHUB_TOKEN to avoid rate limit while using mise
# Use __CI instead of CI to be able to test CI locally
if [[ -z ${__CI:-} ]] && command -v gh &>/dev/null; then
	# Suppress error
	GITHUB_TOKEN=$(gh auth token 2>/dev/null)
	export GITHUB_TOKEN
fi

# xdg-open
# use powershell instead of pwsh as pwsh is not in the PATH sometimes
if command -v powershell.exe &>/dev/null; then
	export BROWSER="powershell.exe -c Start-Process"
fi

# antigravity
if command -v antigravity &>/dev/null; then
	ag() {
		local target="${1:-.}"
		local abs_path
		abs_path=$(realpath "${target}")
		antigravity --remote "wsl+${WSL_DISTRO_NAME:-}" "${abs_path}"
	}
fi

# Disable apt/snap command_not_found_handle
# original command_not_found_handle is renamed to _command_not_found_handle by mise activate
if declare -f _command_not_found_handle >/dev/null; then
	unset -f _command_not_found_handle
fi
