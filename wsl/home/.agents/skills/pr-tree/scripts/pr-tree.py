#!/usr/bin/env python3
import argparse
import json
import re
import subprocess
from collections import defaultdict


DEPENDENCY_RE = re.compile(
    r"(depends?\s+on|requires?|stacked\s+on|based\s+on|blocked\s+on)",
    re.IGNORECASE,
)
GITHUB_URL_PREFIX = "https://github.com/"
URL_RE = re.compile(re.escape(GITHUB_URL_PREFIX) + r"([^/\s]+)/([^/\s]+)/pull/(\d+)")
OWNER_REPO_RE = re.compile(r"([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)#(\d+)")
LOCAL_REF_RE = re.compile(r"(?<![A-Za-z0-9_/.-])#(\d+)")
SPECIAL_NOTES = {
    "jdx/mise#9924": "body says to come back after tool opts refactor and other fixes complete.",
}


def run(args, *, check=True):
    return subprocess.run(
        args,
        check=check,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    ).stdout.strip()


def run_json(args):
    output = run(args)
    return json.loads(output) if output else None


def normalize_remote(url):
    url = url.strip().removesuffix("/").removesuffix(".git")
    prefixes = (
        "https://github.com/",
        "git@github.com:",
        "ssh://git@github.com/",
    )
    for prefix in prefixes:
        if url.startswith(prefix):
            return url.removeprefix(prefix)
    return url


def current_repo():
    remote = run(["git", "remote", "get-url", "origin"], check=False)
    return normalize_remote(remote) if remote else None


def search_targets(author, limit):
    data = run_json(
        [
            "gh",
            "search",
            "prs",
            "--author",
            author,
            "--state",
            "open",
            "--limit",
            str(limit),
            "--json",
            "number,repository",
        ]
    )
    return [
        (item["repository"]["nameWithOwner"], str(item["number"]))
        for item in data
        if item.get("repository")
    ]


def repo_targets(repo, author, limit):
    data = run_json(
        [
            "gh",
            "pr",
            "list",
            "--repo",
            repo,
            "--author",
            author,
            "--state",
            "open",
            "--limit",
            str(limit),
            "--json",
            "number",
        ]
    )
    return [(repo, str(item["number"])) for item in data]


def pr_view(repo, number):
    pr = run_json(
        [
            "gh",
            "pr",
            "view",
            number,
            "--repo",
            repo,
            "--json",
            "number,title,url,baseRefName,headRefName,isDraft,mergeStateStatus,statusCheckRollup,body,updatedAt",
        ]
    )
    pr["repo"] = repo
    pr["number"] = str(pr["number"])
    return pr


def tmux_wip_branches():
    panes = run(["tmux", "list-panes", "-a", "-F", "#{pane_current_path}"], check=False)
    branches = defaultdict(set)
    for path in panes.splitlines():
        if (
            run(["git", "-C", path, "rev-parse", "--is-inside-work-tree"], check=False)
            != "true"
        ):
            continue
        branch = run(["git", "-C", path, "branch", "--show-current"], check=False)
        if not branch:
            continue
        remote = normalize_remote(
            run(["git", "-C", path, "remote", "get-url", "origin"], check=False)
        )
        if remote:
            branches[remote].add(branch)
    return branches


def checks_for(pr):
    checks = []
    seen = set()
    for check in pr.get("statusCheckRollup") or []:
        normalized = {
            "name": check.get("name")
            or check.get("workflowName")
            or check.get("context")
            or "check",
            "status": check.get("conclusion")
            or check.get("state")
            or check.get("status")
            or "UNKNOWN",
        }
        identity = (normalized["name"], normalized["status"])
        if identity not in seen:
            checks.append(normalized)
            seen.add(identity)
    return checks


def check_names(pr, conclusion):
    return [check["name"] for check in checks_for(pr) if check["status"] == conclusion]


def pr_key(repo, number):
    return f"{repo}#{number}"


def dependency_refs(pr):
    refs = []
    for line in (pr.get("body") or "").splitlines():
        dependency_match = DEPENDENCY_RE.search(line)
        if not dependency_match:
            continue
        segment = line[dependency_match.start() :]
        for match in URL_RE.finditer(segment):
            refs.append(pr_key(f"{match.group(1)}/{match.group(2)}", match.group(3)))
        for match in OWNER_REPO_RE.finditer(segment):
            refs.append(pr_key(match.group(1), match.group(2)))
        cleaned = URL_RE.sub("", OWNER_REPO_RE.sub("", segment))
        for match in LOCAL_REF_RE.finditer(cleaned):
            refs.append(pr_key(pr["repo"], match.group(1)))
    return list(dict.fromkeys(refs))


