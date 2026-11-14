#!/usr/bin/env bats
# shellcheck shell=bash
# Bats supplies test paths and captured output.
# shellcheck disable=SC2154

setup() {
	bats_require_minimum_version 1.7.0
	root=$(cd "${BATS_TEST_DIRNAME}/.." && pwd)
	export GHR_TEST_HOME="${BATS_TEST_TMPDIR}"
	export GHR_TEST_SOURCE="${root}/unix/home/.config/shell/ghr.sh"
	mkdir -p "${GHR_TEST_HOME}/bin" "${GHR_TEST_HOME}/repo with spaces"
	export PATH="${GHR_TEST_HOME}/bin:${PATH}"
	cat >"${GHR_TEST_HOME}/bin/ghr" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$@" >>"${GHR_TEST_HOME}/calls"
case "$1" in
path)
	[[ ${2:-} != missing ]] || exit 23
	printf '%s\n' "${GHR_TEST_HOME}/repo with spaces"
	;;
list)
	if [[ ${2:-} == --path ]]; then
		printf '%s\n' "${GHR_TEST_HOME}/repo with spaces"
	else
		printf 'owner/repo\n'
	fi
	;;
clone | init) exit "${GHR_TEST_STATUS:-0}" ;;
esac
STUB
	cat >"${GHR_TEST_HOME}/bin/fzf" <<'STUB'
#!/usr/bin/env bash
cat
exit "${GHR_TEST_STATUS:-0}"
STUB
	chmod +x "${GHR_TEST_HOME}/bin/"*
}

@test "Bash repository navigation preserves arguments, directory and failures" {
	run -0 bash --noprofile --norc "${BATS_TEST_DIRNAME}/fixtures/ghr-navigation.sh"
}

@test "Zsh repository navigation preserves arguments, directory and failures" {
	command -v zsh >/dev/null || skip 'zsh is not installed'
	run -0 zsh -f "${BATS_TEST_DIRNAME}/fixtures/ghr-navigation.sh"
}
