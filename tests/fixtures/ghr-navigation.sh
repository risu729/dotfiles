# shellcheck shell=bash
# Run in a clean Bash or Zsh process against executable stubs supplied by Bats.
# Failure cases deliberately capture nonzero status with errexit disabled.
# shellcheck disable=SC2310
set -eu
: "${GHR_TEST_SOURCE:?}" "${GHR_TEST_HOME:?}"
# shellcheck source=unix/home/.config/shell/ghr.sh
source "${GHR_TEST_SOURCE}"

cd "${GHR_TEST_HOME}"
ghr cd 'owner/repo with spaces'
[[ ${PWD} == "${GHR_TEST_HOME}/repo with spaces" ]]
calls=$(cat "${GHR_TEST_HOME}/calls")
[[ ${calls} == $'path\nowner/repo with spaces' ]]

for operation in clone init; do
	cd "${GHR_TEST_HOME}"
	: >"${GHR_TEST_HOME}/calls"
	ghr "${operation}" 'owner/repo with spaces' --cd
	[[ ${PWD} == "${GHR_TEST_HOME}/repo with spaces" ]]
	calls=$(cat "${GHR_TEST_HOME}/calls")
	[[ ${calls} == "${operation}"$'\nowner/repo with spaces\n--cd\npath\nowner/repo with spaces' ]]
done

cd "${GHR_TEST_HOME}"
ghr clone owner/repo
[[ ${PWD} == "${GHR_TEST_HOME}" ]]
ghr clone owner/repo --cd --help
[[ ${PWD} == "${GHR_TEST_HOME}" ]]

export GHR_TEST_STATUS=17
result=0
ghr clone owner/repo --cd || result=$?
[[ ${result} == 17 && ${PWD} == "${GHR_TEST_HOME}" ]]
unset GHR_TEST_STATUS

result=0
ghr cd missing || result=$?
[[ ${result} == 23 && ${PWD} == "${GHR_TEST_HOME}" ]]

ghr cd
[[ ${PWD} == "${GHR_TEST_HOME}/repo with spaces" ]]
cd "${GHR_TEST_HOME}"
export GHR_TEST_STATUS=130
result=0
ghr cd || result=$?
[[ ${result} == 130 && ${PWD} == "${GHR_TEST_HOME}" ]]
unset GHR_TEST_STATUS

# Sourcing twice must not recurse through a previously defined wrapper.
# shellcheck source=unix/home/.config/shell/ghr.sh
source "${GHR_TEST_SOURCE}"
: >"${GHR_TEST_HOME}/calls"
ghr status '--option with spaces'
calls=$(cat "${GHR_TEST_HOME}/calls")
[[ ${calls} == $'status\n--option with spaces' ]]
ghr cd owner/repo
[[ ${PWD} == "${GHR_TEST_HOME}/repo with spaces" ]]
