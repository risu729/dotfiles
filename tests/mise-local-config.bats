#!/usr/bin/env bats
# shellcheck shell=bash
# shellcheck disable=SC2154

setup() {
	bats_require_minimum_version 1.7.0
	root=$(cd "${BATS_TEST_DIRNAME}/.." && pwd)
	fixture="${BATS_TEST_TMPDIR}/discovery"
	local_mise=${LOCAL_CONFIG_TEST_MISE:-$(command -v mise)}
	mkdir -p "${fixture}/config" "${fixture}/project"
	printf '[settings]\nexperimental = true\n' >"${fixture}/config/config.toml"
	# Use the production declarations and templates, changing only the destination.
	bun - "${root}" "${fixture}" <<'JS'
import { resolve } from "node:path";
const [root, fixture] = process.argv.slice(2);
const config = Bun.TOML.parse(await Bun.file(`${root}/mise.toml`).text());
let output = "[settings]\nexperimental = true\n";
for (const key of ["~/.config/mise/miserc.toml", "~/.config/mise/miserc.local.toml/profile"]) {
  const entry = config.dotfiles[key];
  if (!entry) throw new Error(`Missing declaration: ${key}`);
  output += `\n[dotfiles.${JSON.stringify(key.replace("~/.config/mise", `${fixture}/config`))}]\n`;
  for (const [name, value] of Object.entries(entry)) {
    output += `${name} = ${JSON.stringify(name === "source" ? resolve(root, value) : value)}\n`;
  }
}
await Bun.write(`${fixture}/project/mise.toml`, output);
JS
}

isolated() {
	env MISE_CONFIG_DIR="${fixture}/config" MISE_SYSTEM_CONFIG_DIR="${fixture}/system" \
		MISE_DATA_DIR="${fixture}/data" MISE_STATE_DIR="${fixture}/state" \
		MISE_CACHE_DIR="${fixture}/cache" MISE_CEILING_PATHS="${fixture}" \
		MISE_TRUSTED_CONFIG_PATHS="${fixture}" MISE_OFFLINE="${LOCAL_CONFIG_OFFLINE:-true}" CI=true \
		"${local_mise}" --cd "${fixture}/project" "$@"
}

@test "machine profile discovery preserves unrelated local settings across profile changes" {
	cat >"${fixture}/config/miserc.local.toml" <<'TOML'
# Keep this machine's discovery boundary.
ceiling_paths = ["/machine-boundary"]
env = ["old"]
TOML
	MISE_ENV=personal isolated dot apply --yes --force
	grep -F 'env = ["personal"]' "${fixture}/config/miserc.local.toml"
	grep -F 'ceiling_paths = ["/machine-boundary"]' "${fixture}/config/miserc.local.toml"
	grep -F '# Keep this machine' "${fixture}/config/miserc.local.toml"
	run ! grep -q '^env =' "${fixture}/config/miserc.toml"

	MISE_ENV='' isolated dot apply --yes --force
	grep -F 'env = []' "${fixture}/config/miserc.local.toml"
	grep -F 'ceiling_paths = ["/machine-boundary"]' "${fixture}/config/miserc.local.toml"
	grep -F 'auto_env = true' "${fixture}/config/miserc.toml"
}

@test "new global tools and dotfiles are routed to machine-owned fragments" {
	bun - "${root}" "${fixture}" <<'JS'
const [root, fixture] = process.argv.slice(2);
const config = Bun.TOML.parse(await Bun.file(`${root}/unix/home/.config/mise/config.toml`).text());
let output = "[settings]\nexperimental = true\n[settings.write_targets]\n";
for (const [name, path] of Object.entries(config.settings.write_targets)) {
  output += `${name} = ${JSON.stringify(path.replace("~/.config/mise", `${fixture}/config`))}\n`;
}
await Bun.write(`${fixture}/config/config.toml`, output);
JS
	cp "${fixture}/config/config.toml" "${fixture}/before.toml"
	mkdir -p "${fixture}/data/plugins/asdf-routing-fixture/bin"
	cat >"${fixture}/data/plugins/asdf-routing-fixture/bin/install" <<'SH'
#!/bin/sh
mkdir -p "$ASDF_INSTALL_PATH/bin"
printf '#!/bin/sh\necho fixture\n' >"$ASDF_INSTALL_PATH/bin/routing-fixture"
chmod +x "$ASDF_INSTALL_PATH/bin/routing-fixture"
SH
	chmod +x "${fixture}/data/plugins/asdf-routing-fixture/bin/install"
	MISE_ENV='' isolated use --global asdf:routing-fixture@1.0.0
	grep -F '1.0.0' "${fixture}/config/conf.d/90-tools.local.toml"
	cmp "${fixture}/before.toml" "${fixture}/config/config.toml"

	printf 'machine setting\n' >"${fixture}/machine.conf"
	MISE_ENV='' isolated dot add --yes --no-apply --source "${fixture}/source.conf" "${fixture}/machine.conf"
	grep -F 'machine.conf' "${fixture}/config/conf.d/92-dotfiles.local.toml"
	cmp "${fixture}/before.toml" "${fixture}/config/config.toml"
}

