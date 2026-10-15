#!/usr/bin/env bash
set -euo pipefail

# Publish missing native agent records only when no machine-owned lock exists.
config_dir=${1:?mise config directory is required}
shared_lock="${config_dir}/mise.lock"
local_lock="${config_dir}/mise.local.lock"

check_existing() {
	if [[ -L ${local_lock} ]]; then
		echo "Refusing to seed a symlinked local mise lock: ${local_lock}" >&2
		exit 1
	fi
	if [[ -e ${local_lock} ]]; then
		local_version=$(mise config get --file "${local_lock}" lockfile_version 2>/dev/null) || local_version=''
		if [[ ${local_version} == "3" ]] &&
			mise config get --file "${local_lock}" tools.codex >/dev/null 2>&1 &&
			mise config get --file "${local_lock}" tools.claude >/dev/null 2>&1; then
			exit 0
		fi
		echo 'The existing machine-owned lock needs agent records; no file was changed.' >&2
		# The command is printed literally for the user's shell.
		# shellcheck disable=SC2016
		echo 'Run: mise --cd "$HOME" lock --global --local codex claude' >&2
		echo 'Then rerun bootstrap. Native mise locking preserves other local tools.' >&2
		exit 1
	fi
}
check_existing
shared_version=$(mise config get --file "${shared_lock}" lockfile_version)
if [[ ${shared_version} != "3" ]]; then
	echo 'Agent lock seeding requires a generated version 3 shared lock.' >&2
	exit 1
fi

candidate=$(mktemp "${config_dir}/.agent-lock.XXXXXX")
record=$(mktemp "${config_dir}/.agent-lock-record.XXXXXX")
trap 'rm -f "${candidate}" "${record}"' EXIT HUP INT TERM
printf '# @generated - native agent records copied from mise.lock\nlockfile_version = 3\n' >"${candidate}"
for tool in codex claude; do
	awk -v header="[[tools.${tool}]]" '
		/^\[\[tools\./ { selected = $0 == header }
		selected { print; found = 1 }
		END { if (!found) exit 1 }
	' "${shared_lock}" >"${record}"
	# Native records are self-contained; npm/PyPI graphs need separate migration.
	if ! grep -Eq '^backend = "(aqua|core|github|packslip):' "${record}"; then
		echo "Refusing to seed a non-native agent lock: ${tool}" >&2
		exit 1
	fi
	printf '\n' >>"${candidate}"
	cat "${record}" >>"${candidate}"
done
mise config get --file "${candidate}" >/dev/null
# A same-directory hard link publishes atomically without replacing an existing
# file. Native mise writers do not share a portable public mutex with this hook.
if ! ln "${candidate}" "${local_lock}"; then
	check_existing
	echo 'Unable to create the initial local agent lock; rerun bootstrap.' >&2
	exit 1
fi
