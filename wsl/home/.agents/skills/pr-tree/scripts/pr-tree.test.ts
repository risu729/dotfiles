/* oxlint-disable eslint/sort-keys vitest/prefer-importing-vitest-globals */

import { describe, expect, test } from "bun:test";

import { matchPullRequest } from "./agents.ts";
import { hasConflict, normalizeChecks, summarizeChecks } from "./github.ts";
import type { PullRequest } from "./github.ts";
import { buildEntries } from "./pr-tree.ts";
import { buildStacks, nearestParent } from "./stacks.ts";

const makePullRequest = (number: number, overrides: Partial<PullRequest> = {}): PullRequest => ({
	repo: "owner/repo",
	number,
	title: `PR ${number}`,
	url: `https://github.com/owner/repo/pull/${number}`,
	state: "OPEN",
	baseRefName: "main",
	headRefName: `branch-${number}`,
	headRefOid: `sha-${number}`,
	headRepository: { name: "repo" },
	headRepositoryOwner: { login: "owner" },
	isDraft: false,
	mergeable: "MERGEABLE",
	mergeStateStatus: "CLEAN",
	statusCheckRollup: [],
	latestReviews: [],
	additions: 0,
	deletions: 0,
	changedFiles: 0,
	updatedAt: "2026-07-18T00:00:00Z",
	...overrides,
});

// A linear stack: 1 <- 2 <- 3, where each head contains every head below it.
const chain = new Map([
	["owner/repo#1", new Set<string>()],
	["owner/repo#2", new Set(["owner/repo#1"])],
	["owner/repo#3", new Set(["owner/repo#1", "owner/repo#2"])],
]);

describe("nearestParent", () => {
	test("picks the ancestor that carries every other ancestor", () => {
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

describe("buildStacks", () => {
	test("reports sorted ancestors alongside the nearest parent", () => {
		expect(buildStacks(chain).get("owner/repo#3")).toEqual({
			ancestors: ["owner/repo#1", "owner/repo#2"],
			parent: "owner/repo#2",
		});
	});
});

describe("buildEntries", () => {
	test("links parents to children", () => {
		const pullRequests = new Map([
			["owner/repo#1", makePullRequest(1)],
			["owner/repo#2", makePullRequest(2)],
			["owner/repo#3", makePullRequest(3)],
		]);
		const entries = buildEntries(pullRequests, buildStacks(chain)) as {
			id: string;
			parent: string | null;
			children: string[];
		}[];
		const byId = new Map(entries.map((entry) => [entry.id, entry]));

		expect(byId.get("owner/repo#1")?.children).toEqual(["owner/repo#2"]);
		expect(byId.get("owner/repo#2")?.parent).toBe("owner/repo#1");
		expect(byId.get("owner/repo#3")?.children).toEqual([]);
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
					mergeStateStatus: "DIRTY",
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
	test("splits failing, pending, and passing checks", () => {
		expect(
			summarizeChecks([
				{ name: "lint", status: "FAILURE" },
				{ name: "e2e", status: "IN_PROGRESS" },
				{ name: "unit", status: "SUCCESS" },
				{ name: "skipped", status: "SKIPPED" },
			]),
		).toEqual({ state: "failing", failing: ["lint"], pending: ["e2e"], passing: 2 });
	});

	test("reports pending only when nothing failed, and none without checks", () => {
		expect(summarizeChecks([{ name: "e2e", status: "QUEUED" }]).state).toBe("pending");
		expect(summarizeChecks([]).state).toBe("none");
	});
});

describe("normalizeChecks", () => {
	test("normalizes status fields, defaults unknown values, and deduplicates", () => {
		const pullRequest = makePullRequest(4, {
			statusCheckRollup: [
				{ name: "success", conclusion: "SUCCESS" },
				{ name: "failure", state: "FAILURE" },
				{ name: "pending", status: "PENDING" },
				{ name: "unknown" },
				{ name: "failure", state: "FAILURE" },
			],
		});

		expect(normalizeChecks(pullRequest)).toEqual([
			{ name: "success", status: "SUCCESS" },
			{ name: "failure", status: "FAILURE" },
			{ name: "pending", status: "PENDING" },
			{ name: "unknown", status: "UNKNOWN" },
		]);
	});

	test("tolerates a missing rollup", () => {
		expect(normalizeChecks(makePullRequest(4, { statusCheckRollup: null }))).toEqual([]);
	});
});

describe("matchPullRequest", () => {
	test("matches a worktree branch to the pull request head, preferring the head repository", () => {
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
