# shellcheck shell=bash
# Bats supplies BATS_TEST_DIRNAME and captures the command status.
# shellcheck disable=SC2154

@test "dotfile groups preserve bootstrap deployment plans" {
	run bun test "${BATS_TEST_DIRNAME}/dotfile-groups.test.ts"
	if [[ ${status} -ne 0 ]]; then
		printf '%s\n' "${output}"
		return 1
	fi
}
