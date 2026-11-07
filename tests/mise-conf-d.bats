#!/usr/bin/env bats
# shellcheck shell=bash
# Bats supplies test paths/output; the installer invokes the mise stub indirectly.
# shellcheck disable=SC2154,SC2310,SC2329

setup() {
	bats_require_minimum_version 1.7.0
	root=$(cd "${BATS_TEST_DIRNAME}/.." && pwd)
	cd "${root}" || return
	export HOME="${BATS_TEST_TMPDIR}/home"
	export XDG_CONFIG_HOME="${HOME}/.config" XDG_DATA_HOME="${HOME}/.local/share"
	export XDG_CACHE_HOME="${HOME}/.cache" XDG_STATE_HOME="${HOME}/.local/state"
	export MISE_CONFIG_DIR="${XDG_CONFIG_HOME}/mise"
	export MISE_DATA_DIR="${XDG_DATA_HOME}/mise" MISE_CACHE_DIR="${XDG_CACHE_HOME}/mise"
	export MISE_STATE_DIR="${XDG_STATE_HOME}/mise" MISE_SYSTEM_CONFIG_DIR="${HOME}/system"
	export MISE_GLOBAL_CONFIG_FILE="${MISE_CONFIG_DIR}/config.toml"
	export MISE_TRUSTED_CONFIG_PATHS="${root}" MISE_AUTO_ENV=true MISE_ENV=''
	export CI=true MISE_OFFLINE=true
	mkdir -p "${HOME}"
}

@test "bootstrap fragments load without moving repository tool ownership" {
	run -0 mise config ls --json
	[[ ${output} == *'/.config/mise/conf.d/bootstrap-hooks.toml'* ]]
	[[ ${output} == *'/.config/mise/conf.d/bootstrap.toml'* ]]
	run -0 mise ls bun --json
	[[ ${output} == *'"path": "'"${root}"'/mise.toml"'* ]]
}

@test "root task includes still discover repository and Worker tasks" {
	run -0 mise tasks ls --name-only
	[[ ${output} == *'test:bats'* ]]
	[[ ${output} == *'worker:test'* ]]
}

@test "bare and personal dotfiles retain existing source paths" {
	local selected_profile
	for selected_profile in '' personal; do
		run -0 env MISE_ENV="${selected_profile}" mise bootstrap dotfiles status --json
		[[ ${output} != *'source_missing'* ]]
		[[ ${output} == *'/unix/home/.codex/AGENTS.md'* ]]
		if [[ -z ${selected_profile} ]]; then
			[[ ${output} != *'personal.gitconfig'* ]]
		else
			[[ ${output} == *'personal.gitconfig'* ]]
		fi
	done
}

@test "personal repositories extend the common bootstrap fragment" {
	run -0 mise bootstrap repos status --json
	[[ ${output} == *'https://github.com/risu729/dotfiles.git'* ]]
	[[ ${output} != *'https://github.com/risu729/mise.git'* ]]
	run -0 env MISE_ENV=personal mise bootstrap repos status --json
	[[ ${output} == *'https://github.com/risu729/dotfiles.git'* ]]
	[[ ${output} == *'https://github.com/risu729/mise.git'* ]]
}

@test "bootstrap dry-run registers moved tool and final hooks without applying them" {
	# Keep this empty-cache hook probe independent of CI's outer tool filter.
	# Python graph preparation requires an installed interpreter even in dry-runs.
	run -0 env MISE_ENABLE_TOOLS=aube,bats,bun,node mise bootstrap --dry-run --only tools,final-hook --yes
	[[ ${output} == *'post-tools'* ]]
	[[ ${output} == *'final'* ]]
	[[ ! -e ${HOME}/.agents ]]
}

@test "installer trusts only repository configs including fragments" {
	# shellcheck source=unix/install.sh
	source "${root}/unix/install.sh"
	local fixture="${BATS_TEST_TMPDIR}/parent/repository"
	mkdir -p "${fixture}/.config/mise/conf.d"
	touch "${fixture}/../mise.toml" "${fixture}/mise.toml" "${fixture}/mise.personal.toml" \
		"${fixture}/.config/mise/conf.d/bootstrap.toml"
	mise() { printf '%s\n' "$*"; }
	run -0 trust_configs "${fixture}"
	[[ ${output} == "$(printf 'trust --yes %s\n' \
		"${fixture}/mise.toml" "${fixture}/mise.personal.toml" \
		"${fixture}/.config/mise/conf.d/bootstrap.toml")" ]]
}

