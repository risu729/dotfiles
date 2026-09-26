#!/usr/bin/env bats
# shellcheck shell=bash
# Bats provides captured variables; child-shell and Bun expressions stay literal.
# shellcheck disable=SC2154,SC2016

setup() {
	bats_require_minimum_version 1.7.0
	root=$(cd "${BATS_TEST_DIRNAME}/.." && pwd)
	lazy_mise=${LAZY_TEST_MISE:-$(command -v mise)}
	lazy_hk=$(command -v hk)
	lazy_bun=$(command -v bun)
	fixture="${BATS_TEST_TMPDIR}/isolated"
	mkdir -p "${fixture}/home" "${fixture}/config" "${fixture}/project" "${fixture}/bin"
	ln -s "${lazy_mise}" "${fixture}/bin/mise"
	cat >"${fixture}/config/config.toml" <<'TOML'
[settings]
experimental = true
[tools]
usage = { version = "0.0.0", lazy = true }
TOML
	# Exercise the repository's actual setting, without loading its tools/hooks.
	{
		printf '[settings]\n'
		sed -n '/^exec_auto_install = /p' "${root}/mise.toml"
	} >"${fixture}/project/mise.toml"
	cd "${fixture}/project" || return
}

isolated() {
	env -i HOME="${fixture}/home" PATH="${fixture}/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
		MISE_CONFIG_DIR="${fixture}/config" \
		MISE_DATA_DIR="${fixture}/data" MISE_CACHE_DIR="${fixture}/cache" \
		MISE_STATE_DIR="${fixture}/state" MISE_SYSTEM_CONFIG_DIR="${fixture}/system" \
		MISE_SYSTEM_DATA_DIR="${fixture}/system-data" MISE_TRUSTED_CONFIG_PATHS="${fixture}" \
		MISE_OFFLINE=true MISE_AUTO_ENV=0 MISE_ENV= CI=true HK_PKL_OFFLINE=1 "$@"
}

# A local backend proves first-use installation and exit propagation without
# downloads, installed host tools, or a successful external release lookup.
local_provider() {
	mkdir -p "${fixture}/data/plugins/asdf-lazy-fixture/bin"
	cat >"${fixture}/data/plugins/asdf-lazy-fixture/bin/install" <<'SH'
#!/bin/sh
mkdir -p "$ASDF_INSTALL_PATH/bin"
printf '#!/bin/sh\necho lazy-ran\nexit "${1:-0}"\n' >"$ASDF_INSTALL_PATH/bin/lazy-fixture"
chmod +x "$ASDF_INSTALL_PATH/bin/lazy-fixture"
SH
	chmod +x "${fixture}/data/plugins/asdf-lazy-fixture/bin/install"
	printf '\n"asdf:lazy-fixture" = { version = "1.0.0", lazy = true, lazy_bins = ["lazy-fixture"] }\n' >>"${fixture}/config/config.toml"
}

@test "lazy global tools do not block unrelated exec even with auto install enabled" {
	run -0 isolated MISE_EXEC_AUTO_INSTALL=true mise exec --no-deps -- sh -c 'echo hook-ran'
	[[ ${output} == *hook-ran* ]]
	[[ ! -d ${fixture}/data/installs/usage/0.0.0 ]]
}

@test "lazy alone does not protect exec from an unavailable non-lazy global tool" {
	printf '\njq = "0.0.0"\n' >>"${fixture}/config/config.toml"
	run ! isolated MISE_EXEC_AUTO_INSTALL=true mise exec --no-deps -- sh -c 'echo hook-ran'
	[[ ${output} != *hook-ran* ]]
	run -0 isolated mise exec --no-deps -- sh -c 'echo hook-ran'
	[[ ${output} == *hook-ran* ]]
}

@test "exec keeps check failure status with missing lazy and non-lazy globals" {
	printf '\njq = "0.0.0"\n' >>"${fixture}/config/config.toml"
	run -23 isolated mise exec --no-deps -- sh -c 'echo check-failed; exit 23'
	[[ ${output} == *check-failed* ]]
}

