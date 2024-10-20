# ~/.bashrc: executed by bash(1) for non-login shells.
# see /usr/share/doc/bash/examples/startup-files (in the package bash-doc) for examples

# shellcheck disable=SC2148 # shebang is not required in .bashrc

# activate mise shims
# required for IDEs to call tools managed by mise
# this should come before mise activate bash
mise_shims="$(mise activate bash --shims)"
eval "${mise_shims}"

# if not running interactively, skip other steps
case $- in
*i*) ;;
*) return ;;
esac

# don't put duplicate lines or lines starting with space in the history.
# See bash(1) for more options
# cspell:ignore ignoreboth
HISTCONTROL=ignoreboth

# append to the history file, don't overwrite it
# cspell:ignore histappend
shopt -s histappend

# for setting history length see HISTSIZE and HISTFILESIZE in bash(1)
HISTSIZE=1000
HISTFILESIZE=2000

# check the window size after each command and, if necessary, update the values of LINES and COLUMNS.
# cspell:ignore checkwinsize
shopt -s checkwinsize

# if set, the pattern "**" used in a pathname expansion context will match all files and zero or more directories and subdirectories.
shopt -s globstar

# make less more friendly for non-text input files, see lesspipe(1)
# cspell:ignore lesspipe
if [[ -x /usr/bin/lesspipe ]]; then
	lesspipe="$(SHELL=/bin/sh lesspipe)"
	eval "${lesspipe}"
fi

# set variable identifying the chroot you work in (used in the prompt below)
if [[ -z ${debian_chroot:-} ]] && [[ -r /etc/debian_chroot ]]; then
	debian_chroot=$(cat /etc/debian_chroot)
fi

# set a fancy prompt (non-color, unless we know we "want" color)
case "${TERM}" in
xterm-color | *-256color) color_prompt=yes ;;
*) ;;
esac

if [[ -n ${force_color_prompt} ]]; then
	# cspell:ignore setaf setf
	if [[ -x /usr/bin/tput ]] && tput setaf 1 >&/dev/null; then
		# We have color support; assume it's compliant with Ecma-48 (ISO/IEC-6429).
		# (Lack of such support is extremely rare, and such a case would tend to support setf rather than setaf.)
		color_prompt=yes
	else
		color_prompt=
	fi
fi

if [[ ${color_prompt} == yes ]]; then
	PS1='${debian_chroot:+($debian_chroot)}\[\033[01;32m\]\u@\h\[\033[00m\]:\[\033[01;34m\]\w\[\033[00m\]\$ '
else
	PS1='${debian_chroot:+($debian_chroot)}\u@\h:\w\$ '
fi
unset color_prompt force_color_prompt

# If this is an xterm set the title to user@host:dir
case "${TERM}" in
# cspell:ignore rxvt
xterm* | rxvt*)
	PS1="\[\e]0;${debian_chroot:+(${debian_chroot})}\u@\h: \w\a\]${PS1}"
	;;
*) ;;
esac

# enable color support of ls and also add handy aliases
# cspell:ignore dircolors
if [[ -x /usr/bin/dircolors ]]; then
	dircolors="$(dircolors -b)"
	eval "${dircolors}"

	# cspell:ignore vdir fgrep
	alias ls='ls --color=auto'
	alias dir='dir --color=auto'
	alias vdir='vdir --color=auto'

	alias grep='grep --color=auto'
	alias fgrep='fgrep --color=auto'
	alias egrep='egrep --color=auto'
fi

# colored GCC warnings and errors
export GCC_COLORS='error=01;31:warning=01;35:note=01;36:caret=01;32:locus=01:quote=01'

# enable programmable completion features
# (you don't need to enable this, if it's already enabled in /etc/bash.bashrc and /etc/profile sources /etc/bash.bashrc).
if ! shopt -oq posix && [[ -f /usr/share/bash-completion/bash_completion ]]; then
	# shellcheck disable=SC1091 # vs code extension doesn't support source
	. /usr/share/bash-completion/bash_completion
fi

# activate mise
mise_activate="$(mise activate bash)"
eval "${mise_activate}"
alias mr="mise run"

# vs code
alias code="code-insiders"

# gpg
GPG_TTY=$(tty)
export GPG_TTY
