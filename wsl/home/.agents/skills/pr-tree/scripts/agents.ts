/* oxlint-disable import/no-named-export */

import { normalizeRemote, run } from "./exec.ts";
import { headRepoOf } from "./relations.ts";
import type { PullRequest } from "./relations.ts";

type Agent = {
	pane_id: string | null;
	tab_id: string | null;
	workspace_id: string | null;
	agent: string | null;
	session_id: string | null;
	status: string | null;
	focused: boolean;
	title: string | null;
	cwd: string | null;
	repo: string | null;
	branch: string | null;
	dirty_files: number | null;
	pull_request: string | null;
};

type RawAgent = {
	agent?: string;
	agent_session?: { value?: string };
	agent_status?: string;
	cwd?: string;
	focused?: boolean;
	pane_id?: string;
	tab_id?: string;
	terminal_title_stripped?: string;
	workspace_id?: string;
};

type Checkout = { repo: string | null; branch: string | null; dirty: number | null };

const gitInfo = (cwd: string): Checkout => {
	const branch = run(["git", "-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"], false);
	if (!branch) {
		return { branch: null, dirty: null, repo: null };
	}
	const remote = run(["git", "-C", cwd, "remote", "get-url", "origin"], false);
	const status = run(["git", "-C", cwd, "status", "--porcelain"], false);
	return {
		branch,
		dirty: status ? status.split("\n").length : 0,
		repo: remote ? normalizeRemote(remote) : null,
	};
};

// Matches on the head branch, preferring a pull request whose head repository is
// The same fork the checkout points at when several share a branch name.
const matchPullRequest = (
	checkout: Pick<Checkout, "repo" | "branch">,
	pullRequests: Map<string, PullRequest>,
): string | null => {
	if (!checkout.branch) {
		return null;
	}
	const candidates = [...pullRequests].filter(
		([, pullRequest]) => pullRequest.headRefName === checkout.branch,
	);
	const exact = candidates.filter(([, pullRequest]) => headRepoOf(pullRequest) === checkout.repo);
	const [chosen] = (exact.length > 0 ? exact : candidates).sort(
		([, left], [, right]) => right.number - left.number,
	);
	return chosen?.[0] ?? null;
};

const parseAgentList = (raw: string): RawAgent[] => {
	try {
		return (JSON.parse(raw) as { result?: { agents?: RawAgent[] } }).result?.agents ?? [];
	} catch {
		return [];
	}
};

const collectAgents = (pullRequests: Map<string, PullRequest>): Agent[] => {
	const raw = run(["herdr", "agent", "list"], false);
	if (!raw) {
		return [];
	}
	return parseAgentList(raw).map((entry) => {
		const cwd = entry.cwd ?? null;
		const checkout = cwd ? gitInfo(cwd) : { branch: null, dirty: null, repo: null };
		return {
			agent: entry.agent ?? null,
			branch: checkout.branch,
			cwd,
			dirty_files: checkout.dirty,
			focused: entry.focused ?? false,
			pane_id: entry.pane_id ?? null,
			pull_request: matchPullRequest(checkout, pullRequests),
			repo: checkout.repo,
			session_id: entry.agent_session?.value ?? null,
			status: entry.agent_status ?? null,
			tab_id: entry.tab_id ?? null,
			title: entry.terminal_title_stripped ?? null,
			workspace_id: entry.workspace_id ?? null,
		};
	});
};

export { collectAgents, matchPullRequest };
export type { Agent, Checkout };