@test "direct lazy invocation still attempts its provider with exec auto install disabled" {
	run ! isolated mise exec --no-deps -- usage --version
	[[ ${output} == *usage* ]]
	[[ ${output} == *offline* || ${output} == *OFFLINE* ]]
}

@test "nested lazy invocation fails offline instead of silently succeeding" {
	run ! isolated mise exec --no-deps -- sh -c 'usage --version'
	[[ ${output} == *usage* ]]
	[[ ${output} == *offline* || ${output} == *OFFLINE* ]]
}

@test "project non-lazy selection overrides a lazy global declaration" {
	printf '\n[tools]\nusage = "0.0.1"\n' >>"${fixture}/project/mise.toml"
	run -0 isolated mise current usage
	[[ ${output} == '0.0.1' ]]
	run ! isolated MISE_EXEC_AUTO_INSTALL=true mise exec --no-deps -- sh -c 'echo hook-ran'
	[[ ${output} != *hook-ran* ]]
	run -0 isolated mise exec --no-deps -- sh -c 'echo hook-ran'
	[[ ${output} == *hook-ran* ]]
}

@test "a stale lazy shim cannot bypass a project's missing non-lazy selection" {
	local_provider
	run -0 isolated mise reshim
	printf '\n[tools]\n"asdf:lazy-fixture" = "2.0.0"\n' >>"${fixture}/project/mise.toml"
	run ! isolated mise exec --no-deps -- sh -c 'lazy-fixture'
	[[ ${output} != *lazy-ran* ]]
	[[ ! -d ${fixture}/data/installs/asdf-lazy-fixture/1.0.0 ]]
}

@test "missing required hook tools fail rather than skipping checks" {
	printf '\n[tools]\nhk = "0.0.0"\nbun = "0.0.0"\npowershell = "0.0.0"\n' >>"${fixture}/project/mise.toml"
	for cmd in hk bun pwsh; do
		run ! isolated mise exec --no-deps -- "${cmd}" --version
		run ! isolated mise exec --no-deps -- sh -c '"$1" --version' sh "${cmd}"
	done
}

@test "bare install skips lazy tools and builds their bootstrap shims" {
	local_provider
	run -0 isolated mise install
	[[ ! -d ${fixture}/data/installs/asdf-lazy-fixture/1.0.0 ]]
	[[ -x ${fixture}/data/shims/lazy-fixture ]]
}

@test "direct lazy command installs only its local provider and preserves exit status" {
	local_provider
	printf '\njq = "0.0.0"\n' >>"${fixture}/config/config.toml"
	run -23 isolated mise exec --no-deps -- lazy-fixture 23
	[[ ${output} == *lazy-ran* ]]
	[[ -x ${fixture}/data/installs/asdf-lazy-fixture/1.0.0/bin/lazy-fixture ]]
	[[ ! -d ${fixture}/data/installs/usage/0.0.0 ]]
}

@test "nested lazy command installs on first use and preserves exit status" {
	local_provider
	run -23 isolated mise exec --no-deps -- sh -c 'lazy-fixture 23'
	[[ ${output} == *lazy-ran* ]]
	[[ -x ${fixture}/data/installs/asdf-lazy-fixture/1.0.0/bin/lazy-fixture ]]
}

@test "include-lazy and explicit selection provision lazy tools before use" {
	local_provider
	# Keep only the offline-installable provider for a full successful install.
	sed '/^usage = /d' "${fixture}/config/config.toml" >"${fixture}/config/only-local.toml"
	for mode in --include-lazy asdf:lazy-fixture; do
		rm -rf "${fixture}/data/installs/asdf-lazy-fixture"
		run -0 isolated MISE_GLOBAL_CONFIG_FILE="${fixture}/config/only-local.toml" mise install "${mode}"
		[[ -x ${fixture}/data/installs/asdf-lazy-fixture/1.0.0/bin/lazy-fixture ]]
	done
}

