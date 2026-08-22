/* oxlint-disable import/no-named-export */

import { runJson, runJsonAsync } from "./exec.ts";

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
	headRefOid: string;
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
	updatedAt: string;
};

type Target = { number: number; repo: string };
type Check = { name: string; status: string };
type CheckSummary = { state: string; failing: string[]; pending: string[]; passing: number };

const PR_FIELDS = [
	"number",
	"title",
	"url",
	"state",
	"baseRefName",
	"headRefName",
	"headRefOid",
	"headRepository",
	"headRepositoryOwner",
	"isDraft",
	"mergeable",
	"mergeStateStatus",
	"statusCheckRollup",
	"latestReviews",
	"additions",
	"deletions",
	"changedFiles",
	"updatedAt",
].join(",");

const FETCH_CONCURRENCY = 8;

const failureConclusions = new Set([
	"FAILURE",
	"TIMED_OUT",
	"CANCELLED",
	"STARTUP_FAILURE",
	"ACTION_REQUIRED",
	"STALE",
	"ERROR",
]);
const pendingConclusions = new Set(["PENDING", "QUEUED", "IN_PROGRESS", "WAITING", "REQUESTED"]);

const prId = (repo: string, number: number | string): string => `${repo}#${number}`;

const headRepoOf = (pullRequest: PullRequest): string | null => {
	const owner = pullRequest.headRepositoryOwner?.login;
	const name = pullRequest.headRepository?.name;
	return owner && name ? `${owner}/${name}` : null;
};

const targetsFor = (repos: string[]): Target[] => {
	if (repos.length === 0) {
		return runJson<{ number: number; repository?: { nameWithOwner: string } }[]>([
			"gh",
			"search",
			"prs",
			"--author",
			"@me",
			"--state",
			"open",
			"--limit",
			"200",
			"--json",
			"number,repository",
		]).flatMap(({ number, repository }) =>
			repository ? [{ number, repo: repository.nameWithOwner }] : [],
		);
	}
	return repos.flatMap((repo) =>
		runJson<{ number: number }[]>([
			"gh",
			"pr",
			"list",
			"--repo",
			repo,
			"--author",
			"@me",
			"--state",
			"open",
			"--limit",
			"200",
			"--json",
			"number",
		]).map(({ number }) => ({ number, repo })),
	);
};

const fetchPullRequest = async ({ number, repo }: Target): Promise<PullRequest> => ({
	...(await runJsonAsync<Omit<PullRequest, "repo">>([
		"gh",
		"pr",
		"view",
		String(number),
		"--repo",
		repo,
		"--json",
		PR_FIELDS,
	])),
	repo,
});

const normalizeChecks = (pullRequest: PullRequest): Check[] => {
	const checks = new Map<string, Check>();
	for (const check of pullRequest.statusCheckRollup ?? []) {
		const name = check.name || check.workflowName || check.context || "check";
		const status = check.conclusion || check.state || check.status || "UNKNOWN";
		checks.set(`${name}\0${status}`, { name, status });
	}
	return [...checks.values()];
};

const rollupState = (failing: number, pending: number, passing: number): string => {
	if (failing > 0) {
		return "failing";
	}
	if (pending > 0) {
		return "pending";
	}
	return passing > 0 ? "passing" : "none";
};

const summarizeChecks = (checks: Check[]): CheckSummary => {
	const upper = checks.map(({ name, status }) => ({ name, status: status.toUpperCase() }));
	const failing = upper
		.filter(({ status }) => failureConclusions.has(status))
		.map(({ name }) => name);
	const pending = upper
		.filter(({ status }) => pendingConclusions.has(status))
		.map(({ name }) => name);
	const passing = upper.length - failing.length - pending.length;
	return { failing, passing, pending, state: rollupState(failing.length, pending.length, passing) };
};

// Conflicts only mean something while a PR is open; GitHub leaves the merge state stale once it closes.
const hasConflict = (pullRequest: PullRequest): boolean =>
	pullRequest.state === "OPEN" &&
	(pullRequest.mergeable === "CONFLICTING" || pullRequest.mergeStateStatus === "DIRTY");

export {
	FETCH_CONCURRENCY,
	fetchPullRequest,
	hasConflict,
	headRepoOf,
	normalizeChecks,
	prId,
	summarizeChecks,
	targetsFor,
};
export type { Check, CheckSummary, PullRequest, RawCheck, RawReview, Target };
