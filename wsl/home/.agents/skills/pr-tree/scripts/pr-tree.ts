#!/usr/bin/env bun

/* oxlint-disable eslint/max-statements import/no-named-export node/no-sync */

type RawCheck = {
	name?: string;
	workflowName?: string;
	context?: string;
	conclusion?: string;
	state?: string;
	status?: string;
};

type PullRequest = {
	repo: string;
	number: number;
	title: string;
	url: string;
	baseRefName: string;
	headRefName: string;
	isDraft: boolean;
	mergeStateStatus: string;
	statusCheckRollup: RawCheck[];
	body: string;
	updatedAt: string;
};

type Filters = {
	repos: string[];
	currentRepo: boolean;
	help: boolean;
};

const dependencyPattern = /(?<kind>depends?\s+on|requires?|stacked\s+on|based\s+on|blocked\s+on)/iu;
const urlPattern =
	/https:\/\/github\.com\/(?<owner>[^/\s]+)\/(?<repo>[^/\s]+)\/pull\/(?<number>\d+)/giu;
const ownerRepoPattern = /(?<repo>[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(?<number>\d+)/gu;
const localRefPattern = /(?<![A-Za-z0-9_/.-])#(?<number>\d+)/gu;

const run = (command: string[], check = true): string => {
	try {
		const result = Bun.spawnSync(command, { stderr: "ignore" });
		if (check && result.exitCode !== 0) {
			throw new Error(`${command.join(" ")} exited with ${result.exitCode}`);
		}
		return result.stdout.toString().trim();
	} catch (error) {
		if (check) {
			throw error;
		}
		return "";
	}
};

const runJson = <Result>(command: string[]): Result => JSON.parse(run(command)) as Result;

const normalizeRemote = (url: string): string => {
	let normalized = url
		.trim()
		.replace(/\/$/u, "")
		.replace(/\.git$/u, "");
	for (const prefix of ["https://github.com/", "git@github.com:", "ssh://git@github.com/"]) {
		if (normalized.startsWith(prefix)) {
			normalized = normalized.slice(prefix.length);
			break;
		}
	}
	return normalized;
};

const parseArgs = (args: string[]): Filters => {
	const filters: Filters = { currentRepo: false, help: false, repos: [] };
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
		} else if (option === "--help" || option === "-h") {
			filters.help = true;
		} else {
			throw new Error(`unknown option: ${option}`);
		}
	}
	return filters;
};

type Target = { number: number; repo: string };

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

const fetchPullRequest = ({ number, repo }: Target): PullRequest => ({
	...runJson<Omit<PullRequest, "repo">>([
		"gh",
		"pr",
		"view",
		String(number),
		"--repo",
		repo,
		"--json",
		"number,title,url,baseRefName,headRefName,isDraft,mergeStateStatus,statusCheckRollup,body,updatedAt",
	]),
	repo,
});

const prId = (repo: string, number: number | string): string => `${repo}#${number}`;

const dependencyRefs = (pullRequest: PullRequest): string[] => {
	const references: string[] = [];
	for (const line of pullRequest.body.split("\n")) {
		const dependency = dependencyPattern.exec(line);
		if (dependency?.index === undefined) {
			continue;
		}
		const segment = line.slice(dependency.index);
		for (const match of segment.matchAll(urlPattern)) {
			const { owner, repo, number } = match.groups ?? {};
			if (owner && repo && number) {
				references.push(prId(`${owner}/${repo}`, number));
			}
		}
		for (const match of segment.matchAll(ownerRepoPattern)) {
			const { repo, number } = match.groups ?? {};
			if (repo && number) {
				references.push(prId(repo, number));
			}
		}
		const local = segment.replace(urlPattern, "").replace(ownerRepoPattern, "");
		for (const match of local.matchAll(localRefPattern)) {
			const number = match.groups?.["number"];
			if (number) {
				references.push(prId(pullRequest.repo, number));
			}
		}
	}
	return [...new Set(references)];
};

const normalizeChecks = (pullRequest: PullRequest): { name: string; status: string }[] => {
	const checks = new Map<string, { name: string; status: string }>();
	for (const check of pullRequest.statusCheckRollup) {
		const name = check.name || check.workflowName || check.context || "check";
		const status = check.conclusion || check.state || check.status || "UNKNOWN";
		checks.set(`${name}\0${status}`, { name, status });
	}
	return [...checks.values()];
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

const buildEntries = (pullRequests: Map<string, PullRequest>): object[] => {
	const dependencies = new Map(
		[...pullRequests].map(([id, pullRequest]) => [id, dependencyRefs(pullRequest)]),
	);
	const dependents = new Map<string, Set<string>>();
	for (const [id, declared] of dependencies) {
		for (const dependency of declared) {
			if (pullRequests.has(dependency) && dependency !== id) {
				const children = dependents.get(dependency) ?? new Set<string>();
				children.add(id);
				dependents.set(dependency, children);
			}
		}
	}
	return sortIds(pullRequests.keys(), pullRequests).map((id) => {
		const pullRequest = pullRequests.get(id);
		if (!pullRequest) {
			throw new Error(`missing pull request: ${id}`);
		}
		const declared = dependencies.get(id) ?? [];
		return {
			base_ref: pullRequest.baseRefName,
			checks: normalizeChecks(pullRequest),
			dependencies: declared,
			dependencies_outside_view: declared.filter((dependency) => !pullRequests.has(dependency)),
			dependents: sortIds(dependents.get(id) ?? [], pullRequests),
			draft: pullRequest.isDraft,
			head_ref: pullRequest.headRefName,
			id,
			merge_state: pullRequest.mergeStateStatus || "UNKNOWN",
			number: pullRequest.number,
			open_dependencies: sortIds(
				declared.filter((dependency) => pullRequests.has(dependency)),
				pullRequests,
			),
			repo: pullRequest.repo,
			title: pullRequest.title,
			updated_at: pullRequest.updatedAt,
			url: pullRequest.url,
		};
	});
};

const main = (): void => {
	const filters = parseArgs(Bun.argv.slice(2));
	if (filters.help) {
		console.info("Usage: pr-tree.ts [--repo owner/name] [--current-repo]");
		return;
	}
	if (filters.currentRepo) {
		const remote = run(["git", "remote", "get-url", "origin"], false);
		if (!remote) {
			throw new Error("could not infer the current repository");
		}
		filters.repos.push(normalizeRemote(remote));
	}
	const repos = [...new Set(filters.repos)];
	const pullRequests = new Map<string, PullRequest>();
	for (const target of targetsFor(repos)) {
		const pullRequest = fetchPullRequest(target);
		pullRequests.set(prId(pullRequest.repo, pullRequest.number), pullRequest);
	}
	console.info(JSON.stringify({ pull_requests: buildEntries(pullRequests) }, null, 2));
};

if (import.meta.main) {
	main();
}

export { buildEntries, dependencyRefs, normalizeChecks };
export type { PullRequest };
