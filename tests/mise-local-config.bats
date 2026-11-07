#!/usr/bin/env bats
# shellcheck shell=bash
# shellcheck disable=SC2154

setup() {
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
		MISE_TRUSTED_CONFIG_PATHS="${fixture}" MISE_OFFLINE=true CI=true \
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