def status_labels_for(pr, key, wip_keys, wip_branches):
    labels = []
    if pr.get("isDraft"):
        labels.append("DRAFT")
    if key in wip_keys or pr.get("headRefName") in wip_branches.get(pr["repo"], set()):
        labels.append("WIP")
    merge_state = pr.get("mergeStateStatus") or ""
    if merge_state not in ("", "CLEAN", "UNKNOWN"):
        labels.append(merge_state)
    return labels


def labels_for(pr, key, wip_keys, wip_branches):
    labels = status_labels_for(pr, key, wip_keys, wip_branches)
    return f" [{', '.join(labels)}]" if labels else ""


def print_pr(
    pr, key, wip_keys, wip_branches, missing_dependencies, prefix="", detail_prefix=None
):
    if detail_prefix is None:
        detail_prefix = prefix
    print(f"{prefix}{key} {pr['title']}{labels_for(pr, key, wip_keys, wip_branches)}")
    failures = check_names(pr, "FAILURE")
    cancelled = check_names(pr, "CANCELLED")
    if failures:
        print(f"{detail_prefix}  failed: {', '.join(failures)}")
    if cancelled:
        print(f"{detail_prefix}  cancelled: {', '.join(cancelled)}")
    if missing_dependencies[key]:
        print(f"{detail_prefix}  blocked on: {', '.join(missing_dependencies[key])}")
    if note := SPECIAL_NOTES.get(key):
        print(f"{detail_prefix}  note: {note}")


def print_tree(
    root,
    children,
    prs,
    wip_keys,
    wip_branches,
    missing_dependencies,
    prefix="",
    is_root=True,
    is_last=True,
    seen=None,
):
    if seen is None:
        seen = set()
    if root in seen:
        return
    seen.add(root)
    line_prefix = "" if is_root else prefix + ("└─ " if is_last else "├─ ")
    detail_prefix = "" if is_root else prefix + ("   " if is_last else "│  ")
    print_pr(
        prs[root],
        root,
        wip_keys,
        wip_branches,
        missing_dependencies,
        line_prefix,
        detail_prefix,
    )
    child_keys = sorted(
        children[root], key=lambda key: (prs[key]["repo"], -int(prs[key]["number"]))
    )
    next_prefix = prefix if is_root else prefix + ("   " if is_last else "│  ")
    for index, child in enumerate(child_keys):
        print_tree(
            child,
            children,
            prs,
            wip_keys,
            wip_branches,
            missing_dependencies,
            next_prefix,
            is_root=False,
            is_last=index == len(child_keys) - 1,
            seen=seen,
        )


def parse_args():
    parser = argparse.ArgumentParser(
        description="Inspect open GitHub PRs and their dependency relationships."
    )
    parser.add_argument(
        "--repo",
        action="append",
        help="Limit to a repository such as jdx/mise. May be repeated.",
    )
    parser.add_argument(
        "--current-repo",
        action="store_true",
        help="Limit to the current git repository.",
    )
    parser.add_argument(
        "--author", default="@me", help="PR author passed to gh. Defaults to @me."
    )
    parser.add_argument("--limit", type=int, default=200, help="Maximum PRs to fetch.")
    parser.add_argument(
        "--wip",
        action="append",
        default=[],
        help="Mark a PR as WIP. Accepts 123 or owner/repo#123.",
    )
    parser.add_argument(
        "--format",
        choices=("json", "text"),
        default="json",
        help="Output format. Defaults to agent-friendly JSON.",
    )
    return parser.parse_args()


def sorted_keys(keys, prs):
    return sorted(keys, key=lambda key: (prs[key]["repo"], -int(prs[key]["number"])))


def dependency_graph(prs):
    dependencies = {}
    parents = defaultdict(set)
    children = defaultdict(set)
    missing_dependencies = {}
    for key, pr in prs.items():
        declared = dependency_refs(pr)
        dependencies[key] = declared
        missing_dependencies[key] = sorted(
            parent for parent in declared if parent not in prs
        )
        for parent in declared:
            if parent in prs and parent != key:
                parents[key].add(parent)
                children[parent].add(key)
    return dependencies, parents, children, missing_dependencies


