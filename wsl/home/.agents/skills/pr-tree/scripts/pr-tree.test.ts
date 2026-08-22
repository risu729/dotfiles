/* oxlint-disable eslint/sort-keys vitest/prefer-importing-vitest-globals */

import { describe, expect, test } from "bun:test";

import { matchPullRequest } from "./agents.ts";
import { normalizeChecks, summarizeChecks } from "./checks.ts";
import { buildEntries } from "./pr-tree.ts";
import { parseRelations, parseWorkOrder } from "./relations.ts";
import type { PullRequest } from "./relations.ts";

const makePullRequest = (number: number, overrides: Partial<PullRequest> = {}): PullRequest => ({
	repo: "owner/repo",
	number,
	title: `PR ${number}`,
	url: `https://github.com/owner/repo/pull/${number}`,
	state: "OPEN",
	baseRefName: "main",
	headRefName: `branch-${number}`,
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
	body: "",
	updatedAt: "2026-07-18T00:00:00Z",
	...overrides,
});

const workOrderBody = `Replaces the auto-closed #1103.

## Work order

1. #1254 — contain remote paths (independent)
2. #1202 — require trust before discovery
3. This PR — guard metadata side effects
4. #1257 — resolve trusted metadata

## Split boundaries

- snapshot mechanics are in merged #1000

Follow-up to #1111.
`;

describe("parseWorkOrder", () => {
	test("reads ordered items, the independent marker, and this PR's position", () => {
		expect(parseWorkOrder(makePullRequest(1256, { body: workOrderBody }))).toEqual({
			position: 2,
			items: [
				{ ref: "owner/repo#1254", independent: true, this_pr: false },
				{ ref: "owner/repo#1202", independent: false, this_pr: false },
				{ ref: null, independent: false, this_pr: true },
				{ ref: "owner/repo#1257", independent: false, this_pr: false },
			],
		});
	});

	test("returns null when the body has no work order or no self reference", () => {
		expect(parseWorkOrder(makePullRequest(4, { body: "Depends on #2" }))).toBeNull();
		expect(
			parseWorkOrder(
				makePullRequest(4, { body: "## Work order\n\n1. #2 — first\n2. #3 — second" }),
			),
		).toBeNull();
	});
});

describe("parseRelations", () => {
	test("derives the parent from the nearest non-independent predecessor", () => {
		const relations = parseRelations(makePullRequest(1256, { body: workOrderBody }));

		expect(relations.dependencies).toEqual(["owner/repo#1202"]);
		expect(relations.source).toBe("work_order");
		expect(relations.replaces).toEqual(["owner/repo#1103"]);
		expect(relations.related.toSorted()).toEqual(["owner/repo#1000", "owner/repo#1111"]);
	});

	test("skips independent predecessors and reports no dependency when none remain", () => {
		const body =
			"## Work order\n\n1. #1254 — contain paths (independent)\n2. This PR — require trust";
		const relations = parseRelations(makePullRequest(1202, { body }));

		expect(relations.dependencies).toEqual([]);
		expect(relations.source).toBe("none");
	});

	test("falls back to keyword references, including 'builds on'", () => {
		expect(
			parseRelations(makePullRequest(4, { body: "Builds on source PR #3." })).dependencies,
		).toEqual(["owner/repo#3"]);
		expect(parseRelations(makePullRequest(4, { body: "Depends on #2." })).source).toBe("keyword");
		expect(parseRelations(makePullRequest(4, { body: "Mentions #2" })).dependencies).toEqual([]);
	});

	test("finds local, cross-repository, and URL references", () => {
		const pullRequest = makePullRequest(4, {
			body: `Unrelated #1
Depends on #2 and owner/other#3.
Stacked on https://github.com/another/project/pull/5`,
		});

		expect(parseRelations(pullRequest).dependencies.toSorted()).toEqual([
			"another/project#5",
			"owner/other#3",
			"owner/repo#2",
		]);
	});

	test("keeps a replaced pull request out of dependencies and related", () => {
		const relations = parseRelations(makePullRequest(4, { body: "Replaces #2.\nDepends on #2." }));

		expect(relations.replaces).toEqual(["owner/repo#2"]);
		expect(relations.dependencies).toEqual([]);
		expect(relations.related).toEqual([]);
	});
});

describe("buildEntries", () => {
	test("links dependencies and dependents", () => {
		const pullRequests = new Map([
			["owner/repo#1", makePullRequest(1)],
			["owner/repo#2", makePullRequest(2, { body: "Depends on #1" })],
		]);
		const entries = buildEntries(pullRequests) as {
			id: string;
			dependents: string[];
			open_dependencies: string[];
		}[];
		const byId = new Map(entries.map((entry) => [entry.id, entry]));

		expect(byId.get("owner/repo#1")?.dependents).toEqual(["owner/repo#2"]);
		expect(byId.get("owner/repo#2")?.open_dependencies).toEqual(["owner/repo#1"]);
	});

	test("preserves dependencies outside the current view", () => {
		const id = "owner/repo#4";
		const pullRequests = new Map([[id, makePullRequest(4, { body: "Depends on #2" })]]);
		const entries = buildEntries(pullRequests) as { dependencies_outside_view: string[] }[];

		expect(entries[0]?.dependencies_outside_view).toEqual(["owner/repo#2"]);
	});
});

describe("buildEntries context nodes", () => {
	test("does not parse relations for pull requests outside the requested scope", () => {
		const pullRequests = new Map([
			["owner/repo#1", makePullRequest(1, { body: "Depends on #9", state: "MERGED" })],
			["owner/repo#2", makePullRequest(2, { body: "Builds on #1" })],
		]);
		const entries = buildEntries(pullRequests, new Set(["owner/repo#2"])) as {
			id: string;
			in_scope: boolean;
			dependencies: string[];
			dependents: string[];
		}[];
		const byId = new Map(entries.map((entry) => [entry.id, entry]));

		expect(byId.get("owner/repo#1")?.in_scope).toBe(false);
		expect(byId.get("owner/repo#1")?.dependencies).toEqual([]);
		expect(byId.get("owner/repo#1")?.dependents).toEqual(["owner/repo#2"]);
	});

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
		const entries = buildEntries(pullRequests) as {
			conflict: boolean;
			ci: { state: string };
			size: { additions: number; deletions: number; changed_files: number };
		}[];

		expect(entries[0]?.conflict).toBe(true);
		expect(entries[0]?.ci.state).toBe("passing");
		expect(entries[0]?.size).toEqual({ additions: 10, deletions: 4, changed_files: 3 });
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
