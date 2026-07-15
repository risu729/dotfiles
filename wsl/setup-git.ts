#!/usr/bin/env bun

import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { $, env, spawn } from "bun";

/* oxlint-disable eslint/max-lines eslint/max-lines-per-function eslint/max-statements eslint/no-await-in-loop */

// Remove GITHUB_TOKEN from env to avoid github cli using it
const envWithoutGitHubToken = Object.fromEntries(
	Object.entries(env).filter(([key]) => key !== "GITHUB_TOKEN"),
) as Record<string, string>;

const localGitConfigPath: string = (await $`git config --global include.path`.text()).trim();
const allowedSignersPath = join(homedir(), ".ssh", "allowed_signers");

type SshPublicKey = {
	algorithm: string;
	blob: string;
	comment: string;
	fingerprint: string;
	key: string;
};

type GitHubSshSigningKey = {
	created_at: string;
	id: number;
	key: string;
	title: string;
};

/**
 * @returns {Promise<() => Promise<void>>} function to remove unnecessary granted scopes
 */
const ensureGitHubTokenScopes = async (): Promise<() => Promise<void>> => {
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
		{
			// Not included in the scopes granted by default in gh auth login
			scope: "workflow",
		},
		// Allow read-only access
		{
			scope: "read:packages",
		},
		{
			scope: "read:project",
		},
		{
			removeAfterUse: true,
			// Required to list and add SSH signing keys
			scope: "write:ssh_signing_key",
		},
	];

	const removeScopes = async (): Promise<void> => {
		// Reset github token scopes to default for security
		console.info("Resetting GitHub token scopes...");
		// Need to specify hostname in non-interactive mode
		await authWithBrowser(
			`refresh --hostname github.com --remove-scopes ${requiredScopes
				.filter(({ removeAfterUse }) => removeAfterUse)
				.map(({ scope }) => scope)
				.join(",")}`,
		);
	};

	// Login to GitHub if not authenticated
	const { stdout, exitCode } = await $`gh auth status`.env(envWithoutGitHubToken).quiet().nothrow();
	if (exitCode !== 0) {
		await authWithBrowser(
			`login --web --git-protocol https --scopes ${requiredScopes.map(({ scope }) => scope).join(",")}`,
		);
		return removeScopes;
	}

	const scopes =
		stdout
			.toString()
			.match(/Token scopes:(?<scopes>.*)/u)
			?.groups?.["scopes"]?.trim()
			.split(", ")
			.map((scope) => scope.replaceAll(/'/gu, "")) ?? [];
	const missingScopes = requiredScopes
		.filter(({ scope }) => !scopes.includes(scope))
		.map(({ scope }) => scope);
	if (missingScopes.length > 0) {
		console.info(
			`Missing GitHub token scopes: ${missingScopes.join(", ")}. Please authenticate with the required scopes.`,
		);
		// Need to specify hostname in non-interactive mode
		await authWithBrowser(`refresh --hostname github.com --scopes ${missingScopes.join(",")}`);
	}
	return removeScopes;
};

const ghApi = async <ReturnType>(endpoint: `/${string}`): Promise<ReturnType> =>
	await $`gh api ${endpoint} --header "Accept: application/vnd.github+json" --header "X-GitHub-Api-Version: 2022-11-28"`
		.env(envWithoutGitHubToken)
		.json();

const parseSshPublicKey = async (line: string): Promise<SshPublicKey | undefined> => {
	const match = line.trim().match(/^(?<algorithm>\S+)\s+(?<blob>\S+)(?:\s+(?<comment>.*))?$/u);
	const algorithm = match?.groups?.["algorithm"];
	const blob = match?.groups?.["blob"];
	if (!algorithm || !blob) {
		return;
	}
	const key = `${algorithm} ${blob}`;
	const fingerprint = (await $`ssh-keygen -lf /dev/stdin < ${Buffer.from(`${key}\n`)}`.text())
		.trim()
		.split(/\s+/u)
		.at(1);
	if (!fingerprint) {
		throw new Error(`Could not calculate fingerprint for SSH key: ${key}`);
	}
	return {
		algorithm,
		blob,
		comment: match.groups?.["comment"] ?? "",
		fingerprint,
		key,
	};
};

const getAgentKeys = async (): Promise<SshPublicKey[]> => {
	const result = await $`ssh-add -L`.quiet().nothrow();
	if (result.exitCode !== 0) {
		throw new Error(
			`Could not list SSH agent keys. Enable and unlock the Bitwarden SSH agent, then try again.\n${result.stderr.toString().trim()}`,
		);
	}
	const keys = (
		await Promise.all(
			result.stdout
				.toString()
				.trim()
				.split("\n")
				.filter(Boolean)
				.map(async (line) => await parseSshPublicKey(line)),
		)
	).filter((key): key is SshPublicKey => key !== undefined);
	const uniqueKeys = [...new Map(keys.map((key) => [key.key, key])).values()];
	if (uniqueKeys.length === 0) {
		throw new Error(
			"No SSH keys are available from the Bitwarden SSH agent. Create or import a signing key, then try again.",
		);
	}
	return uniqueKeys;
};

const selectFromList = async <T>(
	prompt: string,
	items: T[],
	formatItem: (item: T) => string,
): Promise<T> => {
	if (items.length === 0) {
		throw new Error("No items to select from");
	}
	console.info(`${prompt} Please select one by number:`);
	console.info(
		items
			.map(formatItem)
			.map((line, index) => `${index + 1}. ${line}`)
			.join("\n"),
	);
	for await (const line of console) {
		const index = Number.parseInt(line.trim(), 10);
		if (Number.isNaN(index) || index < 1 || index > items.length) {
			console.error("Invalid input. Please enter a number listed above.");
			continue;
		}
		return items[index - 1]!;
	}
	throw new Error("Unexpected end of input");
};

const githubKeyMatches = (githubKey: string, agentKey: SshPublicKey): boolean => {
	const components = githubKey.trim().split(/\s+/u);
	return (
		githubKey.trim() === agentKey.blob ||
		(components.at(0) === agentKey.algorithm && components.at(1) === agentKey.blob)
	);
};

const selectSigningKey = async (
	agentKeys: SshPublicKey[],
	githubKeys: GitHubSshSigningKey[],
): Promise<SshPublicKey> => {
	const configuredSigningKey = (
		await $`git config --file ${localGitConfigPath} user.signingkey`.quiet().nothrow().text()
	)
		.trim()
		.replace(/^key::/u, "");
	const configuredAgentKey = agentKeys.find(({ key }) => configuredSigningKey.startsWith(key));
	if (configuredAgentKey) {
		return configuredAgentKey;
	}
	const registeredAgentKeys = agentKeys.filter((agentKey) =>
		githubKeys.some(({ key }) => githubKeyMatches(key, agentKey)),
	);
	if (registeredAgentKeys.length === 1) {
		return registeredAgentKeys[0]!;
	}
	return await selectFromList(
		"Select the Bitwarden SSH key to use for Git signing.",
		agentKeys,
		({ algorithm, comment, fingerprint }) =>
			`${fingerprint} (${algorithm})${comment ? ` ${comment}` : ""}`,
	);
};

const addGitHubSigningKey = async (
	key: SshPublicKey,
	githubKeys: GitHubSshSigningKey[],
): Promise<void> => {
	if (githubKeys.some(({ key: githubKey }) => githubKeyMatches(githubKey, key))) {
		return;
	}
	const username = (await $`whoami`.text()).trim();
	const hostname = (await $`hostname`.text()).trim();
	await $`gh api /user/ssh_signing_keys --method POST --raw-field key=${key.key} --raw-field title=${`${username}@${hostname}`}`
		.env(envWithoutGitHubToken)
		.quiet();
	console.info("Added the SSH signing key to GitHub.");
};

const updateAllowedSigners = async (email: string, key: SshPublicKey): Promise<void> => {
	await mkdir(dirname(allowedSignersPath), { mode: 0o700, recursive: true });
	const existing = await readFile(allowedSignersPath, "utf8").catch((error: unknown) => {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return "";
		}
		throw error;
	});
	const entry = `${email} ${key.key}`;
	const lines = existing
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	if (!lines.includes(entry)) {
		lines.push(entry);
	}
	await writeFile(allowedSignersPath, `${lines.join("\n")}\n`, { mode: 0o600 });
	await chmod(allowedSignersPath, 0o600);
};

const configureGitSigning = async (): Promise<void> => {
	const email = (await $`git config user.email`.text()).trim();
	if (!email) {
		throw new Error("user.email is not set in git config");
	}
	const agentKeys = await getAgentKeys();
	const githubKeys = await ghApi<GitHubSshSigningKey[]>("/user/ssh_signing_keys");
	const key = await selectSigningKey(agentKeys, githubKeys);
	await addGitHubSigningKey(key, githubKeys);
	await updateAllowedSigners(email, key);
	await $`git config --file ${localGitConfigPath} user.signingkey ${`key::${key.key}`}`.quiet();
	console.info(`Configured Git to sign with ${key.fingerprint}.`);
};

const main = async (): Promise<void> => {
	const removeScopes = await ensureGitHubTokenScopes();

	try {
		await configureGitSigning();
	} finally {
		await removeScopes();
		// Reset gh config because it is formatted differently by gh cli
		const ghConfigPath = resolve(import.meta.dirname, "./home/.config/gh/config.yml");
		await $`git checkout -- ${ghConfigPath}`.cwd(resolve(import.meta.dirname, "..")).quiet();
	}
};
await main();
