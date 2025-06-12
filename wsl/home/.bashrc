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
# cspell:ignore ignoreboth
export HISTCONTROL=ignoreboth

# Append to the history file, don't overwrite it
# cspell:ignore histappend
shopt -s histappend

# For setting history length
export HISTSIZE=1000
export HISTFILESIZE=2000

# cspell:ignore checkwinsize
shopt -s checkwinsize
shopt -s globstar

# Make less more friendly for non-text input files
# cspell:ignore lesspipe
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
	# cspell:ignore setf setaf
	# We have color support; assume it's compliant with Ecma-48 (ISO/IEC-6429).
	# (Lack of such support is extremely rare, and such a case would tend to support setf rather than setaf.)
	{ [[ -x /usr/bin/tput ]] && tput setaf 1 >&/dev/null; }; then
	PS1='${debian_chroot:+($debian_chroot)}\[\033[01;32m\]\u@\h\[\033[00m\]:\[\033[01;34m\]\w\[\033[00m\]\$ '
else
	PS1='${debian_chroot:+($debian_chroot)}\u@\h:\w\$ '
fi

# If this is an xterm set the title to user@host:dir
# cspell:ignore rxvt
if [[ ${TERM:-} == xterm* || ${TERM:-} == rxvt* ]]; then
	PS1="\[\e]0;${debian_chroot:+(${debian_chroot})}\u@\h: \w\a\]${PS1}"
fi

# Enable color support of ls and also add handy aliases
# cspell:ignore dircolors
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

# Enable mise completion
if command -v mise &>/dev/null; then
	# bash-completion 2.12 or later is required, but 2.11 is installed
	# ref: https://cdimages.ubuntu.com/ubuntu-wsl/noble/daily-live/current/noble-wsl-amd64.manifest
	mise_completion="$(mise completion bash --include-bash-completion-lib)"
	eval "${mise_completion}"
fi

# Enable gh completion
if command -v gh &>/dev/null; then
	gh_completion="$(gh completion --shell bash)"
	eval "${gh_completion}"
fi

# Install ghr shell extension and enable completion
if command -v ghr &>/dev/null; then
	ghr_extension="$(ghr shell bash)"
	eval "${ghr_extension}"
	ghr_completion="$(ghr shell bash --completion)"
	eval "${ghr_completion}"
fi

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

# Aliases
alias beep="printf '\a'"
if command -v eza &>/dev/null; then
	alias l="eza --all --long --git"
fi

# Call windows executables without extensions if it exists
# e.g. `clip` instead of `clip.exe`
if [[ -z ${_win_cmd_not_found:-} ]]; then
	_win_cmd_not_found=1
	if [[ -n "$(declare -f command_not_found_handle)" ]]; then
		_win_cmd_not_found_handle=$(declare -f command_not_found_handle)
		# _command_not_found_handle is used by mise
		eval "${_win_cmd_not_found_handle/command_not_found_handle/__command_not_found_handle}"
	fi

	command_not_found_handle() {
		# shellcheck disable=SC2317 # command_not_found_handle is called by bash
		# cspell:ignore pathext wslenv
		local pathext
		# ref: https://learn.microsoft.com/en-us/windows/wsl/filesystems#share-environment-variables-between-windows-and-wsl-with-wslenv
		pathext=$(echo "${PATHEXT:-}" | tr ';' ' ')
		local ext
		for ext in ${pathext}; do
			if command -v "$1${ext}" >/dev/null 2>&1; then
				"$1${ext}" "${@:2}"
				return $?
			fi
		done

		if declare -f __command_not_found_handle >/dev/null; then
			__command_not_found_handle "$@"
		else
			printf 'bash: command not found: %s\n' "$1" >&2
			return 127
		fi
	}
fi

# Disable apt/snap command_not_found_handle
# original command_not_found_handle is renamed to _command_not_found_handle by mise activate
if declare -f _command_not_found_handle >/dev/null; then
	unset -f _command_not_found_handle
fi
