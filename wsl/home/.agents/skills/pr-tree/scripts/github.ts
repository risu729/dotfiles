/* oxlint-disable import/no-named-export */

import { runJson, runJsonAsync } from "./exec.ts";
import type { PullRequest } from "./relations.ts";

type Target = { number: number; repo: string };

const PR_FIELDS = [
	"number",
	"title",
	"url",
	"state",
	"baseRefName",
	"headRefName",
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
	"body",
	"updatedAt",
].join(",");

const FETCH_CONCURRENCY = 8;

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

export { FETCH_CONCURRENCY, fetchPullRequest, targetsFor };
export type { Target };
