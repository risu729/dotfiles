#!/usr/bin/env python3
import argparse
import importlib.util
import pathlib
import unittest
from collections import defaultdict


SCRIPT_PATH = pathlib.Path(__file__).with_name("pr-tree.py")
SPEC = importlib.util.spec_from_file_location("pr_tree", SCRIPT_PATH)
PR_TREE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PR_TREE)


def make_pr(repo, number, *, body="", **overrides):
    pr = {
        "repo": repo,
        "number": str(number),
        "title": f"PR {number}",
        "body": body,
        "headRefName": f"branch-{number}",
        "baseRefName": "main",
        "isDraft": False,
        "mergeStateStatus": "CLEAN",
        "statusCheckRollup": [],
        "url": f"https://github.com/{repo}/pull/{number}",
        "updatedAt": "2026-07-18T00:00:00Z",
    }
    pr.update(overrides)
    return pr


class PrTreeTests(unittest.TestCase):
    def test_dependency_refs_support_local_cross_repo_and_urls(self):
        pr = make_pr(
            "owner/repo",
            4,
            body="""Unrelated #1
Depends on #2 and owner/other#3.
Stacked on https://github.com/another/project/pull/5
""",
        )

        self.assertEqual(
            PR_TREE.dependency_refs(pr),
            ["owner/other#3", "owner/repo#2", "another/project#5"],
        )

    def test_snapshot_preserves_dependency_outside_view(self):
        key = "owner/repo#4"
        prs = {
            key: make_pr("owner/repo", 4, body="Depends on #2"),
        }
        args = argparse.Namespace(author="@me")

        snapshot = PR_TREE.build_snapshot(
            args, ["owner/repo"], prs, set(), defaultdict(set)
        )

        self.assertEqual(snapshot["summary"]["blocked_by_prs_outside_view"], [key])
        self.assertEqual(snapshot["summary"]["standalone"], [])
        self.assertEqual(snapshot["scope"]["repositories"], ["owner/repo"])
        self.assertEqual(snapshot["scope"]["repository_filters"], ["owner/repo"])
        self.assertEqual(
            snapshot["pull_requests"][0]["dependencies_outside_view"], ["owner/repo#2"]
        )

    def test_snapshot_normalizes_status_and_checks(self):
        key = "owner/repo#4"
        prs = {
            key: make_pr(
                "owner/repo",
                4,
                isDraft=True,
                mergeStateStatus="DIRTY",
                statusCheckRollup=[
                    {"name": "test", "conclusion": "FAILURE"},
                    {"name": "test", "conclusion": "FAILURE"},
                ],
            ),
        }
        args = argparse.Namespace(author="@me")

        snapshot = PR_TREE.build_snapshot(args, [], prs, {key}, defaultdict(set))
        item = snapshot["pull_requests"][0]

        self.assertEqual(item["status"]["labels"], ["DRAFT", "WIP", "DIRTY"])
        self.assertEqual(item["checks"], [{"name": "test", "status": "FAILURE"}])


if __name__ == "__main__":
    unittest.main()
