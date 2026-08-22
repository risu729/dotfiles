/* oxlint-disable import/no-named-export node/no-sync */

type PullRequest = {
	repo: string;
	number: number;
	title: string;
	url: string;
	state: string;
	headRefName: string;
	headRefOid: string;
	headRepository?: { name?: string } | null;
	headRepositoryOwner?: { login?: string } | null;
	isDraft: boolean;
	mergeable?: string;
	mergeStateStatus?: string;
	statusCheckRollup?: Record<string, string | undefined>[] | null;
	latestReviews?: { author?: { login?: string }; state?: string }[] | null;
	additions?: number;
	deletions?: number;
	changedFiles?: number;
	updatedAt: string;
};

type Stack = { ancestors: string[]; parent: string | null };
type Checkout = { repo: string | null; branch: string | null; dirty: number | null };

const PR_FIELDS =
	"number,title,url,state,headRefName,headRefOid,headRepository,headRepositoryOwner,isDraft," +
	"mergeable,mergeStateStatus,statusCheckRollup,latestReviews,additions,deletions,changedFiles,updatedAt";
const CONCURRENCY = 8;
// How far back to walk from each head while looking for other pull request heads.
const ANCESTRY_DEPTH = 2000;
const FAILED = /^(?:FAILURE|TIMED_OUT|CANCELLED|STARTUP_FAILURE|ACTION_REQUIRED|STALE|ERROR)$/u;
const WAITING = /^(?:PENDING|QUEUED|IN_PROGRESS|WAITING|REQUESTED)$/u;
const REMOTE_PREFIX = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)/u;

const run = (command: string): string => {
	const result = Bun.spawnSync(command.split(" "), { stderr: "ignore" });
	return result.exitCode === 0 ? result.stdout.toString().trim() : "";
};

const runJson = async <Result>(command: string): Promise<Result> => {
	const spawned = Bun.spawn(command.split(" "), { stderr: "ignore", stdout: "pipe" });
	const stdout = await new Response(spawned.stdout).text();
	if ((await spawned.exited) !== 0) {
		throw new Error(`${command} failed`);
	}
	return JSON.parse(stdout) as Result;
};

const inChunks = async <Item, Result>(
	items: Item[],
	task: (item: Item) => Promise<Result>,
): Promise<Result[]> => {
	const results: Result[] = [];
	for (let index = 0; index < items.length; index += CONCURRENCY) {
		// oxlint-disable-next-line eslint/no-await-in-loop
		results.push(...(await Promise.all(items.slice(index, index + CONCURRENCY).map(task))));
	}
	return results;
};

const prId = (repo: string, number: number | string): string => `${repo}#${number}`;

const headRepoOf = ({ headRepository, headRepositoryOwner }: PullRequest): string | null =>
	headRepositoryOwner?.login && headRepository?.name
		? `${headRepositoryOwner.login}/${headRepository.name}`
		: null;

const normalizeRemote = (url: string): string =>
	url
		.trim()
		.replace(/\.git\/?$/u, "")
		.replace(REMOTE_PREFIX, "");

const listPullRequests = async (repos: string[]): Promise<PullRequest[]> => {
	const listed = await Promise.all(
		repos.length === 0
			? [
					runJson<{ number: number; repository?: { nameWithOwner: string } }[]>(
						"gh search prs --author @me --state open --limit 200 --json number,repository",
					).then((found) =>
						found.flatMap(({ number, repository }) =>
							repository ? [{ number, repo: repository.nameWithOwner }] : [],
						),
					),
				]
			: repos.map(async (repo) =>
					(
						await runJson<{ number: number }[]>(
							`gh pr list --repo ${repo} --author @me --state open --limit 200 --json number`,
						)
					).map(({ number }) => ({ number, repo })),
				),
	);
	return await inChunks(listed.flat(), async ({ number, repo }) => ({
		...(await runJson<Omit<PullRequest, "repo">>(
			`gh pr view ${number} --repo ${repo} --json ${PR_FIELDS}`,
		)),
		repo,
	}));
};

const rollupState = (failing: string[], pending: string[], checks: unknown[]): string => {
	if (failing.length > 0) {
		return "failing";
	}
	if (pending.length > 0) {
		return "pending";
	}
	return checks.length > 0 ? "passing" : "none";
};

const summarizeChecks = (
	pullRequest: PullRequest,
): { state: string; failing: string[]; pending: string[]; passing: number } => {
	const checks = (pullRequest.statusCheckRollup ?? []).map((check) => ({
		name: check["name"] || check["workflowName"] || check["context"] || "check",
		status: (check["conclusion"] || check["state"] || check["status"] || "UNKNOWN").toUpperCase(),
	}));
	const failing = [
		...new Set(checks.filter((check) => FAILED.test(check.status)).map((check) => check.name)),
	];
	const pending = [
		...new Set(checks.filter((check) => WAITING.test(check.status)).map((check) => check.name)),
	];
	const passing = checks.length - failing.length - pending.length;
	return { failing, passing, pending, state: rollupState(failing, pending, checks) };
};