@test "upgrading a local agent leaves the shared global lock unchanged" {
	mkdir -p "${fixture}/data/plugins/asdf-updates-fixture/bin"
	cat >"${fixture}/data/plugins/asdf-updates-fixture/bin/list-all" <<'SH'
#!/bin/sh
cat "$(dirname "$0")/versions"
SH
	cat >"${fixture}/data/plugins/asdf-updates-fixture/bin/install" <<'SH'
#!/bin/sh
mkdir -p "$ASDF_INSTALL_PATH/bin"
printf '#!/bin/sh\necho fixture\n' >"$ASDF_INSTALL_PATH/bin/updates-fixture"
chmod +x "$ASDF_INSTALL_PATH/bin/updates-fixture"
SH
	chmod +x "${fixture}/data/plugins/asdf-updates-fixture/bin/"{install,list-all}
	printf '1.0.0 2.0.0\n' >"${fixture}/data/plugins/asdf-updates-fixture/bin/versions"
	printf '\n[tools]\n"asdf:updates-fixture" = "1.0.0"\n' >>"${fixture}/config/config.toml"
	MISE_ENV='' isolated lock --global
	cp "${fixture}/config/mise.lock" "${fixture}/before.lock"
	bun - "${root}" "${fixture}" <<'JS'
const [root, fixture] = process.argv.slice(2);
const config = Bun.TOML.parse(await Bun.file(`${root}/unix/mise/agent-updates.toml`).text());
let output = '[tools."asdf:updates-fixture"]\n';
for (const [name, value] of Object.entries(config.tools.codex)) output += `${name} = ${JSON.stringify(value)}\n`;
await Bun.write(`${fixture}/config/config.local.toml`, output);
JS
	LOCAL_CONFIG_OFFLINE=false MISE_ENV='' isolated install
	LOCAL_CONFIG_OFFLINE=false MISE_ENV='' isolated lock --global
	cmp "${fixture}/before.lock" "${fixture}/config/mise.lock"
	grep -F 'version = "2.0.0"' "${fixture}/config/mise.local.lock"

	printf '1.0.0 2.0.0 3.0.0\n' >"${fixture}/data/plugins/asdf-updates-fixture/bin/versions"
	MISE_ENV='' isolated cache clear
	LOCAL_CONFIG_OFFLINE=false MISE_ENV='' isolated upgrade --global asdf:updates-fixture
	cmp "${fixture}/before.lock" "${fixture}/config/mise.lock"
	grep -F 'version = "3.0.0"' "${fixture}/config/mise.local.lock"
}

@test "native agent lock seeding never replaces machine-owned locks" {
	cp "${root}/unix/home/.config/mise/mise.lock" "${fixture}/config/mise.lock"
	cp "${fixture}/config/mise.lock" "${fixture}/before.lock"
	# The fresh-machine helper must work without any managed runtime on PATH.
	seed_lock() {
		env PATH="$(dirname "${local_mise}"):/usr/bin:/bin:/usr/sbin:/sbin" \
			MISE_CONFIG_DIR="${fixture}/config" MISE_SYSTEM_CONFIG_DIR="${fixture}/system" \
			MISE_STATE_DIR="${fixture}/state" MISE_DATA_DIR="${fixture}/data" \
			MISE_CACHE_DIR="${fixture}/cache" MISE_CEILING_PATHS="${fixture}" \
			MISE_TRUSTED_CONFIG_PATHS="${fixture}" MISE_OFFLINE=true CI=true \
			bash "${root}/unix/mise/seed-agent-lock.sh" "${fixture}/config"
	}
	seed_lock
	cmp "${fixture}/before.lock" "${fixture}/config/mise.lock"
	count=$(grep -c '^\[\[tools\.' "${fixture}/config/mise.local.lock")
	[[ ${count} -eq 2 ]]
	cp "${fixture}/config/mise.local.lock" "${fixture}/seeded.lock"
	seed_lock
	cmp "${fixture}/seeded.lock" "${fixture}/config/mise.local.lock"

	# Existing local entries, including generated dependency graph references, survive.
	cp "${fixture}/before.lock" "${fixture}/config/mise.local.lock"
	seed_lock
	cmp "${fixture}/before.lock" "${fixture}/config/mise.local.lock"
	: >"${fixture}/config/mise.local.lock"
	run -1 seed_lock
	[[ ! -s "${fixture}/config/mise.local.lock" ]]
	[[ ${output} == *'lock --global --local codex claude'* ]]

	printf 'lockfile_version = 3\n[[tools.machine-only]]\nversion = "1.0.0"\n' >"${fixture}/config/mise.local.lock"
	cp "${fixture}/config/mise.local.lock" "${fixture}/machine.lock"
	run -1 seed_lock
	cmp "${fixture}/machine.lock" "${fixture}/config/mise.local.lock"

	# Simulate a native atomic writer publishing between inspection and creation.
	rm "${fixture}/config/mise.local.lock"
	mkdir "${fixture}/race-bin"
	ln -s "${local_mise}" "${fixture}/race-bin/mise"
	cat >"${fixture}/race-bin/ln" <<'SH'
#!/bin/sh
cp "$SEED_RACE_SOURCE" "$2.race"
mv "$2.race" "$2"
exec /bin/ln "$@"
SH
	chmod +x "${fixture}/race-bin/ln"
	original_mise=${local_mise}
	local_mise="${fixture}/race-bin/mise"
	export SEED_RACE_SOURCE="${fixture}/machine.lock"
	run -1 seed_lock
	cmp "${fixture}/machine.lock" "${fixture}/config/mise.local.lock"
	local_mise=${original_mise}

	rm "${fixture}/config/mise.local.lock"
	ln -s "${fixture}/config/mise.lock" "${fixture}/config/mise.local.lock"
	run -1 seed_lock
	[[ -L "${fixture}/config/mise.local.lock" ]]
	cmp "${fixture}/before.lock" "${fixture}/config/mise.lock"
}
