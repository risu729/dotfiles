/* oxlint-disable import/no-named-export */

type RawCheck = {
	name?: string;
	workflowName?: string;
	context?: string;
	conclusion?: string;
	state?: string;
	status?: string;
};

type RawReview = {
	author?: { login?: string };
	state?: string;
	submittedAt?: string;
};

type PullRequest = {
	repo: string;
	number: number;
	title: string;
	url: string;
	state: string;
	baseRefName: string;
	headRefName: string;
	headRepository?: { name?: string } | null;
	headRepositoryOwner?: { login?: string } | null;
	isDraft: boolean;
	mergeable?: string;
	mergeStateStatus?: string;
	statusCheckRollup?: RawCheck[] | null;
	latestReviews?: RawReview[] | null;
	additions?: number;
	deletions?: number;
	changedFiles?: number;
	body: string;
	updatedAt: string;
};

type WorkOrderItem = { ref: string | null; independent: boolean; this_pr: boolean };
type WorkOrder = { position: number; items: WorkOrderItem[] };
type Relations = {
	dependencies: string[];
	related: string[];
	replaces: string[];
	work_order: WorkOrder | null;
	source: "work_order" | "keyword" | "none";
};

const dependencyPattern =
	/(?<kind>depends?\s+on|requires?|stacked\s+on|based\s+on|builds?\s+on|built\s+on|blocked\s+on|on\s+top\s+of|prerequisite)/iu;
const relatedPattern = /(?<kind>follow-?\s?up\s+to|related\s+to|see\s+also|continues)/iu;
const replacesPattern = /(?<kind>replaces?|supersedes?)/iu;
const workOrderHeading = /^#{1,6}\s+work\s+order\b/iu;
const splitBoundariesHeading = /^#{1,6}\s+split\s+boundaries\b/iu;
const anyHeading = /^#{1,6}\s+/u;
const orderedItem = /^\s*\d+[.)]\s+(?<content>.+)$/u;
const thisPullRequest = /\bthis\s+(?:pr|pull\s+request)\b/iu;
const independentMarker = /\bindependent\b/iu;

const urlPattern =
	/https:\/\/github\.com\/(?<owner>[^/\s]+)\/(?<repo>[^/\s]+)\/pull\/(?<number>\d+)/giu;
const ownerRepoPattern = /(?<repo>[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(?<number>\d+)/gu;
const localRefPattern = /(?<![A-Za-z0-9_/.-])#(?<number>\d+)/gu;

const prId = (repo: string, number: number | string): string => `${repo}#${number}`;

const selfId = (pullRequest: PullRequest): string => prId(pullRequest.repo, pullRequest.number);

const headRepoOf = (pullRequest: PullRequest): string | null => {
	const owner = pullRequest.headRepositoryOwner?.login;
	const name = pullRequest.headRepository?.name;
	return owner && name ? `${owner}/${name}` : null;
};

// Each collector handles one of the three reference forms GitHub renders in a body.
const urlRefs = (segment: string): string[] =>
	[...segment.matchAll(urlPattern)].flatMap((match) => {
		const { owner, repo, number } = match.groups ?? {};
		return owner && repo && number ? [prId(`${owner}/${repo}`, number)] : [];
	});

const qualifiedRefs = (segment: string): string[] =>
	[...segment.matchAll(ownerRepoPattern)].flatMap((match) => {
		const { repo, number } = match.groups ?? {};
		return repo && number ? [prId(repo, number)] : [];
	});

const localRefs = (segment: string, repo: string): string[] =>
	[...segment.matchAll(localRefPattern)].flatMap((match) => {
		const number = match.groups?.["number"];
		return number ? [prId(repo, number)] : [];
	});

const refsIn = (segment: string, repo: string): string[] => [
	...urlRefs(segment),
	...qualifiedRefs(segment),
	...localRefs(segment.replace(urlPattern, "").replace(ownerRepoPattern, ""), repo),
];

const keywordRefs = (pullRequest: PullRequest, pattern: RegExp): string[] => {
	const references: string[] = [];
	for (const line of pullRequest.body.split("\n")) {
		const match = pattern.exec(line);
		if (match?.index === undefined) {
			continue;
		}
		references.push(...refsIn(line.slice(match.index), pullRequest.repo));
	}
	return [...new Set(references)].filter((reference) => reference !== selfId(pullRequest));
};

const sectionLines = (body: string, heading: RegExp): string[] => {
	const lines = body.split("\n");
	const start = lines.findIndex((line) => heading.test(line));
	if (start === -1) {
		return [];
	}
	const collected: string[] = [];
	for (const line of lines.slice(start + 1)) {
		if (anyHeading.test(line)) {
			break;
		}
		collected.push(line);
	}
	return collected;
};

// Reads the ordered list under a `## Work order` heading. Returns null unless the
// List marks one entry as "This PR", since without it the PR has no position.
const parseWorkOrder = (pullRequest: PullRequest): WorkOrder | null => {
	const items: WorkOrderItem[] = [];
	for (const line of sectionLines(pullRequest.body, workOrderHeading)) {
		const content = orderedItem.exec(line)?.groups?.["content"];
		if (content === undefined) {
			continue;
		}
		const [ref] = refsIn(content, pullRequest.repo);
		items.push({
			independent: independentMarker.test(content),
			ref: ref ?? null,
			this_pr: ref === undefined && thisPullRequest.test(content),
		});
	}
	const position = items.findIndex((item) => item.this_pr);
	return position === -1 ? null : { items, position };
};

const workOrderParent = (workOrder: WorkOrder | null): string | null => {
	for (let index = (workOrder?.position ?? 0) - 1; index >= 0; index -= 1) {
		const item = workOrder?.items[index];
		if (item?.ref && !item.independent) {
			return item.ref;
		}
	}
	return null;
};

const emptyRelations = (): Relations => ({
	dependencies: [],
	related: [],
	replaces: [],
	source: "none",
	work_order: null,
});

const resolveDependencies = (
	pullRequest: PullRequest,
	workOrder: WorkOrder | null,
	replaces: string[],
): Pick<Relations, "dependencies" | "source"> => {
	const parent = workOrderParent(workOrder);
	if (parent) {
		return { dependencies: [parent], source: "work_order" };
	}
	const keyword = keywordRefs(pullRequest, dependencyPattern).filter(
		(reference) => !replaces.includes(reference),
	);
	return keyword.length > 0
		? { dependencies: keyword, source: "keyword" }
		: { dependencies: [], source: "none" };
};

const parseRelations = (pullRequest: PullRequest): Relations => {
	const workOrder = parseWorkOrder(pullRequest);
	const replaces = keywordRefs(pullRequest, replacesPattern);
	const { dependencies, source } = resolveDependencies(pullRequest, workOrder, replaces);
	const related = new Set([
		...keywordRefs(pullRequest, relatedPattern),
		...refsIn(sectionLines(pullRequest.body, splitBoundariesHeading).join("\n"), pullRequest.repo),
	]);
	for (const reference of [...replaces, ...dependencies, selfId(pullRequest)]) {
		related.delete(reference);
	}
	return { dependencies, related: [...related], replaces, source, work_order: workOrder };
};

export { emptyRelations, headRepoOf, parseRelations, parseWorkOrder, prId, refsIn };
export type { PullRequest, RawCheck, RawReview, Relations, WorkOrder, WorkOrderItem };
