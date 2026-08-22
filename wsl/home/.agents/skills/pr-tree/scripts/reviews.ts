/* oxlint-disable import/no-named-export */

import { runJson } from "./data.ts";
import type { PullRequest } from "./data.ts";

type BotReview = {
	login: string;
	verdict: string;
	check: string | null;
	reviews: number;
	last_review_state: string | null;
	summaries: number;
	threads: number;
	unresolved: number;
	last_activity: string | null;
};

type ReviewGraph = {
	comments: { nodes: { author?: { login?: string } | null; createdAt: string }[] };
	reviews: {
		nodes: { author?: { login?: string } | null; state: string; submittedAt: string | null }[];
	};
	reviewThreads: {
		nodes: { isResolved: boolean; comments: { nodes: { author?: { login?: string } | null }[] } }[];
	};
};

// A bot opens a formal review only when it has inline findings, so its check run is the real signal.
const REVIEW_BOTS = [
	{ check: "CodeRabbit", login: "coderabbitai" },
	{ check: "Greptile Review", login: "greptile-apps" },
];

const REVIEW_QUERY = `query($owner:String!,$name:String!,$number:Int!){
  repository(owner:$owner,name:$name){pullRequest(number:$number){
    comments(last:50){nodes{author{login} createdAt}}
    reviews(last:50){nodes{author{login} state submittedAt}}
    reviewThreads(first:100){nodes{isResolved comments(first:1){nodes{author{login}}}}}
  }}}`;

const fetchReviewGraph = async (pullRequest: PullRequest): Promise<ReviewGraph | null> => {
	const [owner, name] = pullRequest.repo.split("/");
	if (!owner || !name) {
		return null;
	}
	try {
		const result = await runJson<{ data?: { repository?: { pullRequest?: ReviewGraph } } }>([
			"gh",
			"api",
			"graphql",
			"-f",
			`query=${REVIEW_QUERY}`,
			"-F",
			`owner=${owner}`,
			"-F",
			`name=${name}`,
			"-F",
			`number=${pullRequest.number}`,
		]);
		return result.data?.repository?.pullRequest ?? null;
	} catch {
		return null;
	}
};

const checkStateFor = (pullRequest: PullRequest, name: string): string | null => {
	const check = (pullRequest.statusCheckRollup ?? []).find(
		(entry) => (entry["name"] ?? entry["context"]) === name,
	);
	if (!check) {
		return null;
	}
	return (check["conclusion"] || check["status"] || check["state"] || "UNKNOWN").toUpperCase();
};

const verdictFor = (check: string | null, ran: boolean, unresolved: number): string => {
	if (check === "IN_PROGRESS" || check === "QUEUED" || check === "PENDING") {
		return "running";
	}
	if (!check && !ran) {
		return "not_run";
	}
	if (!check) {
		return "stale";
	}
	return unresolved > 0 ? "findings" : "clean";
};

const botReview = (
	pullRequest: PullRequest,
	graph: ReviewGraph | null,
	bot: { check: string; login: string },
): BotReview => {
	const mine = <Item extends { author?: { login?: string } | null }>(items: Item[]): Item[] =>
		items.filter((item) => item.author?.login === bot.login);
	const summaries = mine(graph?.comments.nodes ?? []);
	const reviews = mine(graph?.reviews.nodes ?? []);
	const threads = (graph?.reviewThreads.nodes ?? []).filter(
		(thread) => thread.comments.nodes[0]?.author?.login === bot.login,
	);
	const check = checkStateFor(pullRequest, bot.check);
	const unresolved = threads.filter((thread) => !thread.isResolved).length;
	const times = [
		...summaries.map((item) => item.createdAt),
		...reviews.flatMap((item) => (item.submittedAt ? [item.submittedAt] : [])),
	].toSorted();
	return {
		check,
		last_activity: times.at(-1) ?? null,
		last_review_state: reviews.at(-1)?.state ?? null,
		login: bot.login,
		reviews: reviews.length,
		summaries: summaries.length,
		threads: threads.length,
		unresolved,
		verdict: verdictFor(check, summaries.length + reviews.length > 0, unresolved),
	};
};

const collectReviews = async (pullRequest: PullRequest): Promise<BotReview[]> => {
	const graph = await fetchReviewGraph(pullRequest);
	return REVIEW_BOTS.map((bot) => botReview(pullRequest, graph, bot));
};

export { botReview, collectReviews, REVIEW_BOTS, verdictFor };
export type { BotReview, ReviewGraph };
