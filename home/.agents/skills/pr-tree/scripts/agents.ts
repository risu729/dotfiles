/* oxlint-disable import/no-named-export */

import { headRepoOf, normalizeRemote, run } from "./data.ts";
import type { PullRequest } from "./data.ts";

type RawAgent = {
	agent?: string;
	agent_session?: { value?: string } | null;
	agent_status?: string;
	cwd?: string;
	focused?: boolean;
	pane_id?: string;
	terminal_title_stripped?: string;
};

type Checkout = { repo: string | null; branch: string | null; dirty: number | null };

// Strips the escape sequences herdr's captured terminal output carries.
// oxlint-disable-next-line eslint/no-control-regex -- stripping ANSI is the point
const ANSI = /\u001B\[[0-9;?]*[A-Za-z]/gu;

const checkoutOf = (cwd: string): Checkout => {
	const branch = run(["git", "-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"]);
	if (!branch) {
		return { branch: null, dirty: null, repo: null };
	}
	const remote = run(["git", "-C", cwd, "remote", "get-url", "origin"]);
	const status = run(["git", "-C", cwd, "status", "--porcelain"]);
	return {
		branch,
		dirty: status ? status.split("\n").length : 0,
		repo: remote ? normalizeRemote(remote) : null,
	};
};

// Requires a repository match too, so a reused branch name never lands on the wrong PR.
const matchPullRequest = (
	checkout: Pick<Checkout, "repo" | "branch">,
	pullRequests: Map<string, PullRequest>,
): string | null => {
	if (!checkout.branch || !checkout.repo) {
		return null;
	}
	const candidates = [...pullRequests].filter(
		([, pull]) =>
			pull.headRefName === checkout.branch &&
			(headRepoOf(pull) === checkout.repo || pull.repo === checkout.repo),
	);
	const forks = candidates.filter(([, pull]) => headRepoOf(pull) === checkout.repo);
	return (
		(forks.length > 0 ? forks : candidates).toSorted(
			([, left], [, right]) => right.number - left.number,
		)[0]?.[0] ?? null
	);
};

const recentOutput = (paneId: string | null, lines: number): string | null => {
	if (!paneId || lines <= 0) {
		return null;
	}
	const output = run([
		"herdr",
		"agent",
		"read",
		paneId,
		"--source",
		"detection",
		"--lines",
		String(lines),
	]);
	return output ? output.replace(ANSI, "").trimEnd() : null;
};

const parseAgents = (raw: string): RawAgent[] => {
	try {
		return (JSON.parse(raw) as { result?: { agents?: RawAgent[] } }).result?.agents ?? [];
	} catch {
		return [];
	}
};

const collectAgents = (
	pullRequests: Map<string, PullRequest>,
	lines: number,
): Record<string, unknown>[] =>
	parseAgents(run(["herdr", "agent", "list"])).map((entry) => {
		const checkout = entry.cwd ? checkoutOf(entry.cwd) : { branch: null, dirty: null, repo: null };
		return {
			agent: entry.agent ?? null,
			branch: checkout.branch,
			cwd: entry.cwd ?? null,
			dirty_files: checkout.dirty,
			focused: entry.focused ?? false,
			pane_id: entry.pane_id ?? null,
			pull_request: matchPullRequest(checkout, pullRequests),
			recent_output: recentOutput(entry.pane_id ?? null, lines),
			repo: checkout.repo,
			session_id: entry.agent_session?.value ?? null,
			status: entry.agent_status ?? null,
			title: entry.terminal_title_stripped ?? null,
		};
	});

export { collectAgents, matchPullRequest };
export type { Checkout };
