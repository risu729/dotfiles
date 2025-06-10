#!/usr/bin/env bun

import { mkdtemp, rmdir } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { $, env, spawn, write } from "bun";

// remove GITHUB_TOKEN from env to avoid github cli using it
const envWithoutGitHubToken = Object.fromEntries(
	Object.entries(env).filter(([key]) => key !== "GITHUB_TOKEN"),
) as Record<string, string>;

const localGitConfigPath = (
	await $`git config --global include.path`.text()
).trim();

// do not use Partial as it sets all properties to optional but doesn't allow undefined
type DeepOptional<T> = {
	[P in keyof T]: T[P] extends (infer U)[]
		? DeepOptional<U>[] | undefined
		: T[P] extends object
			? DeepOptional<T[P]>
			: T[P] | undefined;
};

/**
 * @returns function to remove unnecessary granted scopes
 */
const ensureGitHubTokenScopes = async (): Promise<() => Promise<void>> => {
	const authWithBrowser = async (subcommand: string): Promise<void> => {
		// bun shell doesn't support reading from stdout and stderr while running a command
		// ref: https://github.com/oven-sh/bun/issues/14693
		const process = spawn(["gh", "auth", ...subcommand.split(" ")], {
			// default is "inherit" which just logs to the console
			// ref: https://bun.sh/docs/api/spawn#output-streams
			stderr: "pipe",
			env: envWithoutGitHubToken,
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
				// ref: https://github.com/cli/cli/blob/14d339d9ba87e87f34b7a25f00200a2062f87039/internal/authflow/flow.go#L58
				/First copy your one-time code: ([A-Z0-9-]+)/,
			)?.[1];
			if (oneTimeCode) {
				// copy one-time code to clipboard of Windows
				// don't use piping because clip.exe appends a trailing newline
				await $`clip.exe < ${Buffer.from(oneTimeCode)}`;
			}
			const url = text.match(
				// ref: https://github.com/cli/cli/blob/14d339d9ba87e87f34b7a25f00200a2062f87039/internal/authflow/flow.go#L71
				/Open this URL to continue in your web browser: (.+)/,
			)?.[1];
			if (url) {
				// open the url automatically in the Windows default browser
				await $`xdg-open ${url}`.nothrow();
			}
		}

		const exitCode = await process.exited;
		if (exitCode !== 0) {
			throw new Error(`Process exited with code ${exitCode}. ${output}`);
		}
	};

	// ref: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps
	const requiredScopes = [
		{
			// not included in the scopes granted by default in gh auth login
			scope: "workflow",
		},
		// allow read-only access
		{
			scope: "read:packages",
		},
		{
			scope: "read:project",
		},
		{
			// required to list, add, and delete GPG keys
			scope: "admin:gpg_key",
			removeAfterUse: true,
		},
		{
			// required to get user email
			scope: "user:email",
			generalScope: "user",
			removeAfterUse: true,
		},
	];

	const removeScopes = async (): Promise<void> => {
		// reset github token scopes to default for security
		console.info("Resetting GitHub token scopes...");
		// need to specify hostname in non-interactive mode
		await authWithBrowser(
			`refresh --hostname github.com --remove-scopes ${requiredScopes
				.filter(({ removeAfterUse }) => removeAfterUse)
				.map(({ scope }) => scope)
				.join(",")}`,
		);
	};

	// login to GitHub if not authenticated
	// cspell:ignore nothrow
	const { stdout, exitCode } = await $`gh auth status`
		.env(envWithoutGitHubToken)
		.quiet()
		.nothrow();
	if (exitCode !== 0) {
		await authWithBrowser(
			`login --web --git-protocol https --scopes ${requiredScopes.map(({ scope }) => scope).join(",")}`,
		);
		return removeScopes;
	}

	const scopes =
		stdout
			.toString()
			.match(/Token scopes:(.*)/)
			?.at(1)
			?.trim()
			.split(", ")
			.map((scope) => scope.replaceAll(/'/g, "")) ?? [];
	const missingScopes = requiredScopes
		.filter(
			({ scope, generalScope }) =>
				!(
					scopes.includes(scope) ||
					(generalScope && scopes.includes(generalScope))
				),
		)
		.map(({ scope }) => scope);
	if (missingScopes.length > 0) {
		console.info(
			`Missing GitHub token scopes: ${missingScopes.join(", ")}. Please authenticate with the required scopes.`,
		);
		// need to specify hostname in non-interactive mode
		await authWithBrowser(
			`refresh --hostname github.com --scopes ${missingScopes.join(",")}`,
		);
	}
	return removeScopes;
};

const ghApi = async <ReturnType>(
	endpoint: `/${string}`,
	method?: "POST" | "PUT" | "PATCH" | "DELETE",
	fields?: Record<string, string>,
): Promise<ReturnType> => {
	return await $`gh api ${endpoint} --header "Accept: application/vnd.github+json" --header "X-GitHub-Api-Version: 2022-11-28"${{
		// disable escapes
		raw: method ? ` --method ${method}` : "",
	}}${{
		raw: fields
			? Object.entries(fields)
					.map(([key, value]) => ` --raw-field "${key}=${value}"`)
					.join("")
			: "",
	}}`
		.env(envWithoutGitHubToken)
		.json();
};

// GitHub CLI does not support setting user.name and user.email automatically
// ref: https://github.com/cli/cli/issues/6096
const setGitUserConfig = async (): Promise<{
	githubId: string;
	email: string;
}> => {
	// user scope is not required to get name and email
	const { name, login } = await ghApi<{
		name: string | null;
		login: string;
	}>("/user");
	await $`git config --file ${localGitConfigPath} user.name ${name ?? login}`.quiet();

	const noReplyEmail = await ghApi<{ email: string }[]>("/user/emails").then(
		(emails) =>
			emails
				.map(({ email }) => email)
				.find((email) => email.endsWith("@users.noreply.github.com")),
	);
	if (!noReplyEmail) {
		throw new Error("Failed to get GitHub-provided no-reply email");
	}
	await $`git config --file ${localGitConfigPath} user.email ${noReplyEmail}`.quiet();
	return { githubId: login, email: noReplyEmail };
};

const createGhrConfig = async (githubId: string): Promise<void> => {
	const ghrHomeDir = (await $`ghr path`.text()).trim();
	if (!ghrHomeDir) {
		throw new Error("Failed to get ghr home directory");
	}
	const ghrConfigPath = resolve(ghrHomeDir, "ghr.toml");
	const ghrConfig = `defaults.owner = "${githubId}"`;
	await write(ghrConfigPath, ghrConfig);
};

// ref: https://github.com/gpg/gnupg/blob/master/doc/DETAILS#format-of-the-colon-listings
type KeyringSecretKey = {
	keyId: string;
	fingerprint: string;
	// cspell:ignore keygrip
	keygrip: string;
	curveName: string | null;
	userIds: {
		name: string;
		comment: string | null;
		email: string;
		hash: string;
		isRevoked: boolean;
	}[];
	// epoch timestamp
	createdAt: number;
	expiresAt: number | null;
	isRevoked: boolean;
	isSecretKeyAvailable: boolean;
	keyUsages: string[];
	isUltimatelyTrusted: boolean;
	// cspell:ignore subkeys
	subkeys: {
		keyId: string;
		fingerprint: string;
		keygrip: string;
		curveName: string | null;
		createdAt: number;
		expiresAt: number | null;
		isRevoked: boolean;
		isSecretKeyAvailable: boolean;
		keyUsages: string[];
	}[];
};

const getGpgKeyringSecretKeys = async (
	gpgHome?: string,
): Promise<KeyringSecretKey[]> => {
	// don't use piping because the latter command never throws errors
	// ref: https://github.com/oven-sh/bun/issues/13486
	const gpgStdout = await $`gpg --list-secret-keys --with-colons`
		.env({
			...env,
			...(gpgHome
				? {
						// biome-ignore lint/style/useNamingConvention:
						GNUPG_HOME: gpgHome,
					}
				: {}),
		})
		.arrayBuffer();
	const rawSecretKeys: {
		// ref: https://github.com/gpg/gnupg/blob/master/doc/DETAILS#format-of-the-colon-listings
		type: string;
		validity: string | null;
		// biome-ignore lint/style/useNamingConvention: following jc naming convention
		key_id: string | null;
		// biome-ignore lint/style/useNamingConvention:F
		creation_date: string | null;
		// biome-ignore lint/style/useNamingConvention:
		expiration_date: string | null;
		// cspell:ignore certsn uidhash trustinfo
		// biome-ignore lint/style/useNamingConvention:
		certsn_uidhash_trustinfo: string | null;
		// biome-ignore lint/style/useNamingConvention:
		owner_trust: string | null;
		// biome-ignore lint/style/useNamingConvention:
		user_id: string | null;
		// biome-ignore lint/style/useNamingConvention:
		key_capabilities: string | null;
		// biome-ignore lint/style/useNamingConvention:
		token_sn: string | null;
		// biome-ignore lint/style/useNamingConvention:
		curve_name: string | null;
	}[] =
		// jc freezes if empty buffer is passed
		gpgStdout.byteLength > 0 ? await $`jc --gpg < ${gpgStdout}`.json() : [];

	const keyringSecretKeys = rawSecretKeys.reduce<
		// allow undefined values for all properties
		DeepOptional<KeyringSecretKey>[]
		// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: the data structure is complex
	>((acc, key, index, array) => {
		// calculate common entries for sec, uid, ssb
		// already in epoch timestamp but in string
		const curveName = key.curve_name ?? undefined;
		const createdAt = key.creation_date
			? Number.parseInt(key.creation_date)
			: undefined;
		const expiresAt = key.expiration_date
			? Number.parseInt(key.expiration_date)
			: null;
		const isRevoked = key.validity === "r";
		const isSecretKeyAvailable = ["+", "#"].includes(key.token_sn ?? "")
			? key.token_sn === "+"
			: undefined;
		const keyUsages = key.key_capabilities
			? key.key_capabilities.split("").filter(
					// > the primary key has uppercase versions of the letters to denote the usable capabilities of the entire key
					// save only capabilities of the primary key itself
					(char) => char === char.toLowerCase(),
				)
			: // might be null if no capabilities
				[];

		if (key.type === "sec") {
			// add previous key to the list
			acc.push({
				keyId: key.key_id ?? undefined,
				fingerprint: undefined,
				keygrip: undefined,
				curveName,
				userIds: undefined,
				createdAt,
				expiresAt,
				isRevoked,
				isSecretKeyAvailable,
				keyUsages,
				isUltimatelyTrusted: key.owner_trust === "u",
				subkeys: undefined,
			});
			return acc;
		}
		const current = acc.at(-1);
		if (!current) {
			throw new Error(`${key.type} record found without sec record`);
		}
		switch (key.type) {
			case "uid": {
				if (current.userIds === undefined) {
					current.userIds = [];
				}
				const userId = key.user_id?.match(
					/(?<name>[^ ]+) (?:(?<comment>.+) )?<(?<email>.+)>/,
				);
				current.userIds.push({
					name: userId?.groups?.["name"],
					comment: userId?.groups?.["comment"] ?? null,
					email: userId?.groups?.["email"],
					hash: key.certsn_uidhash_trustinfo ?? undefined,
					isRevoked,
				});
				break;
			}
			case "ssb": {
				if (current.subkeys === undefined) {
					current.subkeys = [];
				}
				current.subkeys.push({
					keyId: key.key_id ?? undefined,
					fingerprint: undefined,
					keygrip: undefined,
					curveName,
					createdAt,
					expiresAt,
					isRevoked,
					isSecretKeyAvailable,
					keyUsages,
				});
				break;
			}
			case "fpr": {
				switch (array.at(index - 1)?.type) {
					case "sec": {
						current.fingerprint = key.user_id ?? undefined;
						break;
					}
					case "ssb": {
						// biome-ignore lint/style/noNonNullAssertion: subkeys exists if previous key type is ssb
						current.subkeys!.at(-1)!.fingerprint = key.user_id ?? undefined;
						break;
					}
					default:
				}
				break;
			}
			case "grp": {
				switch (array.at(index - 2)?.type) {
					case "sec": {
						current.keygrip = key.user_id ?? undefined;
						break;
					}
					case "ssb": {
						// biome-ignore lint/style/noNonNullAssertion: subkeys exists if previous key type is ssb
						current.subkeys!.at(-1)!.keygrip = key.user_id ?? undefined;
						break;
					}
					default:
				}
				break;
			}
			default:
		}
		return acc;
	}, []);

	const containsUndefined = (value: unknown): boolean => {
		if (value === undefined) {
			return true;
		}
		if (value === null || typeof value !== "object") {
			return false;
		}
		if (Array.isArray(value)) {
			return value.some((element) => containsUndefined(element));
		}
		return Object.values(value).some((property) => containsUndefined(property));
	};
	if (containsUndefined(keyringSecretKeys)) {
		throw new Error(
			`Failed to parse gpg secret key. Some properties are missing: \n${JSON.stringify(
				keyringSecretKeys,
				// print undefined values
				(_, value) => (value === undefined ? "__undefined" : value),
				2,
			)}`,
		);
	}
	return keyringSecretKeys as KeyringSecretKey[];
};

const askYesNo = async (prompt: string): Promise<boolean> => {
	console.info(`${prompt} [y/N]`);
	for await (const line of console) {
		if (line.trim().toLowerCase() === "y") {
			return true;
		}
		return false;
	}
	throw new Error("Unexpected end of input");
};

const selectFromList = async <T>(
	prompt: string,
	items: T[],
	formatItem: (item: T) => string,
): Promise<T | undefined> => {
	if (items.length === 0) {
		throw new Error("No items to select from");
	}
	if (items.length === 1) {
		return items.at(0);
	}
	console.info(`${prompt} Please select one by number:`);
	console.info(
		items
			.map(formatItem)
			.map((line, index) => `${index + 1}. ${line}`)
			.join("\n"),
	);
	for await (const line of console) {
		if (line.trim().toLowerCase() === "c") {
			return undefined;
		}
		const index = Number.parseInt(line.trim());
		if (Number.isNaN(index) || index < 1 || index > items.length) {
			console.error(
				"Invalid input. Please enter a number listed above. Enter C to cancel.",
			);
			continue;
		}
		return items.at(index - 1);
	}
	throw new Error("Unexpected end of input");
};

// ref: https://docs.github.com/en/rest/users/gpg-keys?apiVersion=2022-11-28#list-gpg-keys-for-the-authenticated-user
type GitHubGpgKey = {
	id: string;
	// biome-ignore lint/style/useNamingConvention: following API response naming
	key_id: string;
	name: string | null;
	// biome-ignore lint/style/useNamingConvention:
	created_at: string;
	// biome-ignore lint/style/useNamingConvention:
	expires_at: string | null;
	revoked: boolean | null;
	emails: { email: string }[];
	// biome-ignore lint/style/useNamingConvention:
	raw_key: string | null;
	subkeys: {
		id: string;
		// biome-ignore lint/style/useNamingConvention:
		key_id: string;
		// biome-ignore lint/style/useNamingConvention:
		created_at: string;
		// biome-ignore lint/style/useNamingConvention:
		expires_at: string | null;
		revoked: boolean | null;
	}[];
};

const importGpgSecretKey = async (
	prompt: string,
	importPredicate?: (key: KeyringSecretKey) => {
		continueImport: boolean;
		errorMessage: string;
	},
): Promise<
	| {
			importedKey: KeyringSecretKey;
			importedSecretKey: string;
	  }
	| undefined
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: no way to simplify the logic
> => {
	if (!(await askYesNo(prompt))) {
		return;
	}
	// retry until valid key is imported or canceled
	while (true) {
		console.info(
			"Paste the secret key in ASCII armor format. Enter 'quit' to cancel.",
		);
		const lines: string[] = [];
		for await (const line of console) {
			if (line === "-----END PGP PRIVATE KEY BLOCK-----") {
				break;
			}
			if (line.trim().toLowerCase() === "quit") {
				return;
			}
			lines.push(line);
		}
		if (lines.at(0) !== "-----BEGIN PGP PRIVATE KEY BLOCK-----") {
			console.error("Invalid secret key format.");
			continue;
		}
		// gpg --import requires the trailing newline
		const armor = `${lines.join("\n")}\n`;

		let tempDir: string | undefined;
		let fingerprint: string | undefined;
		try {
			// import in temp dir to get fingerprint of the key
			// if the key is merged, we cannot know which key is imported
			tempDir = await mkdtemp(join(tmpdir(), "dotfiles-"));
			// don't use piping because the latter command never throws errors
			// ref: https://github.com/oven-sh/bun/issues/13486
			await $`gpg --import < ${Buffer.from(armor)}`
				.env({
					...env,
					// biome-ignore lint/style/useNamingConvention:
					GNUPG_HOME: tempDir,
				})
				.quiet();
			const importedKey = (await getGpgKeyringSecretKeys(tempDir)).at(0);
			if (!importedKey) {
				console.error("Failed to import key");
				continue;
			}
			if (importedKey.isRevoked) {
				console.error("Imported key is already revoked");
				continue;
			}
			if (
				!(
					importedKey.isSecretKeyAvailable ||
					importedKey.subkeys.some(
						({ isSecretKeyAvailable }) => isSecretKeyAvailable,
					)
				)
			) {
				console.error("Imported key is not a secret key");
				continue;
			}
			const predicateResult = importPredicate?.(importedKey);
			if (predicateResult?.continueImport === false) {
				console.error(`${predicateResult.errorMessage} Import aborted.`);
				continue;
			}
			fingerprint = (await getGpgKeyringSecretKeys(tempDir)).at(0)?.fingerprint;
		} finally {
			if (tempDir) {
				await rmdir(tempDir);
			}
		}

		// don't use piping because the latter command never throws errors
		// ref: https://github.com/oven-sh/bun/issues/13486
		await $`gpg --import < ${Buffer.from(armor)}`;
		const importedKey = (await getGpgKeyringSecretKeys()).find(
			({ fingerprint: fpr }) => fpr === fingerprint,
		);
		if (!importedKey) {
			throw new Error("Failed to get imported key");
		}
		return {
			importedKey,
			importedSecretKey: armor,
		};
	}
};

const editGpgKey = async (
	fingerprint: string,
	commands: string[],
	inputs: string[],
): Promise<void> => {
	// --command-fd 0 to read input from stdin
	const command = `echo '${inputs.map((input) => `${input}\n`).join("")}' | gpg --command-fd 0 --edit-key ${fingerprint} ${commands.join(" ")} save`;
	// idk why but the result is not saved unless it is executed in bash
	await $`bash -euo pipefail < ${Buffer.from(command)}`.quiet();
};

const findExistingKeys = async (
	gitSigningKey: string | undefined,
	keyringSecretKeys: KeyringSecretKey[],
	githubKeys: GitHubGpgKey[],
): Promise<
	| {
			keyringSecretKey: KeyringSecretKey;
			// cspell:ignore subkey
			subkey?: KeyringSecretKey["subkeys"][number];
			githubKey?: GitHubGpgKey;
	  }
	| undefined
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: too many conditions to check
> => {
	// prioritize keys registered to github
	if (githubKeys.length > 0) {
		// if multiple keys registered, try to use current git config
		const currentGitHubKey = githubKeys.find(({ subkeys }) =>
			subkeys.some(({ key_id }) => `${key_id}!` === gitSigningKey),
		);
		if (currentGitHubKey) {
			const currentKeyringKey = keyringSecretKeys.find(({ subkeys }) =>
				subkeys.some(({ keyId }) => `${keyId}!` === gitSigningKey),
			);
			if (currentKeyringKey) {
				return {
					keyringSecretKey: currentKeyringKey,
					// biome-ignore lint/style/noNonNullAssertion: currentKeyringKey must contain the subkey if found
					subkey: currentKeyringKey.subkeys.find(
						({ keyId }) => `${keyId}!` === gitSigningKey,
					)!,
					githubKey: currentGitHubKey,
				};
			}
			console.warn(
				"GPG key registered to GitHub found in git config but not in keyring",
			);
			// do not import if the key does not contain the current git signing key
			const importedKey = await importGpgSecretKey(
				"Import GPG key currently set in git config to the keyring?",
				(key) => ({
					continueImport: key.subkeys.some(
						({ keyId }) => `${keyId}!` === gitSigningKey,
					),
					errorMessage: `Imported key (${key.keyId}) does not contain the current git signing key (${gitSigningKey})`,
				}),
			);
			if (importedKey) {
				return {
					keyringSecretKey: importedKey.importedKey,
					// biome-ignore lint/style/noNonNullAssertion: currentKeyringKey must contain the subkey if imported
					subkey: importedKey.importedKey.subkeys.find(
						({ keyId }) => `${keyId}!` === gitSigningKey,
					)!,
					githubKey: currentGitHubKey,
				};
			}
		}

		// ignore git config if not found in github keys or did not import the key
		// try to use other keys registered to github instead
		const githubKeysInKeyring = githubKeys
			.map((githubKey) => ({
				github: githubKey,
				keyring: keyringSecretKeys.find(
					({ keyId }) => keyId === githubKey.key_id,
				),
			}))
			.filter(
				(
					keys,
				): keys is typeof keys & {
					keyring: NonNullable<typeof keys.keyring>;
				} => keys.keyring !== undefined,
			);
		if (githubKeysInKeyring.length > 0) {
			const selectedKey = await selectFromList(
				"Multiple GPG keys registered to GitHub found in the keyring.",
				githubKeysInKeyring,
				// created_at in github api response is actually when the key is added to github
				({ github: { name, key_id, created_at } }) =>
					`${name} (${key_id}) - added at ${created_at}`,
			);
			if (selectedKey) {
				return {
					keyringSecretKey: selectedKey.keyring,
					githubKey: selectedKey.github,
				};
			}
		}

		// import keys registered to github to keyring
		console.info(
			"No GPG keys registered to GitHub found in the keyring (or none selected).",
		);
		// do not import if the key is not registered to github
		const importedKey = await importGpgSecretKey(
			"Import GPG keys registered to GitHub to the keyring?",
			(key) => ({
				continueImport: githubKeys.some(({ key_id }) => key.keyId === key_id),
				errorMessage: `Imported key (${key.keyId}) is not registered to GitHub`,
			}),
		);
		if (importedKey) {
			return {
				keyringSecretKey: importedKey.importedKey,
				// biome-ignore lint/style/noNonNullAssertion: key must be found if imported
				githubKey: githubKeys.find(
					({ key_id }) => importedKey.importedKey.keyId === key_id,
				)!,
			};
		}
	}

	// if no keys found in github or not imported, use keys in keyring
	if (keyringSecretKeys.length > 0) {
		console.info("No GPG keys in keyring are registered to GitHub.");
		if (
			await askYesNo(
				"Do you want to use a key from the keyring for signing commits?",
			)
		) {
			const selectedKey = await selectFromList(
				"Multiple GPG keys found in the keyring.",
				keyringSecretKeys,
				({ keyId, createdAt }) =>
					`${keyId} - created at ${new Date(createdAt).toISOString()}`,
			);
			if (selectedKey) {
				return {
					keyringSecretKey: selectedKey,
				};
			}
		}
	}

	// if no keys found in keyring or not selected, import a key to keyring
	const importedKey = await importGpgSecretKey(
		"Import a GPG key to the keyring?",
	);
	if (importedKey) {
		return {
			keyringSecretKey: importedKey.importedKey,
		};
	}

	// if no key is imported, return undefined
	return undefined;
};

const recommendedCurveName = "ed25519";

const refineGpgKey = async (
	initialKey: KeyringSecretKey,
	initialSubkey: KeyringSecretKey["subkeys"][number] | undefined,
	githubId: string,
	email: string,
): Promise<
	| {
			key: KeyringSecretKey;
			subkey: KeyringSecretKey["subkeys"][number];
			printSecretKey: boolean;
	  }
	| undefined
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: too many checks
> => {
	let key = initialKey;
	let subkey = initialSubkey;
	let printSecretKey = false;

	const ensureSecretKeyAvailable = async (reason: string): Promise<boolean> => {
		if (key.isSecretKeyAvailable) {
			return true;
		}
		console.info(
			`Primary secret key of the key ${key.keyId} is not available.`,
		);
		const importedKey = await importGpgSecretKey(
			`Import the key for ${reason}?`,
			(importedKey) => ({
				continueImport: importedKey.fingerprint === key.fingerprint,
				errorMessage: "Imported key mismatched.",
			}),
		);
		if (importedKey) {
			key = importedKey.importedKey;
			return true;
		}
		return false;
	};

	// need to be called after each operation that modifies the key
	const updateKey = async (modifiesSecretKey = true): Promise<void> => {
		const keyringSecretKeys = await getGpgKeyringSecretKeys();
		const updatedKey = keyringSecretKeys.find(
			({ fingerprint }) => fingerprint === key.fingerprint,
		);
		if (!updatedKey) {
			throw new Error("Failed to get updated key");
		}
		key = updatedKey;
		if (modifiesSecretKey) {
			printSecretKey = true;
		}
	};

	const addSubkey = async (): Promise<boolean> => {
		console.info("Adding a new subkey for signing...");
		if (!(await ensureSecretKeyAvailable("adding subkey"))) {
			return false;
		}
		await $`gpg --quick-add-key "${key.fingerprint}" ${recommendedCurveName} sign`.quiet();
		const oldSubkeyFingerprints = key.subkeys.map(
			({ fingerprint }) => fingerprint,
		);
		await updateKey();
		subkey = key.subkeys.find(
			({ fingerprint }) => !oldSubkeyFingerprints.includes(fingerprint),
		);
		if (!subkey) {
			throw new Error("Failed to get added subkey");
		}
		return true;
	};

	const signingSubkeys = ({
		allowNoSecretKey = false,
		allowExpired = false,
	} = {}): KeyringSecretKey["subkeys"] =>
		key.subkeys
			.filter(({ isRevoked }) => !isRevoked)
			// key usages can be changed by `--edit-key` but depends on the encryption algorithm
			// treat them as cannot be added to avoid handling supported usages of each algorithm
			.filter(({ keyUsages }) => keyUsages.includes("s"))
			.filter(
				({ isSecretKeyAvailable }) => allowNoSecretKey || isSecretKeyAvailable,
			)
			.filter(
				({ expiresAt }) => allowExpired || !expiresAt || expiresAt > Date.now(),
			);

	// ask to roll primary key first of all
	// suggest rolling primary key if curve is not using the recommended curve
	if (key.curveName !== recommendedCurveName) {
		console.warn(
			`Primary key is using ${key.curveName}. It is recommended to use ${recommendedCurveName}.`,
		);
		if (await askYesNo("Do you want to generate a new primary key?")) {
			return;
		}
	}

	// remove expire date if expired
	if (key.expiresAt && key.expiresAt < Date.now()) {
		console.warn("Key is expired. Remove the expire date to use the key.");
		if (!(await askYesNo("Do you want to remove the expire date?"))) {
			return;
		}
		if (!(await ensureSecretKeyAvailable("removing expire date"))) {
			return;
		}
		await $`gpg --quick-set-expire ${key.fingerprint} 0`.quiet();
		await updateKey();
	}

	// add uid if github no-reply email not included
	// don't revoke old uid as GitHub doesn't support revoked uid
	if (!key.userIds.some(({ email: uidEmail }) => uidEmail === email)) {
		console.info(
			`GPG key does not include the GitHub-provided no-reply email (${email}). Adding a new uid...`,
		);
		if (!(await ensureSecretKeyAvailable("adding user ID"))) {
			return;
		}
		await $`gpg --quick-add-uid ${key.fingerprint} "${githubId} <${email}>"`.quiet();
		await updateKey();
	}

	// if no subkeys for signing have secret keys, import one of them
	if (
		signingSubkeys({
			allowExpired: true,
		}).length === 0
	) {
		console.warn(
			"GPG key has subkeys for signing but none of their secret keys are available.",
		);
		const importedKey = await importGpgSecretKey(
			"Import a secret key?",
			(importedKey) => ({
				continueImport:
					importedKey.fingerprint === key.fingerprint &&
					importedKey.subkeys
						.filter(({ isRevoked }) => !isRevoked)
						.filter(({ keyUsages }) => keyUsages.includes("s"))
						.some(({ isSecretKeyAvailable }) => isSecretKeyAvailable),
				errorMessage:
					"Imported key mismatched or did not include secret subkey.",
			}),
		);
		if (importedKey) {
			key = importedKey.importedKey;
		}
	}

	// if all subkeys for signing are expired, must remove expire date or add new subkey
	if (signingSubkeys().length === 0) {
		console.warn(
			"All subkeys for signing are expired. Remove the expire date to use the key or add a new subkey.",
		);
		if (
			(await askYesNo("Do you want to remove the expire date?")) &&
			(await ensureSecretKeyAvailable("removing expire date"))
		) {
			await $`gpg --quick-set-expire "${key.fingerprint} 0 ${signingSubkeys()
				.map(({ fingerprint }) => fingerprint)
				.join(" ")}"`.quiet();
			await updateKey();
		}
	}

	// select subkey to use if subkeys for signing already exists
	const recommendedSubkeys = signingSubkeys()
		.filter(({ expiresAt }) => !expiresAt)
		.filter(({ curveName }) => curveName === recommendedCurveName)
		.filter(
			({ keyUsages }) => keyUsages.length === 1 && keyUsages.at(0) === "s",
		);
	// if current subkey is not one of recommended, ignore it
	if (
		!recommendedSubkeys.some(
			({ fingerprint }) => fingerprint === subkey?.fingerprint,
		)
	) {
		const unrecommendedSubkeys = signingSubkeys().filter(
			({ fingerprint }) =>
				!recommendedSubkeys
					.map(({ fingerprint }) => fingerprint)
					.includes(fingerprint),
		);
		// first suggest selecting from subkeys with recommended settings
		subkey =
			(await selectFromList(
				"Multiple subkeys for signing with recommended settings found.",
				recommendedSubkeys,
				({ keyId, createdAt }) =>
					`${keyId} - created at ${new Date(createdAt).toISOString()}`,
			)) ??
			(await selectFromList(
				"Multiple subkeys for signing found.",
				unrecommendedSubkeys,
				({ keyId, curveName, createdAt, keyUsages }) =>
					`${curveName}/${keyId} - created at ${new Date(createdAt).toISOString()} - ${keyUsages.join(", ")}`,
			));
	}

	// add subkey for signing if none available or not selected
	if (!subkey) {
		console.info(
			"GPG key does not have a subkey for signing. Adding a new subkey...",
		);
		if (!(await addSubkey())) {
			return;
		}
	}
	if (!subkey) {
		throw new Error("Failed to get subkey");
	}

	// below operations are optional and can be skipped

	// remove expire date if set
	if (key.expiresAt) {
		console.warn(
			"Primary key is set to expire. It is recommended to remove the expire date.",
		);
		if (
			(await askYesNo("Do you want to remove the expire date?")) &&
			(await ensureSecretKeyAvailable("removing expire date"))
		) {
			await $`gpg --quick-set-expire "${key.fingerprint} 0"`.quiet();
			await updateKey();
		}
	}

	// suggest rolling subkey if curve is not using the recommended curve
	if (subkey.curveName !== recommendedCurveName) {
		console.warn(
			`Subkey is using ${subkey.curveName}. It is recommended to use ${recommendedCurveName}.`,
		);
		if (await askYesNo("Do you want to generate a new subkey?")) {
			await addSubkey();
		}
	}

	// remove expire date if set
	if (subkey.expiresAt) {
		console.warn(
			"Subkey is set to expire. It is recommended to remove the expire date.",
		);
		if (
			(await askYesNo("Do you want to remove the expire date?")) &&
			(await ensureSecretKeyAvailable("removing expire date"))
		) {
			await $`gpg --quick-set-expire ${key.fingerprint} 0 ${subkey.fingerprint}`.quiet();
			await updateKey();
		}
	}

	// remove other key usages if set
	if (
		subkey.keyUsages.length !== 1 ||
		// must include sign but just in case
		subkey.keyUsages.at(0) !== "s"
	) {
		console.warn(
			`Subkey key usages include more than signing: ${subkey.keyUsages
				.filter((usage) => usage !== "s")
				.join(", ")}. It is not recommended to have other usages.`,
		);
		if (
			(await askYesNo("Do you want to remove other key usages?")) &&
			(await ensureSecretKeyAvailable("removing key usages"))
		) {
			await editGpgKey(
				key.fingerprint,
				[`key ${subkey.fingerprint}`, "change-usage"],
				[
					// toggle off other usages
					...subkey.keyUsages.filter((usage) => usage !== "s"),
					"q", // finish
				],
			);
			await updateKey();
		}
	}

	// revoke other subkeys
	if (key.subkeys.length > 1) {
		console.warn(
			"GPG key includes multiple subkeys. It is recommended to revoke other subkeys.",
		);
		if (
			(await askYesNo(
				"Do you want to revoke other subkeys? Commits associated with the subkeys remains verified.",
			)) &&
			(await ensureSecretKeyAvailable("removing subkeys"))
		) {
			const revokableSubkeys = key.subkeys
				.filter(({ isRevoked }) => !isRevoked)
				.filter(({ fingerprint }) => fingerprint !== subkey?.fingerprint);
			await editGpgKey(
				key.fingerprint,
				revokableSubkeys.flatMap(({ fingerprint }) => [
					`key ${fingerprint}`,
					// cspell:ignore revkey
					"revkey",
				]),
				revokableSubkeys.flatMap(() => [
					"y", // confirm revoke
					"3", // reason is no longer used
					"", // no detailed reason
					"y", // confirm reason
				]),
			);
		}
	}

	// remove other key usages if set
	if (
		key.keyUsages.length !== 1 ||
		// primary key always has cert capability but just in case
		key.keyUsages.at(0) !== "c"
	) {
		console.warn(
			`Primary key usages include more than certification: ${key.keyUsages
				.filter((usage) => usage !== "c")
				.join(", ")}. It is not recommended to have other usages.`,
		);
		if (
			(await askYesNo("Do you want to remove other key usages?")) &&
			(await ensureSecretKeyAvailable("removing key usages"))
		) {
			await editGpgKey(
				key.fingerprint,
				["change-usage"],
				[
					// toggle other usages
					...key.keyUsages.filter((usage) => usage !== "c"),
					"q", // finish
				],
			);
			await updateKey();
		}
	}

	// trust key if not trusted
	if (!key.isUltimatelyTrusted) {
		await editGpgKey(
			key.fingerprint,
			["trust"],
			[
				"5", // trust level ultimate
				"y", // confirm
			],
		);
		await updateKey(false);
	}

	return {
		key,
		subkey,
		printSecretKey,
	};
};

const generateGpgKey = async (
	githubId: string,
	email: string,
	oldKeyringSecretKeys: KeyringSecretKey[],
): Promise<KeyringSecretKey> => {
	console.info("Generating a new GPG key...");
	// only certify capability for primary key to generate subkey
	// expire date is set to 0 to disable expiration
	await $`gpg --quick-gen-key "${githubId} <${email}>" ${recommendedCurveName} cert 0`.quiet();
	const oldKeyIds = oldKeyringSecretKeys.map(({ keyId }) => keyId);
	const newKey = (await getGpgKeyringSecretKeys()).find(
		({ keyId }) => !oldKeyIds.includes(keyId),
	);
	if (!newKey) {
		throw new Error("Failed to get generated key");
	}
	return newKey;
};

const configureGitSign = async (
	githubId: string,
	email: string,
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: too many steps to configure
): Promise<void> => {
	if (env["GNUPG_HOME"]) {
		throw new Error("GNUPG_HOME is set. GnuPG home must be the default.");
	}

	// cspell:ignore signingkey
	const gitSigningKey = (
		await $`git config --file ${localGitConfigPath} user.signingkey`
			.nothrow()
			.text()
	).trim();
	const keyringSecretKeys = (await getGpgKeyringSecretKeys())
		// exclude if the key doesn't contain any secret keys to ignore imported public keys
		.filter(
			({ isSecretKeyAvailable, subkeys }) =>
				isSecretKeyAvailable ||
				subkeys.some(({ isSecretKeyAvailable }) => isSecretKeyAvailable),
		)
		// ignore revoked primary keys as they cannot be un-revoked
		.filter(({ isRevoked }) => !isRevoked);
	const githubKeys = async (): Promise<GitHubGpgKey[]> =>
		(await ghApi<GitHubGpgKey[]>("/user/gpg_keys"))
			// ignore revoked primary keys as they cannot be un-revoked
			.filter(({ revoked }) => !revoked);

	const existingKeys = await findExistingKeys(
		gitSigningKey,
		keyringSecretKeys,
		await githubKeys(),
	);
	let keyringKey = existingKeys?.keyringSecretKey
		? await refineGpgKey(
				existingKeys.keyringSecretKey,
				existingKeys?.subkey,
				githubId,
				email,
			)
		: undefined;
	let isKeyNew = false;
	// generate a new gpg key if refine aborted
	if (!keyringKey) {
		keyringKey = await refineGpgKey(
			await generateGpgKey(githubId, email, keyringSecretKeys),
			undefined,
			githubId,
			email,
		);
		isKeyNew = true;
	}
	if (!keyringKey) {
		throw new Error("Failed to get keyring key");
	}

	// add public key to github
	const activePublicKey = (
		await $`gpg --export --armor "${keyringKey.key.fingerprint}"`.text()
	).trim();
	// api response raw key includes a trailing blank line
	if (
		activePublicKey.trimEnd() !== existingKeys?.githubKey?.raw_key?.trimEnd()
	) {
		// github does not allow to add keys with the same key id, so delete first
		if (existingKeys?.githubKey) {
			await ghApi(`/user/gpg_keys/${existingKeys.githubKey.id}`, "DELETE");
		}
		const username = (await $`whoami`.text()).trim();
		const hostname = (await $`hostname`.text()).trim();
		await ghApi("/user/gpg_keys", "POST", {
			name: `${username}@${hostname}`,
			// biome-ignore lint/style/useNamingConvention: following API request naming
			armored_public_key: activePublicKey,
		});
	}

	// revoke other github keys
	const revokableGithubKeys = (await githubKeys())
		.filter(({ key_id }) => key_id !== keyringKey.key.keyId)
		.filter(({ revoked }) => !revoked);
	if (revokableGithubKeys.length > 0) {
		console.warn("Unrevoked old GPG key registered to GitHub found.");
		for (const githubKey of revokableGithubKeys) {
			if (
				!(await askYesNo(
					`Do you want to revoke the key ${githubKey.name} (${githubKey.key_id})?`,
				))
			) {
				break;
			}
			let keyringKey = (await getGpgKeyringSecretKeys()).find(
				({ keyId }) => keyId === githubKey.key_id,
			);
			if (!keyringKey?.isSecretKeyAvailable) {
				// revocation certificate only works when the public key is available
				if (
					keyringKey ||
					(await $`gpg --list-keys`.text()).includes(githubKey.key_id)
				) {
					const hasRevocationCertificate = await askYesNo(
						"Do you have the revocation certificate?",
					);
					if (hasRevocationCertificate) {
						console.info(
							"Paste the revocation certificate in ASCII armor format. Enter 'quit' to cancel.",
						);
						const lines: string[] = [];
						for await (const line of console) {
							if (line === "-----END PGP PRIVATE KEY BLOCK-----") {
								break;
							}
							if (line.trim().toLowerCase() === "quit") {
								return;
							}
							lines.push(line);
						}
						if (lines.at(0) !== "-----BEGIN PGP PRIVATE KEY BLOCK-----") {
							console.error("Invalid secret key format.");
							continue;
						}
						await $`gpg --import < ${Buffer.from(lines.join("\n"))}`.quiet();
						keyringKey = (await getGpgKeyringSecretKeys()).find(
							({ keyId }) => keyId === githubKey.key_id,
						);
					}
				}
				if (!keyringKey?.isRevoked) {
					keyringKey = (
						await importGpgSecretKey(
							`Import the secret key for ${githubKey.name} (${githubKey.key_id})?`,
							(importedKey) => ({
								continueImport:
									importedKey.keyId === githubKey.key_id &&
									importedKey.isSecretKeyAvailable,
								errorMessage: `Imported key (${importedKey.keyId}) mismatched or does not contain the secret key.`,
							}),
						)
					)?.importedKey;
				}
			}
			if (!keyringKey) {
				break;
			}
			await editGpgKey(
				keyringKey.fingerprint,
				["revkey"],
				[
					"y", // confirm revoke
					"3", // reason is no longer used
					"", // no detailed reason
					"y", // confirm reason
				],
			);
			await ghApi(`/user/gpg_keys/${githubKey.id}`, "DELETE");
			const publicKey = (
				await $`gpg --export --armor "${keyringKey.fingerprint}"`.text()
			).trim();
			const username = (await $`whoami`.text()).trim();
			const hostname = (await $`hostname`.text()).trim();
			await $`gh gpg-key add --title "${username}@${hostname}" < ${Buffer.from(publicKey)}`.quiet();
		}
	}

	// print secret primary key if imported key modified or new key generated
	if (keyringKey.printSecretKey || isKeyNew) {
		console.info(
			"Save the secret primary key to a secure location. This is removed from keyring automatically.",
		);
		console.info(
			await $`gpg --export-secret-key --armor "${keyringKey.key.fingerprint}"`.text(),
		);
	}

	if (keyringKey.key.isSecretKeyAvailable) {
		// revocation certificate is required to revoke the key if the secret key is lost
		const revocationCertificate =
			await $`gpg --command-fd 0 --gen-revoke ${keyringKey.key.fingerprint} < ${Buffer.from(
				[
					"y", // confirm revoke
					"3", // reason is no longer used
					"", // no detailed reason
					"y", // confirm reason
				]
					.map((input) => `${input}\n`)
					.join(""),
			)}`.text();
		if (!revocationCertificate) {
			throw new Error("Failed to generate revocation certificate");
		}
		console.info("Save the revocation certificate to a secure location.");
		console.info(revocationCertificate);
	}

	// delete secret primary key
	// primary key and subkeys have different keygrip
	await $`shred --remove --zero ${join(homedir(), ".gnupg", "private-keys-v1.d", `${keyringKey.key.keygrip}.key`)}`
		.quiet()
		// ignore error if the key is already deleted
		.nothrow();
	console.info("Deleted private primary key for security.");

	// if unset, git uses "user.name <user.email>" which is good
	// however, to clarify which subkey is used, specify the subkey id
	// don't use fingerprint because it cannot be retrieved from github api
	// ! is required to specify subkey as `--local-user` in gpg, which git uses internally
	await $`git config --file ${localGitConfigPath} user.signingkey ${keyringKey.subkey.fingerprint}!`.quiet();
};

const main = async (): Promise<void> => {
	const removeScopes = await ensureGitHubTokenScopes();

	try {
		const { githubId, email } = await setGitUserConfig();
		await createGhrConfig(githubId);
		await configureGitSign(githubId, email);
	} finally {
		await removeScopes();
	}

	// reset gh config because it is formatted differently by gh cli
	const ghConfigPath = resolve(
		import.meta.dirname,
		"./home/.config/gh/config.yml",
	);
	await $`git checkout -- ${ghConfigPath}`.cwd(
		resolve(import.meta.dirname, ".."),
	);
};
await main();
