/* oxlint-disable import/no-named-export */

import { run } from "./data.ts";
import type { PullRequest, Stack } from "./data.ts";

// How far back to walk from each head while looking for other pull request heads.
const ANCESTRY_DEPTH = 2000;

// The parent is the one candidate containing every other candidate; anything ambiguous gives null.
const nearestParent = (id: string, ancestors: Map<string, Set<string>>): string | null => {
	const candidates = [...(ancestors.get(id) ?? [])].toSorted();
	return (
		candidates.find((candidate) =>
			candidates.every(
				(other) => other === candidate || (ancestors.get(candidate)?.has(other) ?? false),
			),
		) ?? null
	);
};

// Walks each head once and records which other pull request heads it contains.
const resolveStacks = (
	pullRequests: Map<string, PullRequest>,
	cwd: string,
): { stacks: Map<string, Stack>; found: number; total: number } => {
	const idsBySha = new Map<string, string[]>();
	for (const [id, { headRefOid }] of pullRequests) {
		idsBySha.set(headRefOid, [...(idsBySha.get(headRefOid) ?? []), id]);
	}
	const walked = [...pullRequests].map(([id, { headRefOid }]) => {
		const revisions = run([
			"git",
			"-C",
			cwd,
			"rev-list",
			`--max-count=${ANCESTRY_DEPTH}`,
			headRefOid,
		])
			.split("\n")
			.filter((revision) => revision !== "");
		// A head shared by two pull requests is the same commit, never a stack edge between them.
		const contained = revisions.filter((revision) => revision !== headRefOid);
		return { contained, id, resolved: revisions.length > 0 };
	});
	const ancestors = new Map(
		walked.map(({ contained, id }) => [
			id,
			new Set(contained.flatMap((revision) => idsBySha.get(revision) ?? [])),
		]),
	);
	const stacks = new Map(
		walked.map(({ id, resolved }) => [
			id,
			{
				ancestors: [...(ancestors.get(id) ?? [])].toSorted(),
				parent: nearestParent(id, ancestors),
				resolved,
			},
		]),
	);
	return { found: walked.filter(({ resolved }) => resolved).length, stacks, total: walked.length };
};

export { nearestParent, resolveStacks };