@test "installer supports older revisions without fragments and propagates trust failures" {
	# shellcheck source=unix/install.sh
	source "${root}/unix/install.sh"
	local fixture="${BATS_TEST_TMPDIR}/repository"
	mkdir -p "${fixture}"
	touch "${fixture}/mise.toml"
	mise() { printf '%s\n' "$*"; }
	run -0 trust_configs "${fixture}"
	[[ ${output} == "trust --yes ${fixture}/mise.toml" ]]
	mise() { return 23; }
	run -23 trust_configs "${fixture}"
}

@test "managed system files retain Linux and personal boundaries and root source paths" {
	local selected_profile detected_os
	detected_os=$(uname -s)
	for selected_profile in '' personal; do
		run -0 env MISE_ENV="${selected_profile}" mise bootstrap files status --json
		if [[ ${detected_os} != Linux ]]; then
			[[ ${output} != *'/etc/sudoers.d/01-users-nopasswd'* ]]
			[[ ${output} != *'/etc/ssh/ca.pub'* ]]
			continue
		fi
		[[ ${output} == *'/etc/sudoers.d/01-users-nopasswd'* ]]
		[[ ${output} == *'0440'* ]]
		[[ ${output} == *'pre-packages'* ]]
		if [[ -z ${selected_profile} ]]; then
			[[ ${output} != *'/etc/ssh/ca.pub'* ]]
			[[ ${output} != *'wsl-cloudflare-ip.service'* ]]
		else
			[[ ${output} == *'/etc/ssh/ca.pub'* ]]
			[[ ${output} == *'/unix/ssh/ca.pub'* ]]
			[[ ${output} == *'wsl-cloudflare-ip.service'* ]]
			[[ ${output} == *'"name": "/etc/systemd/system"'* ]]
			[[ ${output} != *'/.config/mise/conf.d/unix/'* ]]
		fi
	done
}

@test "pre-packages managed unit creates its parent on a fresh filesystem" {
	local detected_os
	detected_os=$(uname -s)
	[[ ${detected_os} == Linux ]] || skip "Linux-only managed unit"
	local fixture="${BATS_TEST_TMPDIR}/managed-unit"
	mkdir -p "${fixture}"
	# Retain the real declarations, but map targets into this fixture and omit
	# root principals so the native apply never needs privileged access.
	# shellcheck disable=SC2016
	run -0 bun -e '
		const [root, fixture] = process.argv.slice(1);
		const config = Bun.TOML.parse(await Bun.file(root + "/mise.personal.toml").text());
		const parent = "/etc/systemd/system";
		const target = parent + "/wsl-cloudflare-ip.service";
		let text = "";
		for (const [kind, path] of [["directories", parent], ["files", target]]) {
			const entry = config.bootstrap[kind][path];
			if (!entry) throw new Error("Missing managed " + kind + ": " + path);
			text += "[bootstrap." + kind + "." + JSON.stringify(fixture + path) + "]\n";
			for (const [key, original] of Object.entries(entry)) {
				if (["owner", "group"].includes(key)) continue;
				const value = key === "source" ? root + "/" + original : original;
				text += key + " = " + JSON.stringify(value) + "\n";
			}
		}
		await Bun.write(fixture + "/mise.toml", text);
	' "${root}" "${fixture}"
	for _ in 1 2; do
		run -0 env MISE_SYSTEM_PACKAGES_SUDO=false MISE_TRUSTED_CONFIG_PATHS="${fixture}" \
			mise --cd "${fixture}" bootstrap files apply --yes
	done
	cmp "${root}/unix/systemd/wsl-cloudflare-ip.service" \
		"${fixture}/etc/systemd/system/wsl-cloudflare-ip.service"
	run -0 stat -c %a "${fixture}/etc/systemd/system"
	[[ ${output} == 755 ]]
	run -0 stat -c %a "${fixture}/etc/systemd/system/wsl-cloudflare-ip.service"
	[[ ${output} == 644 ]]
}
