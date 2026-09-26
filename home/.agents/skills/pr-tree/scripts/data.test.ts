/* oxlint-disable eslint/sort-keys vitest/prefer-importing-vitest-globals */

import { describe, expect, test } from "bun:test";

import { matchPullRequest } from "./agents.ts";
import { hasConflict, normalizeRemote, summarizeChecks } from "./data.ts";
import type { PullRequest } from "./data.ts";

const makePullRequest = (number: number, overrides: Partial<PullRequest> = {}): PullRequest => ({
	repo: "owner/repo",
	number,
	title: `PR ${number}`,
	url: `https://github.com/owner/repo/pull/${number}`,
	state: "OPEN",
	headRefName: `branch-${number}`,
	headRefOid: `sha-${number}`,
	headRepository: { name: "repo" },
	headRepositoryOwner: { login: "owner" },
	isDraft: false,
	mergeable: "MERGEABLE",
	mergeStateStatus: "CLEAN",
	statusCheckRollup: [],
	updatedAt: "2026-07-18T00:00:00Z",
	...overrides,
});

describe("hasConflict", () => {
	test("treats either conflict signal on its own as a conflict", () => {
		expect(hasConflict(makePullRequest(1, { mergeable: "CONFLICTING" }))).toBe(true);
		expect(
			hasConflict(makePullRequest(1, { mergeable: "UNKNOWN", mergeStateStatus: "DIRTY" })),
		).toBe(true);
		expect(
			hasConflict(makePullRequest(1, { mergeable: "UNKNOWN", mergeStateStatus: "CLEAN" })),
		).toBe(false);
	});

	test("ignores the stale merge state left on closed and merged pull requests", () => {
		const dirty = { mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" } as const;

		expect(hasConflict(makePullRequest(1, dirty))).toBe(true);
		expect(hasConflict(makePullRequest(1, { ...dirty, state: "MERGED" }))).toBe(false);
		expect(hasConflict(makePullRequest(1, { ...dirty, state: "CLOSED" }))).toBe(false);
	});
});

describe("summarizeChecks", () => {
	// A matrix job reports one name several times; those must not inflate the passing count.
	test("counts distinct names and does not credit duplicates as passing", () => {
		const rollup = [
			{ name: "lint", conclusion: "FAILURE" },
			{ name: "lint", conclusion: "FAILURE" },
			{ workflowName: "e2e", status: "IN_PROGRESS" },
			{ context: "unit", state: "SUCCESS" },
			{ name: "skipped", conclusion: "SKIPPED" },
		];

		expect(summarizeChecks(makePullRequest(1, { statusCheckRollup: rollup }))).toEqual({
			state: "failing",
			failing: ["lint"],
			pending: ["e2e"],
			passing: 2,
		});
	});

	test("reports no passing checks when every check is a repeated failure", () => {
		const rollup = Array.from({ length: 4 }, () => ({ name: "test", conclusion: "FAILURE" }));

		expect(summarizeChecks(makePullRequest(1, { statusCheckRollup: rollup }))).toEqual({
			state: "failing",
			failing: ["test"],
			pending: [],
			passing: 0,
		});
	});

	test("reports pending when nothing failed, and none for an empty or absent rollup", () => {
		const pending = [{ name: "e2e", conclusion: "QUEUED" }];

		expect(summarizeChecks(makePullRequest(1, { statusCheckRollup: pending })).state).toBe(
			"pending",
		);
		expect(summarizeChecks(makePullRequest(1, { statusCheckRollup: [] })).state).toBe("none");
		expect(summarizeChecks(makePullRequest(1, { statusCheckRollup: null })).state).toBe("none");
	});

	test("falls back to a literal name when an entry names itself no other way", () => {
		const rollup = [{ conclusion: "FAILURE" }];

		expect(summarizeChecks(makePullRequest(1, { statusCheckRollup: rollup })).failing).toEqual([
			"check",
		]);
	});
});

describe("normalizeRemote", () => {
	test("reduces every remote form to owner/name", () => {
		expect(normalizeRemote("https://github.com/owner/repo.git")).toBe("owner/repo");
		expect(normalizeRemote("git@github.com:owner/repo.git")).toBe("owner/repo");
		expect(normalizeRemote("ssh://git@github.com/owner/repo")).toBe("owner/repo");
	});

	test("handles ssh alias hosts, trailing slashes, and userinfo", () => {
		expect(normalizeRemote("git@github-work:owner/repo.git")).toBe("owner/repo");
		expect(normalizeRemote("https://github.com/owner/repo/")).toBe("owner/repo");
		expect(normalizeRemote("https://user@github.com/owner/repo.git")).toBe("owner/repo");
	});
});

describe("matchPullRequest", () => {
	test("matches a worktree branch to the head, preferring the head repository", () => {
		const pullRequests = new Map([
			["owner/repo#1", makePullRequest(1, { headRefName: "shared" })],
			[
				"owner/repo#2",
				makePullRequest(2, {
					headRefName: "shared",
					headRepositoryOwner: { login: "fork" },
					headRepository: { name: "repo" },
				}),
			],
		]);

		expect(matchPullRequest({ repo: "fork/repo", branch: "shared" }, pullRequests)).toBe(
			"owner/repo#2",
		);
		expect(matchPullRequest({ repo: "owner/repo", branch: "shared" }, pullRequests)).toBe(
			"owner/repo#1",
		);
	});

	test("picks the highest number when one branch has several pull requests", () => {
		const pullRequests = new Map(
			[5, 12].map((number) => [
				`owner/repo#${number}`,
				makePullRequest(number, { headRefName: "shared" }),
			]),
		);

		expect(matchPullRequest({ repo: "owner/repo", branch: "shared" }, pullRequests)).toBe(
			"owner/repo#12",
		);
	});

	// A generic branch name reused across repositories must not attribute an agent to the wrong PR.
	test("never matches across repositories, and gives up without a branch or repo", () => {
		const pullRequests = new Map([
			["owner/repo#1", makePullRequest(1, { headRefName: "fix/typo" })],
		]);

		expect(matchPullRequest({ repo: "other/thing", branch: "fix/typo" }, pullRequests)).toBeNull();
		expect(matchPullRequest({ repo: null, branch: "fix/typo" }, pullRequests)).toBeNull();
		expect(matchPullRequest({ repo: "owner/repo", branch: null }, pullRequests)).toBeNull();
		expect(matchPullRequest({ repo: "owner/repo", branch: "absent" }, pullRequests)).toBeNull();
	});
});
