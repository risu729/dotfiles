#!/usr/bin/env bun

import { resolve } from "node:path";

import { $, env, spawn } from "bun";

/* oxlint-disable eslint/max-lines-per-function eslint/max-statements eslint/no-await-in-loop */

// Remove GITHUB_TOKEN from env to avoid github cli using it
const envWithoutGitHubToken = Object.fromEntries(
	Object.entries(env).filter(([key]) => key !== "GITHUB_TOKEN"),
) as Record<string, string>;

const ensureGitHubTokenScopes = async (): Promise<void> => {
	const authWithBrowser = async (subcommand: string): Promise<void> => {
		// Bun shell doesn't support reading from stdout and stderr while running a command
		// Ref: https://github.com/oven-sh/bun/issues/14693
		const process = spawn(["gh", "auth", ...subcommand.split(" ")], {
			env: envWithoutGitHubToken,
			// Default is "inherit" which just logs to the console
			// Ref: https://bun.sh/docs/api/spawn#output-streams
			stderr: "pipe",
		});

		const reader = process.stderr.getReader();
		const decoder = new TextDecoder();

		let output = "";

		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			const text = decoder.decode(value, { stream: true });
			output += text;
			const oneTimeCode = text.match(
				// Ref: https://github.com/cli/cli/blob/14d339d9ba87e87f34b7a25f00200a2062f87039/internal/authflow/flow.go#L58
				/First copy your one-time code: (?<code>[A-Z0-9-]+)/u,
			)?.groups?.["code"];
			if (oneTimeCode) {
				// Copy one-time code to clipboard of Windows
				// Don't use piping because clip.exe appends a trailing newline
				await $`clip.exe < ${Buffer.from(oneTimeCode)}`;
			}
			const url = text.match(
				// Ref: https://github.com/cli/cli/blob/14d339d9ba87e87f34b7a25f00200a2062f87039/internal/authflow/flow.go#L71
				/Open this URL to continue in your web browser: (?<url>.+)/u,
			)?.groups?.["url"];
			if (url) {
				// Open the url automatically in the Windows default browser
				await $`xdg-open ${url}`.nothrow();
			}
		}

		const processExitCode = await process.exited;
		if (processExitCode !== 0) {
			throw new Error(`Process exited with code ${processExitCode}. ${output}`);
		}
	};

	// Ref: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps
	const requiredScopes = [
		// Not included in the scopes granted by default in gh auth login
		"workflow",
		"read:packages",
		"project",
	];

	// Login to GitHub if not authenticated
	const { stdout, exitCode } = await $`gh auth status --active --hostname github.com --json hosts`
		.env(envWithoutGitHubToken)
		.quiet()
		.nothrow();
	if (exitCode !== 0) {
		await authWithBrowser(`login --web --git-protocol https --scopes ${requiredScopes.join(",")}`);
		return;
	}
	const authStatus = JSON.parse(stdout.toString()) as {
		hosts?: Record<
			string,
			{
				active: boolean;
				scopes: string;
				state: string;
			}[]
		>;
	};
	const activeAccount = authStatus.hosts?.["github.com"]?.find(({ active }) => active);
	if (activeAccount?.state !== "success") {
		await authWithBrowser(`login --web --git-protocol https --scopes ${requiredScopes.join(",")}`);
		return;
	}

	const scopes = activeAccount.scopes.split(", ");
	const missingScopes = requiredScopes.filter((scope) => !scopes.includes(scope));
	if (missingScopes.length > 0) {
		console.info(
			`Missing GitHub token scopes: ${missingScopes.join(", ")}. Please authenticate with the required scopes.`,
		);
		// Need to specify hostname in non-interactive mode
		await authWithBrowser(`refresh --hostname github.com --scopes ${missingScopes.join(",")}`);
	}
};

const main = async (): Promise<void> => {
	try {
		await ensureGitHubTokenScopes();
	} finally {
		// Reset gh config because it is formatted differently by gh cli
		const ghConfigPath = resolve(import.meta.dirname, "./home/.config/gh/config.yml");
		await $`git checkout -- ${ghConfigPath}`.cwd(resolve(import.meta.dirname, "..")).quiet();
	}
};
await main();
