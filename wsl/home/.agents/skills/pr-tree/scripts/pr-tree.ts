#!/usr/bin/env bun

/* oxlint-disable eslint/max-statements import/no-named-export */

import { collectAgents } from "./agents.ts";
import { mapPool, normalizeRemote, run } from "./exec.ts";
import {
	FETCH_CONCURRENCY,
	fetchPullRequest,
	hasConflict,
	headRepoOf,
	normalizeChecks,
	prId,
	summarizeChecks,
	targetsFor,
} from "./github.ts";
import type { PullRequest } from "./github.ts";
import { resolveStacks } from "./stacks.ts";
import type { Stack } from "./stacks.ts";

type Filters = { repos: string[]; currentRepo: boolean; agents: boolean; help: boolean };

const parseArgs = (args: string[]): Filters => {
	const filters: Filters = { agents: true, currentRepo: false, help: false, repos: [] };
	for (let index = 0; index < args.length; index += 1) {
		const option = args[index];
		if (option === "--repo") {
			const repo = args[index + 1];
			if (!repo) {
				throw new Error("--repo requires owner/name");
			}
			filters.repos.push(repo);
			index += 1;
		} else if (option === "--current-repo") {
			filters.currentRepo = true;
		} else if (option === "--no-agents") {
			filters.agents = false;
		} else if (option === "--help" || option === "-h") {
			filters.help = true;
		} else {
			throw new Error(`unknown option: ${option}`);
		}
	}
	return filters;
};

const sortIds = (ids: Iterable<string>, pullRequests: Map<string, PullRequest>): string[] =>
	[...ids].sort((left, right) => {
		const leftPr = pullRequests.get(left);
		const rightPr = pullRequests.get(right);
		return (
			(leftPr?.repo ?? "").localeCompare(rightPr?.repo ?? "") ||
			(rightPr?.number ?? 0) - (leftPr?.number ?? 0)
		);
	});

const reviewsOf = (pullRequest: PullRequest): Record<string, unknown>[] =>
	(pullRequest.latestReviews ?? []).map((review) => ({
		login: review.author?.login ?? "unknown",
		state: review.state ?? "UNKNOWN",
		submitted_at: review.submittedAt ?? null,
	}));

const sizeOf = (pullRequest: PullRequest): Record<string, number> => ({
	additions: pullRequest.additions ?? 0,
	changed_files: pullRequest.changedFiles ?? 0,
	deletions: pullRequest.deletions ?? 0,
});

const entryFor = (
	id: string,
	pullRequest: PullRequest,
	stack: Stack & { children: string[] },
): Record<string, unknown> => {
	const checks = normalizeChecks(pullRequest);
	return {
		ancestors: stack.ancestors,
		base_ref: pullRequest.baseRefName,
		checks,
		children: stack.children,
		ci: summarizeChecks(checks),
		conflict: hasConflict(pullRequest),
		draft: pullRequest.isDraft,
		head_ref: pullRequest.headRefName,
		head_repo: headRepoOf(pullRequest),
		head_sha: pullRequest.headRefOid,
		id,
		latest_reviews: reviewsOf(pullRequest),
		merge_state: pullRequest.mergeStateStatus || "UNKNOWN",
		mergeable: pullRequest.mergeable || "UNKNOWN",
		number: pullRequest.number,
		parent: stack.parent,
		repo: pullRequest.repo,
		size: sizeOf(pullRequest),
		state: pullRequest.state || "UNKNOWN",
		title: pullRequest.title,
		updated_at: pullRequest.updatedAt,
		url: pullRequest.url,
	};
};

const buildEntries = (
	pullRequests: Map<string, PullRequest>,
	stacks: Map<string, Stack>,
): Record<string, unknown>[] => {
	const children = new Map<string, Set<string>>();
	for (const [id, stack] of stacks) {
		if (stack.parent) {
			children.set(stack.parent, (children.get(stack.parent) ?? new Set()).add(id));
		}
	}
	return sortIds(pullRequests.keys(), pullRequests).map((id) => {
		const pullRequest = pullRequests.get(id);
		if (!pullRequest) {
			throw new Error(`missing pull request: ${id}`);
		}
		const stack = stacks.get(id) ?? { ancestors: [], parent: null };
		return entryFor(id, pullRequest, {
			...stack,
			children: sortIds(children.get(id) ?? [], pullRequests),
		});
	});
};

const main = async (): Promise<void> => {
	const filters = parseArgs(Bun.argv.slice(2));
	if (filters.help) {
		console.info("Usage: pr-tree.ts [--repo owner/name] [--current-repo] [--no-agents]");
		return;
	}
	const cwd = process.cwd();
	if (filters.currentRepo) {
		const remote = run(["git", "remote", "get-url", "origin"], false);
		if (!remote) {
			throw new Error("could not infer the current repository");
		}
		filters.repos.push(normalizeRemote(remote));
	}

	const pullRequests = new Map<string, PullRequest>();
	const fetched = await mapPool(
		targetsFor([...new Set(filters.repos)]),
		FETCH_CONCURRENCY,
		fetchPullRequest,
	);
	for (const pullRequest of fetched) {
		pullRequests.set(prId(pullRequest.repo, pullRequest.number), pullRequest);
	}
	const { stacks, found, total } = resolveStacks(pullRequests, cwd);

	console.info(
		JSON.stringify(
			{
				agents: filters.agents ? collectAgents(pullRequests) : [],
				git: { cwd, heads_resolved: found, heads_total: total },
				pull_requests: buildEntries(pullRequests, stacks),
			},
			null,
			2,
		),
	);
};

if (import.meta.main) {
	await main();
}

export { buildEntries, parseArgs };
