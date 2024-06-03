# Homebrew
brew_env="$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"
eval "${brew_env}"

# mise-en-place
mise_activate="$(mise activate bash)"
eval "${mise_activate}"
alias mr="mise run"

# VS Code
alias code="code-insiders"

# gpg
GPG_TTY=$(tty)
export GPG_TTY
