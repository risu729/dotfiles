#!/usr/bin/env bun

/* oxlint-disable eslint/max-statements import/no-named-export */

import { collectAgents } from "./agents.ts";
import { hasConflict, normalizeChecks, summarizeChecks } from "./checks.ts";
import { mapPool, normalizeRemote, run } from "./exec.ts";
import { FETCH_CONCURRENCY, fetchPullRequest, targetsFor } from "./github.ts";
import { emptyRelations, headRepoOf, parseRelations, prId } from "./relations.ts";
import type { PullRequest, Relations } from "./relations.ts";

type Filters = {
	repos: string[];
	currentRepo: boolean;
	agents: boolean;
	help: boolean;
};

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

type EntryContext = {
	id: string;
	pullRequest: PullRequest;
	relation: Relations;
	dependents: Set<string>;
	inScope: boolean;
	pullRequests: Map<string, PullRequest>;
};

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

const entryFor = (context: EntryContext): Record<string, unknown> => {
	const { id, pullRequest, relation, pullRequests } = context;
	const checks = normalizeChecks(pullRequest);
	return {
		base_ref: pullRequest.baseRefName,
		checks,
		ci: summarizeChecks(checks),
		conflict: hasConflict(pullRequest),
		dependencies: relation.dependencies,
		dependencies_outside_view: relation.dependencies.filter(
			(dependency) => !pullRequests.has(dependency),
		),
		dependency_source: relation.source,
		dependents: sortIds(context.dependents, pullRequests),
		draft: pullRequest.isDraft,
		head_ref: pullRequest.headRefName,
		head_repo: headRepoOf(pullRequest),
		id,
		in_scope: context.inScope,
		latest_reviews: reviewsOf(pullRequest),
		merge_state: pullRequest.mergeStateStatus || "UNKNOWN",
		mergeable: pullRequest.mergeable || "UNKNOWN",
		number: pullRequest.number,
		open_dependencies: sortIds(
			relation.dependencies.filter((dependency) => pullRequests.has(dependency)),
			pullRequests,
		),
		related: relation.related,
		replaces: relation.replaces,
		repo: pullRequest.repo,
		size: sizeOf(pullRequest),
		state: pullRequest.state || "UNKNOWN",
		title: pullRequest.title,
		updated_at: pullRequest.updatedAt,
		url: pullRequest.url,
		work_order: relation.work_order,
	};
};

// Pull requests outside the requested scope are context only: their own bodies are
// Not parsed, so a merged foundation never drags its whole history into the tree.
const buildEntries = (
	pullRequests: Map<string, PullRequest>,
	inScope: Set<string> = new Set(pullRequests.keys()),
): Record<string, unknown>[] => {
	const relations = new Map(
		[...pullRequests].map(([id, pullRequest]) => [
			id,
			inScope.has(id) ? parseRelations(pullRequest) : emptyRelations(),
		]),
	);
	const dependents = new Map<string, Set<string>>();
	for (const [id, relation] of relations) {
		for (const dependency of relation.dependencies) {
			if (pullRequests.has(dependency) && dependency !== id) {
				const children = dependents.get(dependency) ?? new Set<string>();
				children.add(id);
				dependents.set(dependency, children);
			}
		}
	}
	return sortIds(pullRequests.keys(), pullRequests).map((id) => {
		const pullRequest = pullRequests.get(id);
		const relation = relations.get(id);
		if (!pullRequest || !relation) {
			throw new Error(`missing pull request: ${id}`);
		}
		return entryFor({
			dependents: dependents.get(id) ?? new Set<string>(),
			id,
			inScope: inScope.has(id),
			pullRequest,
			pullRequests,
			relation,
		});
	});
};

const referencedIds = (pullRequests: Map<string, PullRequest>): string[] => {
	const referenced = new Set<string>();
	for (const pullRequest of pullRequests.values()) {
		const relation = parseRelations(pullRequest);
		for (const reference of [
			...relation.dependencies,
			...relation.related,
			...relation.replaces,
			...(relation.work_order?.items ?? []).flatMap((item) => (item.ref ? [item.ref] : [])),
		]) {
			if (!pullRequests.has(reference)) {
				referenced.add(reference);
			}
		}
	}
	return [...referenced];
};

const addPullRequests = async (
	pullRequests: Map<string, PullRequest>,
	targets: { number: number; repo: string }[],
	tolerant = false,
): Promise<void> => {
	const fetched = await mapPool(targets, FETCH_CONCURRENCY, async (target) => {
		if (!tolerant) {
			return await fetchPullRequest(target);
		}
		try {
			return await fetchPullRequest(target);
		} catch {
			return null;
		}
	});
	for (const pullRequest of fetched) {
		if (pullRequest) {
			pullRequests.set(prId(pullRequest.repo, pullRequest.number), pullRequest);
		}
	}
};

const main = async (): Promise<void> => {
	const filters = parseArgs(Bun.argv.slice(2));
	if (filters.help) {
		console.info("Usage: pr-tree.ts [--repo owner/name] [--current-repo] [--no-agents]");
		return;
	}
	if (filters.currentRepo) {
		const remote = run(["git", "remote", "get-url", "origin"], false);
		if (!remote) {
			throw new Error("could not infer the current repository");
		}
		filters.repos.push(normalizeRemote(remote));
	}

	const pullRequests = new Map<string, PullRequest>();
	await addPullRequests(pullRequests, targetsFor([...new Set(filters.repos)]));
	const inScope = new Set(pullRequests.keys());
	await addPullRequests(
		pullRequests,
		referencedIds(pullRequests).flatMap((id) => {
			const [repo, number] = id.split("#");
			return repo && number ? [{ number: Number(number), repo }] : [];
		}),
		true,
	);

	console.info(
		JSON.stringify(
			{
				agents: filters.agents ? collectAgents(pullRequests) : [],
				pull_requests: buildEntries(pullRequests, inScope),
			},
			null,
			2,
		),
	);
};

if (import.meta.main) {
	await main();
}

export { buildEntries, parseArgs, referencedIds };