def build_snapshot(args, repos, prs, wip_keys, wip_branches):
    dependencies, parents, children, missing_dependencies = dependency_graph(prs)
    roots = sorted_keys(
        [
            key
            for key in prs
            if children[key] and not parents[key] and not missing_dependencies[key]
        ],
        prs,
    )
    blocked = sorted_keys([key for key in prs if missing_dependencies[key]], prs)
    standalone = sorted_keys(
        [
            key
            for key in prs
            if not parents[key] and not children[key] and not missing_dependencies[key]
        ],
        prs,
    )
    items = []
    for key in sorted_keys(prs, prs):
        pr = prs[key]
        labels = status_labels_for(pr, key, wip_keys, wip_branches)
        items.append(
            {
                "key": key,
                "repo": pr["repo"],
                "number": int(pr["number"]),
                "title": pr["title"],
                "url": pr.get("url"),
                "base_ref": pr.get("baseRefName"),
                "head_ref": pr.get("headRefName"),
                "updated_at": pr.get("updatedAt"),
                "status": {
                    "labels": labels,
                    "is_draft": bool(pr.get("isDraft")),
                    "is_wip": "WIP" in labels,
                    "merge_state": pr.get("mergeStateStatus") or "UNKNOWN",
                },
                "checks": checks_for(pr),
                "dependencies": dependencies[key],
                "open_dependencies": sorted_keys(parents[key], prs),
                "dependencies_outside_view": missing_dependencies[key],
                "dependents": sorted_keys(children[key], prs),
                "note": SPECIAL_NOTES.get(key),
            }
        )
    return {
        "schema_version": 1,
        "scope": {
            "author": args.author,
            "repositories": sorted({pr["repo"] for pr in prs.values()}),
            "repository_filters": sorted(set(repos)),
        },
        "summary": {
            "total": len(prs),
            "dependency_roots": roots,
            "blocked_by_prs_outside_view": blocked,
            "standalone": standalone,
        },
        "pull_requests": items,
    }


def print_text(prs, wip_keys, wip_branches):
    _, parents, children, missing_dependencies = dependency_graph(prs)
    printed = set()
    roots = sorted_keys(
        [
            key
            for key in prs
            if children[key] and not parents[key] and not missing_dependencies[key]
        ],
        prs,
    )
    if roots:
        print("dependency trees")
        for root in roots:
            print_tree(
                root,
                children,
                prs,
                wip_keys,
                wip_branches,
                missing_dependencies,
                seen=printed,
            )
        print()

    blocked = sorted_keys(
        [key for key in prs if missing_dependencies[key] and key not in printed],
        prs,
    )
    if blocked:
        print("dependent PRs whose blockers are not open in this view")
        for key in blocked:
            print_tree(
                key,
                children,
                prs,
                wip_keys,
                wip_branches,
                missing_dependencies,
                seen=printed,
            )
        print()

    remaining = sorted_keys([key for key in prs if key not in printed], prs)
    if remaining:
        print("other open PRs")
        multiple_repos = len({pr["repo"] for pr in prs.values()}) > 1
        current_repo_name = None
        for key in remaining:
            repo = prs[key]["repo"]
            if multiple_repos and repo != current_repo_name:
                current_repo_name = repo
                print(repo)
            print_pr(
                prs[key],
                key,
                wip_keys,
                wip_branches,
                missing_dependencies,
                "  " if multiple_repos else "",
            )


def main():
    args = parse_args()
    repos = args.repo or []
    if args.current_repo:
        repo = current_repo()
        if not repo:
            raise SystemExit("error: could not infer current repository")
        repos.append(repo)

    targets = []
    if repos:
        for repo in repos:
            targets.extend(repo_targets(repo, args.author, args.limit))
    else:
        targets = search_targets(args.author, args.limit)

    prs = {}
    for repo, number in targets:
        pr = pr_view(repo, number)
        prs[pr_key(repo, number)] = pr

    wip_branches = tmux_wip_branches()
    wip_keys = set()
    for value in args.wip:
        if "#" in value:
            wip_keys.add(value)
        else:
            for key, pr in prs.items():
                if pr["number"] == value:
                    wip_keys.add(key)

    if args.format == "json":
        print(
            json.dumps(
                build_snapshot(args, repos, prs, wip_keys, wip_branches), indent=2
            )
        )
    else:
        print_text(prs, wip_keys, wip_branches)


if __name__ == "__main__":
    main()
