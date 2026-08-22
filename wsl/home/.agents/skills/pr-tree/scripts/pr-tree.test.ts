/* oxlint-disable eslint/sort-keys vitest/prefer-importing-vitest-globals */

import { describe, expect, test } from "bun:test";

import type { PullRequest } from "./data.ts";
import { buildEntries, reposFrom, sortIds } from "./pr-tree.ts";
import { nearestParent } from "./stacks.ts";

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

const ancestorsOf = (chain: Record<string, string[]>): Map<string, Set<string>> =>
	new Map(Object.entries(chain).map(([id, contained]) => [id, new Set(contained)]));

const stacksFrom = (ancestors: Map<string, Set<string>>) =>
	new Map(
		[...ancestors].map(([id, contained]) => [
			id,
			{
				ancestors: [...contained].toSorted(),
				parent: nearestParent(id, ancestors),
				resolved: true,
			},
		]),
	);

// A linear stack 1 <- 2 <- 3, where each head contains every head below it.
const chain = ancestorsOf({
	"owner/repo#1": [],
	"owner/repo#2": ["owner/repo#1"],
	"owner/repo#3": ["owner/repo#1", "owner/repo#2"],
});

describe("nearestParent", () => {
	test("picks the candidate containing every other candidate", () => {
		expect(nearestParent("owner/repo#3", chain)).toBe("owner/repo#2");
		expect(nearestParent("owner/repo#2", chain)).toBe("owner/repo#1");
	});

	// Numbers chosen so the true parent sorts first, killing a "last sorted candidate" heuristic.
	test("does not fall back to a positional pick when ids sort against depth", () => {
		const sorts = ancestorsOf({
			"owner/repo#9": [],
			"owner/repo#10": ["owner/repo#9"],
			"owner/repo#11": ["owner/repo#9", "owner/repo#10"],
		});

		expect(nearestParent("owner/repo#11", sorts)).toBe("owner/repo#10");
	});
});

describe("nearestParent edge shapes", () => {
	test("returns null for a root and for an unknown id", () => {
		expect(nearestParent("owner/repo#1", chain)).toBeNull();
		expect(nearestParent("owner/repo#9", chain)).toBeNull();
	});

	test("does not pick a sibling when two branches share one ancestor", () => {
		const fork = ancestorsOf({
			"owner/repo#1": [],
			"owner/repo#2": ["owner/repo#1"],
			"owner/repo#3": ["owner/repo#1"],
		});

		expect(nearestParent("owner/repo#2", fork)).toBe("owner/repo#1");
		expect(nearestParent("owner/repo#3", fork)).toBe("owner/repo#1");
	});

	// A merge, or a head git could not walk, leaves two candidates that contain neither the other.
	test("reports null rather than guessing when candidates are incomparable", () => {
		const merged = ancestorsOf({
			"owner/repo#20": [],
			"owner/repo#30": [],
			"owner/repo#40": ["owner/repo#20", "owner/repo#30"],
		});

		expect(nearestParent("owner/repo#40", merged)).toBeNull();
	});

	// Truncation can leave a nearer parent with the smaller ancestor set; containment still wins.
	test("prefers containment over ancestor count", () => {
		const truncated = ancestorsOf({
			"owner/repo#1": ["owner/repo#7", "owner/repo#8"],
			"owner/repo#2": ["owner/repo#1"],
			"owner/repo#3": ["owner/repo#1", "owner/repo#2"],
			"owner/repo#7": [],
			"owner/repo#8": [],
		});

		expect(nearestParent("owner/repo#3", truncated)).toBe("owner/repo#2");
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

	test("orders entries and children numerically, not lexically", () => {
		const fork = ancestorsOf({
			"owner/repo#1": [],
			"owner/repo#2": ["owner/repo#1"],
			"owner/repo#10": ["owner/repo#1"],
		});
		const pullRequests = new Map(
			[1, 2, 10].map((number) => [`owner/repo#${number}`, makePullRequest(number)]),
		);
		const entries = buildEntries(pullRequests, stacksFrom(fork)) as {
			id: string;
			children: string[];
		}[];

		expect(entries.map((entry) => entry.id)).toEqual([
			"owner/repo#10",
			"owner/repo#2",
			"owner/repo#1",
		]);
		expect(entries.at(-1)?.children).toEqual(["owner/repo#10", "owner/repo#2"]);
	});
});

describe("buildEntries fallbacks", () => {
	test("falls back to an unresolved root when git returned no ancestry", () => {
		const pullRequests = new Map([["owner/repo#1", makePullRequest(1)]]);
		const entries = buildEntries(pullRequests, new Map()) as {
			parent: string | null;
			ancestors: string[];
			head_resolved: boolean;
		}[];

		expect(entries[0]?.parent).toBeNull();
		expect(entries[0]?.ancestors).toEqual([]);
		expect(entries[0]?.head_resolved).toBe(false);
	});

	test("returns an empty list when there are no open pull requests", () => {
		expect(buildEntries(new Map(), new Map())).toEqual([]);
	});
});

describe("buildEntries field defaults", () => {
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

	// Absent counts must serialize as zero; undefined disappears from JSON.stringify entirely.
	test("defaults a missing size to zeros and a deleted review author to unknown", () => {
		const pullRequests = new Map([
			[
				"owner/repo#1",
				makePullRequest(1, { latestReviews: [{ author: null, state: "APPROVED" }] }),
			],
		]);
		const entries = buildEntries(pullRequests, new Map()) as {
			size: { additions: number; deletions: number; changed_files: number };
			reviews: { login: string; state: string }[];
		}[];

		expect(entries[0]?.size).toEqual({ additions: 0, deletions: 0, changed_files: 0 });
		expect(entries[0]?.reviews).toEqual([{ login: "unknown", state: "APPROVED" }]);
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

describe("reposFrom", () => {
	test("accepts both --repo forms and returns nothing when unscoped", () => {
		expect(reposFrom(["--repo", "owner/repo"])).toEqual(["owner/repo"]);
		expect(reposFrom(["--repo=owner/repo"])).toEqual(["owner/repo"]);
		expect(reposFrom(["--no-agents"])).toEqual([]);
	});

	// A silently dropped value would widen the query to every open PR the user has anywhere.
	test("refuses a --repo without a usable value instead of falling back to every repo", () => {
		expect(() => reposFrom(["--repo"])).toThrow("--repo requires owner/name");
		expect(() => reposFrom(["--repo", "--no-agents"])).toThrow("--repo requires owner/name");
		expect(() => reposFrom(["--repo=owner"])).toThrow("--repo requires owner/name");
	});
});