@test "real Git hooks run offline with lazy and non-lazy missing globals and reject failed checks" {
	ln -s "${lazy_hk}" "${fixture}/bin/hk"
	isolated git init --quiet
	isolated git config user.email fixture@example.invalid
	isolated git config user.name Fixture
	isolated git config commit.gpgsign false
	# hk embeds its matching Pkl package, so this needs no cache or network.
	isolated hk init
	cat >>hk.pkl <<'PKL'
steps {
  ["fixture"] {
    glob = "*.txt"
    check = "sh check.sh"
  }
}
PKL
	printf '#!/bin/sh\necho hook-ran\nexit 0\n' >check.sh
	printf 'fixture\n' >fixture.txt
	isolated git add fixture.txt hk.pkl mise.toml check.sh
	isolated hk install --mise
	# Lazy alone succeeds with the default auto-install policy.
	run -0 isolated MISE_EXEC_AUTO_INSTALL=true git commit -m lazy-only
	[[ ${output} == *hook-ran* ]]
	printf '\njq = "0.0.0"\n' >>"${fixture}/config/config.toml"
	printf 'second\n' >>fixture.txt
	isolated git add fixture.txt
	# Negative control: non-lazy global installation blocks before hk runs.
	run ! isolated MISE_EXEC_AUTO_INSTALL=true git commit -m blocked
	[[ ${output} != *hook-ran* ]]
	# The repository setting preserves the commit guarantee.
	run -0 isolated git commit -m protected
	[[ ${output} == *hook-ran* ]]
	printf '#!/bin/sh\necho check-failed\nexit 23\n' >check.sh
	printf 'third\n' >>fixture.txt
	isolated git add fixture.txt check.sh
	run ! isolated git commit -m rejected
	[[ ${output} == *check-failed* ]]
	run -0 isolated git log -1 --format=%s
	[[ ${output} == protected ]]
}

@test "ordinary doctor reports missing lazy tools but verification permits only those errors" {
	ln -s "${lazy_bun}" "${fixture}/bin/bun"
	run -0 isolated mise reshim
	run -1 isolated mise doctor --json
	[[ ${output} == *'is not installed, install with'* ]]
	run -0 isolated bash "${root}/tasks/verify/mise-doctor"
	# A project override must remain a failure despite global lazy=true.
	printf '\n[tools]\nusage = "0.0.1"\n' >>mise.toml
	run ! isolated bash "${root}/tasks/verify/mise-doctor"
	[[ ${output} == *'is not installed'* ]]
}

@test "global and personal lazy declarations keep locked versions and provision explicit backend shims" {
	cp "${root}/unix/home/.config/mise/"config*.toml "${fixture}/config/"
	cp "${root}/unix/home/.config/mise/"mise*.lock "${fixture}/config/"
	for profile in '' personal; do
		run -0 --separate-stderr isolated MISE_ENV="${profile}" MISE_AUTO_ENV=1 mise ls --current --json
		printf '%s' "${output}" | bun -e '
			const tools = await Bun.stdin.json();
			const dir = process.argv[1];
			const profile = process.argv[2];
			const lock = Bun.TOML.parse(await Bun.file(`${dir}/mise.lock`).text()).tools;
			if (profile) Object.assign(lock, Bun.TOML.parse(await Bun.file(`${dir}/mise.personal.lock`).text()).tools);
			for (const [name, versions] of Object.entries(tools)) {
				for (const version of versions) {
					if (!lock[name]?.some(entry => entry.version === version.version)) throw new Error(`Unlocked ${name}`);
				}
			}
			if (Boolean(tools.glab) !== Boolean(profile)) throw new Error("Personal tool leaked or missing");
		' "${fixture}/config" "${profile}"
		run -0 isolated MISE_ENV="${profile}" MISE_AUTO_ENV=1 mise reshim
		for cmd in yarn yarnpkg markitdown ccusage; do
			[[ -x ${fixture}/data/shims/${cmd} ]]
		done
		if [[ ${profile} == personal ]]; then
			for cmd in kuebiko biwa mikoto resend glab cursor-agent; do
				[[ -x ${fixture}/data/shims/${cmd} ]]
			done
		else
			[[ ! -e ${fixture}/data/shims/glab ]]
		fi
	done
	cmp "${root}/unix/home/.config/mise/mise.lock" "${fixture}/config/mise.lock"
	cmp "${root}/unix/home/.config/mise/mise.personal.lock" "${fixture}/config/mise.personal.lock"
}
