#!/usr/bin/env bats
# shellcheck shell=bash
# Error paths deliberately call helpers with errexit disabled by Bats run.
# Bats supplies its variables; the sourced installer calls the stubs indirectly.
# shellcheck disable=SC2310,SC2154,SC2329

assert_output() {
	local expected="$1" actual
	shift
	actual=$("$@")
	test "${actual}" = "${expected}"
}

setup() {
	bats_require_minimum_version 1.7.0
	root=$(cd "${BATS_TEST_DIRNAME}/.." && pwd)
	# shellcheck source=unix/install.sh
	source "${root}/unix/install.sh"
	remote="${BATS_TEST_TMPDIR}/remote"
	checkout="${BATS_TEST_TMPDIR}/checkout"
	git -c init.defaultBranch=main init --quiet "${remote}"
	git -C "${remote}" config user.name 'Installer test'
	git -C "${remote}" config user.email 'installer@example.invalid'
	git -C "${remote}" config commit.gpgsign false
	git -C "${remote}" config core.hooksPath /dev/null
	printf 'main\n' >"${remote}/managed"
	git -C "${remote}" add managed
	git -C "${remote}" commit --quiet -m initial
	git clone --quiet "${remote}" "${checkout}"
	# Create the requested revision after cloning to exercise fetching missing refs.
	git -C "${remote}" checkout --quiet -b requested
	printf 'requested\n' >"${remote}/managed"
	git -C "${remote}" commit --quiet --all -m requested
	requested=$(git -C "${remote}" rev-parse HEAD)
	git -C "${remote}" checkout --quiet main
	ln -s "${checkout}/managed" "${BATS_TEST_TMPDIR}/installed"
	export MISE_CALL_LOG="${BATS_TEST_TMPDIR}/mise-calls"

	# Stub only package/configuration work. Git operations remain real.
	trust_configs() { :; }
	mise() {
		if [[ $* == *'bootstrap repos update'* ]]; then
			assert_output main git -C "${checkout}" branch --show-current
			git -C "${checkout}" pull --quiet --ff-only
		fi
	}
	install_mise() { :; }
	clone_or_update_dotfiles_repo() {
		select_dotfiles_revision "${checkout}" "$1" "${remote}" >&2 || return
		printf '%s\n' "${checkout}"
	}
}

@test "installer fetches a missing local ref and preserves the installed revision" {
	git_ref=requested
	main
	assert_output "${requested}" git -C "${checkout}" rev-parse HEAD
	assert_output requested cat "${BATS_TEST_TMPDIR}/installed"
	assert_output "" git -C "${checkout}" branch --show-current
}

@test "repeated commit-pinned installation preserves the installed configuration" {
	git_ref=${requested}
	main
	main
	assert_output "${requested}" git -C "${checkout}" rev-parse HEAD
	assert_output requested cat "${BATS_TEST_TMPDIR}/installed"
}

@test "installer refreshes shims after each bootstrap" {
	git_ref=${requested}
	mise() { printf '%s\n' "$*" >>"${MISE_CALL_LOG}"; }
	main
	main
	run -0 cat "${MISE_CALL_LOG}"
	[[ ${#lines[@]} == 4 ]]
	[[ ${lines[0]} == "--cd ${checkout} bootstrap --yes --update --force-dotfiles --locked --skip-dirty" ]]
	[[ ${lines[1]} == "--cd ${checkout} reshim" ]]
	[[ ${lines[2]} == "${lines[0]}" ]]
	[[ ${lines[3]} == "${lines[1]}" ]]
}

@test "bootstrap selects the default Rust homes before its first tool install" {
	git_ref=${requested}
	unset CARGO_HOME RUSTUP_HOME
	mise() {
		printf '%s\n' "${CARGO_HOME-unset}" "${RUSTUP_HOME-unset}" >>"${MISE_CALL_LOG}"
	}
	main
	main
	run -0 cat "${MISE_CALL_LOG}"
	[[ ${#lines[@]} == 8 ]]
	for index in 0 2 4 6; do
		[[ ${lines[index]} == "${HOME}/.cargo" ]]
		[[ ${lines[index + 1]} == "${HOME}/.rustup" ]]
	done
}

@test "bootstrap preserves caller Rust homes including paths with spaces" {
	git_ref=${requested}
	export CARGO_HOME="${BATS_TEST_TMPDIR}/custom cargo"
	export RUSTUP_HOME="${BATS_TEST_TMPDIR}/custom rustup"
	mise() {
		printf '%s\n' "${CARGO_HOME}" "${RUSTUP_HOME}" >>"${MISE_CALL_LOG}"
	}
	main
	run -0 cat "${MISE_CALL_LOG}"
	[[ ${#lines[@]} == 4 ]]
	[[ ${lines[0]} == "${CARGO_HOME}" && ${lines[2]} == "${CARGO_HOME}" ]]
	[[ ${lines[1]} == "${RUSTUP_HOME}" && ${lines[3]} == "${RUSTUP_HOME}" ]]
}

@test "failed shim refresh cannot report installation success" {
	git_ref=${requested}
	mise() {
		if [[ $* == *' reshim' ]]; then
			return 23
		fi
	}
	run -23 main
	[[ ${output} != *'Setup script finished successfully!'* ]]
}

@test "ordinary installation returns from a pinned revision to updated main" {
	git_ref=requested
	main
	printf 'updated main\n' >"${remote}/managed"
	git -C "${remote}" commit --quiet --all -m update
	git_ref=''
	main
	assert_output 'updated main' cat "${BATS_TEST_TMPDIR}/installed"
	assert_output main git -C "${checkout}" branch --show-current
}

@test "revision selection rejects an unexpected origin" {
	run ! select_dotfiles_revision "${checkout}" requested "${BATS_TEST_TMPDIR}/wrong-origin"
	[[ ${output} == *'different origin'* ]]
	assert_output main git -C "${checkout}" branch --show-current
}

@test "failed fetch cannot reuse a previous FETCH_HEAD" {
	git -C "${checkout}" fetch origin requested
	run ! select_dotfiles_revision "${checkout}" nonexistent-ref "${remote}"
	assert_output main git -C "${checkout}" branch --show-current
	assert_output main cat "${BATS_TEST_TMPDIR}/installed"
}

@test "revision selection preserves a dirty checkout" {
	printf 'local changes\n' >"${checkout}/managed"
	run ! select_dotfiles_revision "${checkout}" requested "${remote}"
	[[ ${output} == *'dirty repository'* ]]
	assert_output 'local changes' cat "${BATS_TEST_TMPDIR}/installed"
}

@test "installer entry point works on standard input" {
	piped_result=$(
		awk '
			/^main\(\) \{/ { skip = 1; print "main() { echo stdin-entry-point; }"; next }
			skip && /^}/ { skip = 0; next }
			!skip { print }
		' "${root}/unix/install.sh" | bash
	)
	test "${piped_result}" = stdin-entry-point
}
