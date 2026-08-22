#!/usr/bin/env bun

/* oxlint-disable import/no-named-export */

import {
	collectAgents,
	hasConflict,
	headRepoOf,
	listPullRequests,
	normalizeRemote,
	prId,
	run,
	summarizeChecks,
} from "./data.ts";
import type { PullRequest, Stack } from "./data.ts";
import { resolveStacks } from "./stacks.ts";

const USAGE = "Usage: pr-tree.ts [--repo owner/name] [--current-repo] [--no-agents]";

const sortIds = (ids: Iterable<string>): string[] =>
	[...ids].toSorted((left, right) => right.localeCompare(left, undefined, { numeric: true }));

const repoArg = (arg: string, previous: string | undefined): string[] => {
	if (arg.startsWith("--repo=")) {
		return [arg.slice("--repo=".length)];
	}
	return previous === "--repo" ? [arg] : [];
};

const reposFrom = (args: string[]): string[] => {
	const repos = args.flatMap((arg, index) => repoArg(arg, args[index - 1]));
	if (args.at(-1) === "--repo" || repos.some((repo) => !repo.includes("/"))) {
		throw new Error("--repo requires owner/name");
	}
	if (!args.includes("--current-repo")) {
		return repos;
	}
	const remote = run(["git", "remote", "get-url", "origin"]);
	if (!remote) {
		throw new Error("could not infer the current repository; run inside a git checkout");
	}
	return [...repos, normalizeRemote(remote)];
};

const entryFor = (
	id: string,
	pullRequest: PullRequest,
	stack: Stack & { children: string[] },
): Record<string, unknown> => ({
	ancestors: stack.ancestors,
	children: stack.children,
	ci: summarizeChecks(pullRequest),
	conflict: hasConflict(pullRequest),
	draft: pullRequest.isDraft,
	head_ref: pullRequest.headRefName,
	head_repo: headRepoOf(pullRequest),
	head_resolved: stack.resolved,
	head_sha: pullRequest.headRefOid,
	id,
	number: pullRequest.number,
	parent: stack.parent,
	reviews: (pullRequest.latestReviews ?? []).map((review) => ({
		login: review.author?.login ?? "unknown",
		state: review.state ?? "UNKNOWN",
	})),
	size: {
		additions: pullRequest.additions ?? 0,
		changed_files: pullRequest.changedFiles ?? 0,
		deletions: pullRequest.deletions ?? 0,
	},
	state: pullRequest.state,
	title: pullRequest.title,
	updated_at: pullRequest.updatedAt,
	url: pullRequest.url,
});

const buildEntries = (
	pullRequests: Map<string, PullRequest>,
	stacks: Map<string, Stack>,
): Record<string, unknown>[] => {
	const children = new Map<string, string[]>();
	for (const [id, { parent }] of stacks) {
		if (parent) {
			children.set(parent, [...(children.get(parent) ?? []), id]);
		}
	}
	return sortIds(pullRequests.keys()).flatMap((id) => {
		const pullRequest = pullRequests.get(id);
		const stack = stacks.get(id) ?? { ancestors: [], parent: null, resolved: false };
		return pullRequest
			? [entryFor(id, pullRequest, { ...stack, children: sortIds(children.get(id) ?? []) })]
			: [];
	});
};

const main = async (): Promise<void> => {
	const args = Bun.argv.slice(2);
	if (args.includes("--help") || args.includes("-h")) {
		console.info(USAGE);
		return;
	}
	const repos = reposFrom(args);
	const cwd = process.cwd();
	const { pullRequests: fetched, errors } = await listPullRequests([...new Set(repos)]);
	const pullRequests = new Map(
		fetched.map((pullRequest) => [prId(pullRequest.repo, pullRequest.number), pullRequest]),
	);
	const { stacks, found, total } = resolveStacks(pullRequests, cwd);

	console.info(
		JSON.stringify(
			{
				agents: args.includes("--no-agents") ? [] : collectAgents(pullRequests),
				errors,
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

export { buildEntries, reposFrom, sortIds };
