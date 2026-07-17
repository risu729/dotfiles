/* oxlint-disable eslint/sort-keys vitest/prefer-importing-vitest-globals */

import { describe, expect, test } from "bun:test";

import { buildEntries, dependencyRefs, normalizeChecks } from "./pr-tree.ts";
import type { PullRequest } from "./pr-tree.ts";

const makePullRequest = (number: number, overrides: Partial<PullRequest> = {}): PullRequest => ({
	repo: "owner/repo",
	number,
	title: `PR ${number}`,
	url: `https://github.com/owner/repo/pull/${number}`,
	baseRefName: "main",
	headRefName: `branch-${number}`,
	isDraft: false,
	mergeStateStatus: "CLEAN",
	statusCheckRollup: [],
	body: "",
	updatedAt: "2026-07-18T00:00:00Z",
	...overrides,
});

describe("dependencyRefs", () => {
	test("finds local, cross-repository, and URL dependencies", () => {
		const pullRequest = makePullRequest(4, {
			body: `Unrelated #1
Depends on #2 and owner/other#3.
Stacked on https://github.com/another/project/pull/5`,
		});

		expect(dependencyRefs(pullRequest)).toEqual([
			"owner/other#3",
			"owner/repo#2",
			"another/project#5",
		]);
	});
});

describe("buildEntries", () => {
	test("preserves dependencies outside the current view", () => {
		const id = "owner/repo#4";
		const pullRequests = new Map([[id, makePullRequest(4, { body: "Depends on #2" })]]);
		const entries = buildEntries(pullRequests, new Map()) as {
			dependencies_outside_view: string[];
		}[];

		expect(entries[0]?.dependencies_outside_view).toEqual(["owner/repo#2"]);
	});
});

describe("normalizeChecks", () => {
	test("normalizes and deduplicates check results", () => {
		const pullRequest = makePullRequest(4, {
			statusCheckRollup: [
				{ name: "test", conclusion: "FAILURE" },
				{ name: "test", conclusion: "FAILURE" },
			],
		});

		expect(normalizeChecks(pullRequest)).toEqual([{ name: "test", status: "FAILURE" }]);
	});
});
