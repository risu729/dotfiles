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

	test("ignores unrelated references and deduplicates equivalent dependencies", () => {
		expect(dependencyRefs(makePullRequest(4, { body: "Mentions #2" }))).toEqual([]);
		expect(
			dependencyRefs(
				makePullRequest(4, {
					body: "Depends on #2, owner/repo#2, and https://github.com/owner/repo/pull/2",
				}),
			),
		).toEqual(["owner/repo#2"]);
	});
});

describe("buildEntries", () => {
	test("preserves dependencies outside the current view", () => {
		const id = "owner/repo#4";
		const pullRequests = new Map([[id, makePullRequest(4, { body: "Depends on #2" })]]);
		const entries = buildEntries(pullRequests) as {
			dependencies_outside_view: string[];
		}[];

		expect(entries[0]?.dependencies_outside_view).toEqual(["owner/repo#2"]);
	});

	test("links open dependencies and dependents", () => {
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
});
