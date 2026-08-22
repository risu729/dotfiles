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
	additions?: number;
	deletions?: number;
	changedFiles?: number;
	updatedAt: string;
};

type Target = { number: number; repo: string };
type Failure = { target: string; error: string };
type Stack = { ancestors: string[]; parent: string | null; resolved: boolean };
type CheckSummary = { state: string; failing: string[]; pending: string[]; passing: number };

const PR_FIELDS =
	"number,title,url,state,headRefName,headRefOid,headRepository,headRepositoryOwner,isDraft," +
	"mergeable,mergeStateStatus,statusCheckRollup,additions,deletions,changedFiles,updatedAt";
const LIST_ARGS = ["--author", "@me", "--state", "open", "--limit", "200", "--json"];
const CONCURRENCY = 8;
const FAILED = /^(?:FAILURE|TIMED_OUT|CANCELLED|STARTUP_FAILURE|ACTION_REQUIRED|STALE|ERROR)$/u;
const WAITING = /^(?:PENDING|QUEUED|IN_PROGRESS|WAITING|REQUESTED)$/u;
// Matches `scheme://[user@]host/` and the scp form `[user@]host:`, so alias hosts and tokens go too.
const REMOTE_HOST = /^(?:[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?[^/]+\/|(?:[^@/\s]+@)?[^/:\s]+:)/u;

// Returns "" for a non-zero exit and for a missing executable, which spawnSync raises rather than reports.
const run = (command: string[]): string => {
	try {
		const result = Bun.spawnSync(command, { stderr: "ignore" });
		return result.exitCode === 0 ? result.stdout.toString().trim() : "";
	} catch {
		return "";
	}
};

const runJson = async <Result>(command: string[]): Promise<Result> => {
	const spawned = Bun.spawn(command, { stderr: "pipe", stdout: "pipe" });
	const [stdout, stderr] = await Promise.all([
		new Response(spawned.stdout).text(),
		new Response(spawned.stderr).text(),
	]);
	if ((await spawned.exited) !== 0) {
		throw new Error(`${command.join(" ")}: ${stderr.trim() || "failed"}`);
	}
	try {
		return JSON.parse(stdout) as Result;
	} catch {
		throw new Error(`${command.join(" ")}: unexpected output`);
	}
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
		.replace(REMOTE_HOST, "")
		.replace(/\.git$/u, "")
		.replace(/\/$/u, "");

const listTargets = async (repos: string[]): Promise<Target[]> => {
	if (repos.length === 0) {
		const found = await runJson<{ number: number; repository?: { nameWithOwner: string } }[]>([
			"gh",
			"search",
			"prs",
			...LIST_ARGS,
			"number,repository",
		]);
		return found.flatMap(({ number, repository }) =>
			repository ? [{ number, repo: repository.nameWithOwner }] : [],
		);
	}
	const listed = await Promise.all(
		repos.map(async (repo) =>
			(
				await runJson<{ number: number }[]>([
					"gh",
					"pr",
					"list",
					"--repo",
					repo,
					...LIST_ARGS,
					"number",
				])
			).map(({ number }) => ({ number, repo })),
		),
	);
	return listed.flat();
};

// A pull request that cannot be fetched is skipped and recorded, never fatal to the whole report.
const listPullRequests = async (
	repos: string[],
): Promise<{ pullRequests: PullRequest[]; errors: Failure[] }> => {
	const errors: Failure[] = [];
	const fetched = await inChunks(await listTargets(repos), async ({ number, repo }) => {
		try {
			const view = await runJson<Omit<PullRequest, "repo">>([
				"gh",
				"pr",
				"view",
				String(number),
				"--repo",
				repo,
				"--json",
				PR_FIELDS,
			]);
			return { ...view, repo };
		} catch (error) {
			errors.push({
				error: error instanceof Error ? error.message : String(error),
				target: prId(repo, number),
			});
			return null;
		}
	});
	return { errors, pullRequests: fetched.filter((pull) => pull !== null) };
};

const rollupState = (failing: string[], pending: string[], total: number): string => {
	if (failing.length > 0) {
		return "failing";
	}
	if (pending.length > 0) {
		return "pending";
	}
	return total > 0 ? "passing" : "none";
};

// Counts distinct check names, so a matrix job reporting one name many times is not counted many times.
const summarizeChecks = (pullRequest: PullRequest): CheckSummary => {
	const checks = (pullRequest.statusCheckRollup ?? []).map((check) => ({
		name: check["name"] || check["workflowName"] || check["context"] || "check",
		status: (check["conclusion"] || check["state"] || check["status"] || "UNKNOWN").toUpperCase(),
	}));
	const named = (match: RegExp): string[] => [
		...new Set(checks.filter((check) => match.test(check.status)).map((check) => check.name)),
	];
	const failing = named(FAILED);
	const pending = named(WAITING);
	const distinct = new Set(checks.map((check) => check.name)).size;
	return {
		failing,
		passing: distinct - failing.length - pending.length,
		pending,
		state: rollupState(failing, pending, distinct),
	};
};

// Conflicts only mean something while a PR is open; GitHub leaves the merge state stale once it closes.
const hasConflict = (pullRequest: PullRequest): boolean =>
	pullRequest.state === "OPEN" &&
	(pullRequest.mergeable === "CONFLICTING" || pullRequest.mergeStateStatus === "DIRTY");

export {
	hasConflict,
	inChunks,
	headRepoOf,
	listPullRequests,
	normalizeRemote,
	prId,
	run,
	runJson,
	summarizeChecks,
};
export type { Failure, PullRequest, Stack };
