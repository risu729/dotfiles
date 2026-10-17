// Command-line entrypoint consumes the native inventory once.
/* oxlint-disable vitest/require-hook */
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";

type Sidecar = { exists: boolean; path: string };
const inventory: unknown = await Bun.stdin.json();
if (!Array.isArray(inventory) || inventory.length === 0) {
	throw new Error("No lockfile inventory was returned");
}

const git = async (args: string[]): Promise<string> => {
	const child = Bun.spawn(["git", "--literal-pathspecs", ...args], {
		stderr: "inherit",
		stdout: "pipe",
	});
	const output = await new Response(child.stdout).text();
	if ((await child.exited) !== 0) {
		throw new Error("Cannot inspect the Git index");
	}
	return output;
};
const root = await realpath((await git(["rev-parse", "--show-toplevel"])).trim());
const trackingIssues = async (path: string): Promise<string[]> => {
	const [tracked, untracked, deleted] = await Promise.all([
		git(["ls-files", "--cached", "-z", "--", path]),
		git(["ls-files", "--others", "-z", "--", path]),
		git(["ls-files", "--deleted", "-z", "--", path]),
	]);
	const issues = [
		...untracked
			.split("\0")
			.filter(Boolean)
			.map((file) => `untracked sidecar file ${file}`),
		...deleted
			.split("\0")
			.filter(Boolean)
			.map((file) => `missing tracked sidecar file ${file}`),
	];
	if (!tracked) {
		issues.push(`no Git-tracked sidecar files in ${path}`);
	}
	return issues;
};
const reportFailure = (message: string): false => {
	console.error(message);
	return false;
};
const audit = async (lockfile: string, sidecar: Sidecar): Promise<boolean> => {
	if (!sidecar.exists) {
		return reportFailure(`${lockfile}: missing sidecar directory ${sidecar.path}`);
	}
	const directory = await realpath(sidecar.path);
	const path = relative(root, directory).split(sep).join("/");
	if (isAbsolute(path) || path === ".." || path.startsWith("../")) {
		return reportFailure(`${lockfile}: sidecar is outside this checkout: ${sidecar.path}`);
	}
	const issues = await trackingIssues(path);
	for (const issue of issues) {
		console.error(`${lockfile}: ${issue}`);
	}
	return issues.length === 0;
};

const checks: Promise<boolean>[] = [];
for (const lock of inventory) {
	if (typeof lock?.lockfile !== "string" || !Array.isArray(lock.sidecars)) {
		throw new Error("Invalid native lockfile inventory");
	}
	for (const sidecar of lock.sidecars) {
		if (typeof sidecar?.path !== "string" || typeof sidecar.exists !== "boolean") {
			throw new Error("Invalid native sidecar inventory");
		}
		checks.push(audit(lock.lockfile, sidecar));
	}
}
const results = await Promise.all(checks);
console.log(`Checked ${results.length} referenced sidecar directories against Git`);
process.exit(results.every(Boolean) ? 0 : 1);
