/* oxlint-disable import/no-named-export */

import { run } from "./exec.ts";
import type { PullRequest } from "./github.ts";

type Head = { id: string; sha: string };
type Stack = { ancestors: string[]; parent: string | null };
type Ancestry = { ancestors: Map<string, Set<string>>; found: number };

// How far back to walk from each head while looking for other pull request heads.
const ANCESTRY_DEPTH = 2000;

const headsIn = (sha: string, cwd: string): string[] =>
	run(["git", "-C", cwd, "rev-list", `--max-count=${ANCESTRY_DEPTH}`, sha], false).split("\n");

// Walks each head once and records which other heads it contains.
const ancestorSets = (heads: Head[], cwd: string): Ancestry => {
	const idBySha = new Map(heads.map(({ id, sha }) => [sha, id]));
	const ancestors = new Map<string, Set<string>>();
	let found = 0;
	for (const { id, sha } of heads) {
		const revisions = headsIn(sha, cwd).filter(Boolean);
		found += revisions.length > 0 ? 1 : 0;
		const contained = revisions.flatMap((revision) => {
			const other = idBySha.get(revision);
			return other !== undefined && other !== id ? [other] : [];
		});
		ancestors.set(id, new Set(contained));
	}
	return { ancestors, found };
};

// The nearest ancestor is the one carrying every other ancestor beneath it.
const nearestParent = (id: string, ancestors: Map<string, Set<string>>): string | null => {
	let parent: string | null = null;
	let depth = -1;
	for (const candidate of [...(ancestors.get(id) ?? [])].toSorted()) {
		const candidateDepth = ancestors.get(candidate)?.size ?? 0;
		if (candidateDepth > depth) {
			parent = candidate;
			depth = candidateDepth;
		}
	}
	return parent;
};

const buildStacks = (ancestors: Map<string, Set<string>>): Map<string, Stack> =>
	new Map(
		[...ancestors.keys()].map((id) => [
			id,
			{
				ancestors: [...(ancestors.get(id) ?? [])].toSorted(),
				parent: nearestParent(id, ancestors),
			},
		]),
	);

const resolveStacks = (
	pullRequests: Map<string, PullRequest>,
	cwd: string,
): { stacks: Map<string, Stack>; found: number; total: number } => {
	const heads = [...pullRequests].flatMap(([id, pullRequest]) =>
		pullRequest.headRefOid ? [{ id, sha: pullRequest.headRefOid }] : [],
	);
	const { ancestors, found } = ancestorSets(heads, cwd);
	return { found, stacks: buildStacks(ancestors), total: heads.length };
};

export { ANCESTRY_DEPTH, ancestorSets, buildStacks, nearestParent, resolveStacks };
export type { Ancestry, Head, Stack };
