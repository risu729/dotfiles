# shellcheck shell=bash
# Remove only the unchanged system config installed before user-level merging.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

system_config=/etc/codex/config.toml
if [[ ! -f ${system_config} || -L ${system_config} ]]; then
	exit 0
fi

# SHA-256 of the formerly deployed unix/codex/config.toml (including comments).
managed_hash=fe5ecf7b3030b27994dfb6e410c81afb85a640285e54c311c98d8b5cdaf89a14
actual_hash=$(sha256sum "${system_config}")
if [[ ${actual_hash%% *} != "${managed_hash}" ]]; then
	echo "Keeping modified ${system_config}; review and remove it manually if no longer needed." >&2
	exit 0
fi

# Do not remove the old layer unless both user-level fragments are applied.
mise dotfiles status --missing "${HOME}/.codex/config.toml/shared" "${HOME}/.codex/config.toml/mcp"
sudo rm -- "${system_config}"
sudo rmdir --ignore-fail-on-non-empty -- "$(dirname "${system_config}")"