// Conflicts only mean something while a PR is open; GitHub leaves the merge state stale once it closes.
const hasConflict = (pullRequest: PullRequest): boolean =>
	pullRequest.state === "OPEN" &&
	(pullRequest.mergeable === "CONFLICTING" || pullRequest.mergeStateStatus === "DIRTY");

// The nearest ancestor is the one carrying every other ancestor beneath it.
const nearestParent = (id: string, ancestors: Map<string, Set<string>>): string | null =>
	[...(ancestors.get(id) ?? [])]
		.toSorted()
		.reduce<string | null>(
			(best, candidate) =>
				(ancestors.get(candidate)?.size ?? 0) > (ancestors.get(best ?? "")?.size ?? -1)
					? candidate
					: best,
			null,
		);

// Walks each head once and records which other pull request heads it contains.
const resolveStacks = (
	pullRequests: Map<string, PullRequest>,
	cwd: string,
): { stacks: Map<string, Stack>; found: number; total: number } => {
	const heads = [...pullRequests].map(([id, { headRefOid }]) => ({ id, sha: headRefOid }));
	const idBySha = new Map(heads.map(({ id, sha }) => [sha, id]));
	const walked = heads.map(({ id, sha }) => ({
		id,
		revisions: run(`git -C ${cwd} rev-list --max-count=${ANCESTRY_DEPTH} ${sha}`)
			.split("\n")
			.filter(Boolean),
	}));
	const ancestors = new Map(
		walked.map(({ id, revisions }) => [
			id,
			new Set(
				revisions.flatMap((revision) => {
					const other = idBySha.get(revision);
					return other !== undefined && other !== id ? [other] : [];
				}),
			),
		]),
	);
	const stacks = new Map(
		[...ancestors].map(([id, contained]) => [
			id,
			{ ancestors: [...contained].toSorted(), parent: nearestParent(id, ancestors) },
		]),
	);
	return {
		found: walked.filter(({ revisions }) => revisions.length > 0).length,
		stacks,
		total: heads.length,
	};
};

const checkoutOf = (cwd: string): Checkout => {
	const branch = run(`git -C ${cwd} rev-parse --abbrev-ref HEAD`);
	const remote = run(`git -C ${cwd} remote get-url origin`);
	const status = run(`git -C ${cwd} status --porcelain`);
	const dirty = status ? status.split("\n").length : 0;
	return {
		branch: branch || null,
		dirty: branch ? dirty : null,
		repo: remote ? normalizeRemote(remote) : null,
	};
};

// Matches on the head branch, preferring the PR whose head repository is the fork this checkout uses.
const matchPullRequest = (
	checkout: Pick<Checkout, "repo" | "branch">,
	pullRequests: Map<string, PullRequest>,
): string | null => {
	if (!checkout.branch) {
		return null;
	}
	const candidates = [...pullRequests].filter(([, pull]) => pull.headRefName === checkout.branch);
	const exact = candidates.filter(([, pull]) => headRepoOf(pull) === checkout.repo);
	return (
		(exact.length > 0 ? exact : candidates).toSorted(
			([, left], [, right]) => right.number - left.number,
		)[0]?.[0] ?? null
	);
};

const collectAgents = (pullRequests: Map<string, PullRequest>): Record<string, unknown>[] => {
	const raw = run("herdr agent list");
	const parsed = raw ? (JSON.parse(raw) as { result?: { agents?: Record<string, never>[] } }) : {};
	return (parsed.result?.agents ?? []).map((entry: Record<string, never>) => {
		const cwd: string | null = entry["cwd"] ?? null;
		const checkout = cwd ? checkoutOf(cwd) : { branch: null, dirty: null, repo: null };
		return {
			agent: entry["agent"] ?? null,
			branch: checkout.branch,
			cwd,
			dirty_files: checkout.dirty,
			focused: entry["focused"] ?? false,
			pane_id: entry["pane_id"] ?? null,
			pull_request: matchPullRequest(checkout, pullRequests),
			repo: checkout.repo,
			session_id: entry["agent_session"]?.["value"] ?? null,
			status: entry["agent_status"] ?? null,
			title: entry["terminal_title_stripped"] ?? null,
		};
	});
};

export {
	collectAgents,
	hasConflict,
	headRepoOf,
	listPullRequests,
	matchPullRequest,
	nearestParent,
	normalizeRemote,
	prId,
	resolveStacks,
	run,
	summarizeChecks,
};
export type { Checkout, PullRequest, Stack };
