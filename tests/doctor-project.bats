#!/usr/bin/env bats
# shellcheck shell=bash
# Bats supplies test paths and captured output.
# shellcheck disable=SC2154

setup() {
	bats_require_minimum_version 1.7.0
	root=$(cd "${BATS_TEST_DIRNAME}/.." && pwd)
	doctor_mise=${DOCTOR_TEST_MISE:-$(command -v mise)}
	fixture="${BATS_TEST_TMPDIR}/project with spaces"
	fixture_home="${BATS_TEST_TMPDIR}/home"
	mkdir -p "${fixture}/mise/doctor" "${fixture}/child" \
		"${fixture_home}/.config/mise" "${fixture_home}/.config/git" "${fixture}/bin"
	cp "${root}/mise/doctor/"* "${fixture}/mise/doctor/"
	printf '[settings]\nexperimental = true\n' >"${fixture}/mise.toml"
	printf 'auto_env = true\n' >"${fixture_home}/.config/mise/miserc.toml"
	touch "${fixture}/global.toml" "${fixture}/gitconfig"
	ln -s "${fixture}/global.toml" "${fixture_home}/.config/mise/config.toml"
	ln -s "${fixture}/gitconfig" "${fixture_home}/.config/git/config"
	cat >"${fixture}/bin/mise" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
case "$*" in
'which eza' | 'which kubectl') exit 0 ;;
'bootstrap files status --missing' | 'bootstrap macos defaults status --missing') [[ -d mise/doctor ]] ;;
*) exec "${DOCTOR_REAL_MISE}" "$@" ;;
esac
STUB
	chmod +x "${fixture}/bin/mise"
	cd "${fixture}/child" || return
}

isolated() {
	env -i PATH="${fixture}/bin:/usr/bin:/bin:$(dirname "${doctor_mise}")" \
		HOME="${fixture_home}" MISE_CONFIG_DIR="${fixture_home}/.config/mise" \
		MISE_DATA_DIR="${BATS_TEST_TMPDIR}/data" MISE_CACHE_DIR="${BATS_TEST_TMPDIR}/cache" \
		MISE_STATE_DIR="${BATS_TEST_TMPDIR}/state" MISE_SYSTEM_CONFIG_DIR="${BATS_TEST_TMPDIR}/system" \
		MISE_TRUSTED_CONFIG_PATHS="${fixture}" MISE_OFFLINE=true CI=true \
		DOCTOR_REAL_MISE="${doctor_mise}" "$@"
}

assert_check() {
	printf '%s' "${output}" | bun -e '
		const report = await Bun.stdin.json();
		const check = report.checks.find(c => c.name === process.argv[1]);
		if (report.errors.length || check?.status !== process.argv[2]) process.exit(1);
		if (check.status === "fail" && !check.hint) process.exit(1);
	' "$1" "$2"
}

@test "ordinary development has no installed-machine project checks" {
	run -0 isolated "${doctor_mise}" doctor project --json
	printf '%s' "${output}" | bun -e '
		const r = await Bun.stdin.json();
		if (r.errors.length || r.checks.length) process.exit(1);
	'
}

@test "opt-in checks resolve from config root and report platform skips" {
	# The empty fixture is not a bootstrapped machine: platform state/shell fail.
	# Shared links, commands and bare profile pass without touching the real HOME.
	run -1 --separate-stderr isolated TEST_PROFILE=bare "${doctor_mise}" --cd "${fixture}/mise/doctor" doctor project --json
	assert_check shared pass
	assert_check profile pass
	case "$(uname -s)" in
	Darwin)
		assert_check linux-state skipped
		assert_check linux-shell skipped
		;;
	Linux)
		assert_check macos-state skipped
		assert_check macos-shell skipped
		;;
	*) return 1 ;;
	esac
}

@test "project diagnostics reject a dangling dotfile link with a repair hint" {
	rm "${fixture}/gitconfig"
	run -1 isolated TEST_PROFILE=bare "${doctor_mise}" --cd "${fixture}/mise/doctor" doctor project --json
	assert_check shared fail
	assert_check profile pass
	# The documented debug command exposes the failing expanded path.
	run -1 isolated bash -x "${fixture}/mise/doctor/check.sh" shared
	[[ ${output} == *"${fixture_home}/.config/git/config"* ]]
}

@test "bare profile rejects missing profile state instead of silently passing" {
	rm "${fixture_home}/.config/mise/miserc.toml"
	run -1 isolated TEST_PROFILE=bare "${doctor_mise}" --cd "${fixture}/mise/doctor" doctor project --json
	assert_check profile fail
}

@test "bare profile rejects even dangling personal links" {
	mkdir -p "${fixture_home}/.ssh"
	ln -s missing "${fixture_home}/.ssh/config"
	run -1 isolated TEST_PROFILE=bare "${doctor_mise}" --cd "${fixture}/mise/doctor" doctor project --json
	assert_check profile fail
}

@test "personal profile remains active in the opt-in config" {
	printf 'auto_env = true\nenv = ["personal"]\n' >"${fixture_home}/.config/mise/miserc.toml"
	cat >"${fixture}/mise.personal.toml" <<'TOML'
[tools]
glab = { version = "0.0.0", lazy = true }
[env]
DOCTOR_PERSONAL_LOADED = "true"
[doctor.checks.profile-environment]
run = 'test "$DOCTOR_PERSONAL_LOADED" = true'
shell = "bash -c"
TOML
	mkdir -p "${fixture_home}/.ssh" "${fixture_home}/.ghr/github.com/risu729/biwa/.git"
	ln -s "${fixture}/gitconfig" "${fixture_home}/.ssh/config"
	ln -s "${fixture}/gitconfig" "${fixture_home}/.config/git/personal.gitconfig"
	ln -s "${fixture}/gitconfig" "${fixture_home}/.config/git/unsw.gitconfig"
	run -1 isolated TEST_PROFILE=personal "${doctor_mise}" --cd "${fixture}/mise/doctor" doctor project --json
	assert_check profile pass
	assert_check profile-environment pass
}

@test "profile check requires an explicit valid profile" {
	run -1 isolated "${doctor_mise}" --cd "${fixture}/mise/doctor" doctor project --json
	assert_check profile fail
	run -1 isolated TEST_PROFILE=invalid "${doctor_mise}" --cd "${fixture}/mise/doctor" doctor project --json
	assert_check profile fail
}

@test "project checks inherit normal trust from the repository config" {
	run -0 isolated MISE_TRUSTED_CONFIG_PATHS= "${doctor_mise}" trust --yes "${fixture}/mise.toml"
	run -1 isolated MISE_TRUSTED_CONFIG_PATHS= TEST_PROFILE=bare "${doctor_mise}" --cd "${fixture}/mise/doctor" doctor project --json
	assert_check shared pass
	assert_check profile pass
}

@test "bare profile rejects a selected but uninstalled lazy personal tool" {
	printf '\n[tools]\nglab = {version="0.0.0",lazy=true}\n' >>"${fixture}/mise.toml"
	run -1 isolated TEST_PROFILE=bare "${doctor_mise}" --cd "${fixture}/mise/doctor" doctor project --json
	assert_check profile fail
}
