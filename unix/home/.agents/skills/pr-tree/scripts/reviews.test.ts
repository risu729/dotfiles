/* oxlint-disable eslint/sort-keys vitest/prefer-importing-vitest-globals */

import { describe, expect, test } from "bun:test";

import type { PullRequest } from "./data.ts";
import { botReview, REVIEW_BOTS, verdictFor } from "./reviews.ts";
import type { ReviewGraph } from "./reviews.ts";

const BOT = { check: "CodeRabbit", login: "coderabbitai" };

const makePullRequest = (rollup: Record<string, string | undefined>[]): PullRequest =>
	({ number: 1, repo: "owner/repo", state: "OPEN", statusCheckRollup: rollup }) as PullRequest;

const makeGraph = (overrides: Partial<ReviewGraph> = {}): ReviewGraph =>
	({
		comments: { nodes: [] },
		reviews: { nodes: [] },
		reviewThreads: { nodes: [] },
		...overrides,
	}) as ReviewGraph;

const comment = (login: string, createdAt: string) => ({ author: { login }, createdAt });
const thread = (login: string, isResolved: boolean) => ({
	isResolved,
	comments: { nodes: [{ author: { login } }] },
});

describe("verdictFor", () => {
	test("separates never-ran from ran-and-clean", () => {
		expect(verdictFor(null, false, 0)).toBe("not_run");
		expect(verdictFor("SUCCESS", true, 0)).toBe("clean");
	});

	test("reports findings only when a thread is still unresolved", () => {
		expect(verdictFor("SUCCESS", true, 2)).toBe("findings");
		expect(verdictFor("SUCCESS", true, 0)).toBe("clean");
	});

	test("reports running while the head check is still in flight", () => {
		expect(verdictFor("IN_PROGRESS", true, 0)).toBe("running");
		expect(verdictFor("QUEUED", false, 0)).toBe("running");
	});

	// Past activity with no check on the current head means the latest push is unreviewed.
	test("reports stale when the bot spoke but has no check on this head", () => {
		expect(verdictFor(null, true, 0)).toBe("stale");
	});
});

describe("botReview", () => {
	// A bot that finds nothing posts only a summary comment, never a formal review object.
	test("counts a summary-only pass as clean rather than as no review", () => {
		const graph = makeGraph({
			comments: { nodes: [comment("coderabbitai", "2026-08-20T10:00:00Z")] },
		});
		const result = botReview(
			makePullRequest([{ name: "CodeRabbit", conclusion: "SUCCESS" }]),
			graph,
			BOT,
		);

		expect(result.verdict).toBe("clean");
		expect(result.summaries).toBe(1);
		expect(result.reviews).toBe(0);
		expect(result.last_activity).toBe("2026-08-20T10:00:00Z");
	});

	test("counts only this bot's threads and ignores the other bot's", () => {
		const graph = makeGraph({
			reviewThreads: {
				nodes: [
					thread("coderabbitai", false),
					thread("coderabbitai", true),
					thread("greptile-apps", false),
				],
			},
		});
		const result = botReview(
			makePullRequest([{ name: "CodeRabbit", conclusion: "SUCCESS" }]),
			graph,
			BOT,
		);

		expect(result.threads).toBe(2);
		expect(result.unresolved).toBe(1);
		expect(result.verdict).toBe("findings");
	});
});

describe("botReview absence", () => {
	test("reports not_run when the bot has neither a check nor any activity", () => {
		const result = botReview(makePullRequest([]), makeGraph(), BOT);

		expect(result).toMatchObject({ check: null, summaries: 0, unresolved: 0, verdict: "not_run" });
	});

	test("keeps the latest review state and tolerates a missing graph", () => {
		const graph = makeGraph({
			reviews: {
				nodes: [
					{
						author: { login: "coderabbitai" },
						state: "COMMENTED",
						submittedAt: "2026-08-21T00:00:00Z",
					},
					{
						author: { login: "coderabbitai" },
						state: "APPROVED",
						submittedAt: "2026-08-22T00:00:00Z",
					},
				],
			},
		});
		const result = botReview(
			makePullRequest([{ name: "CodeRabbit", conclusion: "SUCCESS" }]),
			graph,
			BOT,
		);

		expect(result.last_review_state).toBe("APPROVED");
		expect(result.last_activity).toBe("2026-08-22T00:00:00Z");
		expect(botReview(makePullRequest([]), null, BOT).verdict).toBe("not_run");
	});
});

describe("REVIEW_BOTS", () => {
	test("pairs each bot login with the check run that scopes it to the current head", () => {
		expect(REVIEW_BOTS).toEqual([
			{ check: "CodeRabbit", login: "coderabbitai" },
			{ check: "Greptile Review", login: "greptile-apps" },
		]);
	});
});
