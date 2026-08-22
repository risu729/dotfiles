/* oxlint-disable eslint/sort-keys vitest/prefer-importing-vitest-globals */

import { describe, expect, test } from "bun:test";

import {
	hasConflict,
	matchPullRequest,
	nearestParent,
	normalizeRemote,
	summarizeChecks,
} from "./data.ts";
import type { PullRequest } from "./data.ts";
import { buildEntries, sortIds } from "./pr-tree.ts";

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
	latestReviews: [],
	updatedAt: "2026-07-18T00:00:00Z",
	...overrides,
});

// A linear stack 1 <- 2 <- 3, where each head contains every head below it.
const chain = new Map([
	["owner/repo#1", new Set<string>()],
	["owner/repo#2", new Set(["owner/repo#1"])],
	["owner/repo#3", new Set(["owner/repo#1", "owner/repo#2"])],
]);
const stacksFrom = (ancestors: Map<string, Set<string>>) =>
	new Map(
		[...ancestors].map(([id, contained]) => [
			id,
			{ ancestors: [...contained].toSorted(), parent: nearestParent(id, ancestors) },
		]),
	);

describe("nearestParent", () => {
	test("picks the ancestor carrying every other ancestor", () => {
		expect(nearestParent("owner/repo#3", chain)).toBe("owner/repo#2");
		expect(nearestParent("owner/repo#2", chain)).toBe("owner/repo#1");
	});

	test("returns null for a root and for an unknown id", () => {
		expect(nearestParent("owner/repo#1", chain)).toBeNull();
		expect(nearestParent("owner/repo#9", chain)).toBeNull();
	});

	test("does not pick a sibling when two branches share one ancestor", () => {
		const fork = new Map([
			["owner/repo#1", new Set<string>()],
			["owner/repo#2", new Set(["owner/repo#1"])],
			["owner/repo#3", new Set(["owner/repo#1"])],
		]);

		expect(nearestParent("owner/repo#2", fork)).toBe("owner/repo#1");
		expect(nearestParent("owner/repo#3", fork)).toBe("owner/repo#1");
	});
});

describe("buildEntries", () => {
	test("links parents to children and keeps the full ancestor chain", () => {
		const pullRequests = new Map(
			[1, 2, 3].map((number) => [`owner/repo#${number}`, makePullRequest(number)]),
		);
		const entries = buildEntries(pullRequests, stacksFrom(chain)) as {
			id: string;
			parent: string | null;
			children: string[];
			ancestors: string[];
		}[];
		const byId = new Map(entries.map((entry) => [entry.id, entry]));

		expect(byId.get("owner/repo#1")?.children).toEqual(["owner/repo#2"]);
		expect(byId.get("owner/repo#2")?.parent).toBe("owner/repo#1");
		expect(byId.get("owner/repo#3")?.ancestors).toEqual(["owner/repo#1", "owner/repo#2"]);
	});

	test("falls back to a root when git resolved no ancestry", () => {
		const pullRequests = new Map([["owner/repo#1", makePullRequest(1)]]);
		const entries = buildEntries(pullRequests, new Map()) as {
			parent: string | null;
			ancestors: string[];
		}[];

		expect(entries[0]?.parent).toBeNull();
		expect(entries[0]?.ancestors).toEqual([]);
	});
});

describe("buildEntries status fields", () => {
	test("reports conflict and size separately from checks", () => {
		const pullRequests = new Map([
			[
				"owner/repo#1",
				makePullRequest(1, {
					mergeable: "CONFLICTING",
					additions: 10,
					deletions: 4,
					changedFiles: 3,
					statusCheckRollup: [{ name: "e2e", conclusion: "SUCCESS" }],
				}),
			],
		]);
		const entries = buildEntries(pullRequests, new Map()) as {
			conflict: boolean;
			ci: { state: string };
			size: { additions: number; deletions: number; changed_files: number };
		}[];

		expect(entries[0]?.conflict).toBe(true);
		expect(entries[0]?.ci.state).toBe("passing");
		expect(entries[0]?.size).toEqual({ additions: 10, deletions: 4, changed_files: 3 });
	});
});

describe("hasConflict", () => {
	test("ignores the stale merge state left on closed and merged pull requests", () => {
		const dirty = { mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" } as const;

		expect(hasConflict(makePullRequest(1, dirty))).toBe(true);
		expect(hasConflict(makePullRequest(1, { ...dirty, state: "MERGED" }))).toBe(false);
		expect(hasConflict(makePullRequest(1, { ...dirty, state: "CLOSED" }))).toBe(false);
	});
});

describe("summarizeChecks", () => {
	test("splits failing, pending, and passing checks and deduplicates names", () => {
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
			passing: 3,
		});
	});

	test("reports pending when nothing failed, and none without a rollup", () => {
		const pending = [{ name: "e2e", conclusion: "QUEUED" }];

		expect(summarizeChecks(makePullRequest(1, { statusCheckRollup: pending })).state).toBe(
			"pending",
		);
		expect(summarizeChecks(makePullRequest(1, { statusCheckRollup: null })).state).toBe("none");
	});
});

describe("normalizeRemote", () => {
	test("strips every supported remote prefix and the git suffix", () => {
		expect(normalizeRemote("https://github.com/owner/repo.git")).toBe("owner/repo");
		expect(normalizeRemote("git@github.com:owner/repo.git")).toBe("owner/repo");
		expect(normalizeRemote("ssh://git@github.com/owner/repo")).toBe("owner/repo");
	});
});

describe("sortIds", () => {
	test("orders by pull request number rather than lexically", () => {
		expect(sortIds(["owner/repo#9", "owner/repo#12060", "owner/repo#120"])).toEqual([
			"owner/repo#12060",
			"owner/repo#120",
			"owner/repo#9",
		]);
	});
});

describe("matchPullRequest", () => {
	test("matches a worktree branch to the head, preferring the head repository", () => {
		const pullRequests = new Map([
			["owner/repo#1", makePullRequest(1, { headRefName: "shared" })],
			[
				"other/repo#2",
				makePullRequest(2, {
					repo: "other/repo",
					headRefName: "shared",
					headRepositoryOwner: { login: "fork" },
					headRepository: { name: "repo" },
				}),
			],
		]);

		expect(matchPullRequest({ repo: "fork/repo", branch: "shared" }, pullRequests)).toBe(
			"other/repo#2",
		);
		expect(matchPullRequest({ repo: "owner/repo", branch: "shared" }, pullRequests)).toBe(
			"owner/repo#1",
		);
		expect(matchPullRequest({ repo: "owner/repo", branch: "absent" }, pullRequests)).toBeNull();
	});
});
