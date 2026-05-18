#!/usr/bin/env bash
set -euo pipefail

repo="jdx/mise"
extra_wips=()

usage() {
	printf 'usage: %s [--repo owner/name] [--wip PR]...\n' "${0##*/}" >&2
}

while (($#)); do
	case "$1" in
	--repo)
		[[ $# -ge 2 ]] || {
			usage
			exit 2
		}
		repo=$2
		shift 2
		;;
	--wip)
		[[ $# -ge 2 ]] || {
			usage
			exit 2
		}
		extra_wips+=("$2")
		shift 2
		;;
	-h | --help)
		usage
		exit 0
		;;
	*)
		usage
		exit 2
		;;
	esac
done

declare -A title draft merge_state failed cancelled branch present wip
declare -a all_numbers

while IFS=$'\t' read -r number pr_title head_ref is_draft state failed_checks cancelled_checks; do
	[[ -n ${number} ]] || continue
	all_numbers+=("${number}")
	present["${number}"]=1
	title["${number}"]=${pr_title}
	branch["${number}"]=${head_ref}
	draft["${number}"]=${is_draft}
	merge_state["${number}"]=${state}
	failed["${number}"]=${failed_checks}
	cancelled["${number}"]=${cancelled_checks}
done < <(
	gh pr list \
		--repo "${repo}" \
		--author @me \
		--state open \
		--limit 120 \
		--json number,title,headRefName,isDraft,mergeStateStatus,statusCheckRollup \
		--jq '.[] | [
			.number,
			.title,
			.headRefName,
			(if .isDraft then "true" else "false" end),
			(.mergeStateStatus // ""),
			([.statusCheckRollup[]? | select((.conclusion // .state // "") == "FAILURE") | (.name // .workflowName // .context // "check")] | join(", ")),
			([.statusCheckRollup[]? | select((.conclusion // .state // "") == "CANCELLED") | (.name // .workflowName // .context // "check")] | join(", "))
		] | @tsv'
)

for number in "${extra_wips[@]}"; do
	wip["${number}"]=1
done

if command -v tmux >/dev/null 2>&1 && tmux list-panes -a -F '#{pane_current_path}' >/dev/null 2>&1; then
	while IFS=$'\t' read -r remote current_branch; do
		[[ ${remote} == "${repo}" && -n ${current_branch} ]] || continue
		for number in "${all_numbers[@]}"; do
			if [[ ${branch[${number}]} == "${current_branch}" ]]; then
				wip["${number}"]=1
			fi
		done
	done < <(
		tmux list-panes -a -F '#{pane_current_path}' |
			while IFS= read -r pane_path; do
				if git -C "${pane_path}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
					current_branch=$(git -C "${pane_path}" branch --show-current 2>/dev/null || true)
					[[ -n ${current_branch} ]] || continue
					remote=$(
						git -C "${pane_path}" remote get-url origin 2>/dev/null |
							sed -E 's#^https://github.com/##; s#^git@github.com:##; s#\.git$##'
					)
					printf '%s\t%s\n' "${remote}" "${current_branch}"
				fi
			done
	)
fi

shown=()

is_present() {
	[[ -n ${present[$1]:-} ]]
}

mark_shown() {
	shown+=("$1")
}

is_shown() {
	local needle=$1 number
	for number in "${shown[@]}"; do
		[[ ${number} == "${needle}" ]] && return 0
	done
	return 1
}

labels_for() {
	local number=$1
	local labels=()
	if [[ ${draft[${number}]:-false} == "true" ]]; then
		labels+=("DRAFT")
	fi
	if [[ -n ${wip[${number}]:-} ]]; then
		labels+=("WIP")
	fi
	case "${merge_state[${number}]:-}" in
	"" | CLEAN | UNKNOWN) ;;
	*) labels+=("${merge_state[${number}]}") ;;
	esac
	if ((${#labels[@]})); then
		local joined
		printf -v joined '%s, ' "${labels[@]}"
		printf ' [%s]' "${joined%, }"
	fi
}

print_pr() {
	local prefix=$1 number=$2
	is_present "${number}" || return 1
	printf '%s#%s %s%s\n' "${prefix}" "${number}" "${title[${number}]}" "$(labels_for "${number}")"
	if [[ -n ${failed[${number}]:-} ]]; then
		printf '%s  failed: %s\n' "${prefix}" "${failed[${number}]}"
	fi
	if [[ -n ${cancelled[${number}]:-} ]]; then
		printf '%s  cancelled: %s\n' "${prefix}" "${cancelled[${number}]}"
	fi
	mark_shown "${number}"
}

section() {
	printf '%s\n' "$1"
}

print_install_env_tree() {
	local any=0
	for number in 9929 9913 9919 9916 9904; do
		is_present "${number}" && any=1
	done
	((any)) || return 0
	section "install_env / npm safety"
	if print_pr "" 9929; then
		if print_pr "└─ " 9913; then
			print_pr "   ├─ " 9919 || true
			print_pr "   ├─ " 9916 || true
			print_pr "   └─ " 9904 || true
		fi
	elif print_pr "" 9913; then
		print_pr "├─ " 9919 || true
		print_pr "├─ " 9916 || true
		print_pr "└─ " 9904 || true
	fi
	printf '\n'
}

print_tool_opts_tree() {
	local any=0
	for number in 9962 9963 9959 9958 9915 9917 9918 9924; do
		is_present "${number}" && any=1
	done
	((any)) || return 0
	section "tool options / install manifest"
	print_pr "├─ " 9962 || true
	print_pr "├─ " 9963 || true
	print_pr "├─ " 9959 || true
	print_pr "├─ " 9915 || true
	print_pr "├─ " 9917 || true
	print_pr "├─ " 9918 || true
	print_pr "├─ " 9958 || true
	if print_pr "└─ " 9924; then
		printf '   note: body says you will come back after tool opts refactor and other fixes complete.\n'
	fi
	printf '\n'
}

print_cd_tree() {
	local any=0
	for number in 9835 9908; do
		is_present "${number}" && any=1
	done
	((any)) || return 0
	section "--cd / task cwd"
	if print_pr "" 9835; then
		print_pr "└─ " 9908 || true
	else
		print_pr "" 9908 || true
	fi
	printf '\n'
}

print_single_section() {
	local heading=$1
	shift
	local any=0 number
	for number in "$@"; do
		is_present "${number}" && any=1
	done
	((any)) || return 0
	section "${heading}"
	for number in "$@"; do
		print_pr "" "${number}" || true
	done
	printf '\n'
}

print_install_env_tree
print_tool_opts_tree
print_cd_tree
print_single_section "registry / backend priority" 9901
print_single_section "release age" 9768

standalone=()
for number in "${all_numbers[@]}"; do
	if ! is_shown "${number}"; then
		standalone+=("${number}")
	fi
done

if ((${#standalone[@]})); then
	section "standalone open"
	for number in "${standalone[@]}"; do
		print_pr "" "${number}" || true
	done
fi
