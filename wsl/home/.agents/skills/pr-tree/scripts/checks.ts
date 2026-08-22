/* oxlint-disable import/no-named-export */

import type { PullRequest } from "./relations.ts";

type Check = { name: string; status: string };
type CheckSummary = { state: string; failing: string[]; pending: string[]; passing: number };

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

export { hasConflict, normalizeChecks, summarizeChecks };
export type { Check, CheckSummary };
