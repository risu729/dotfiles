#!/usr/bin/env bun
import { mkdtemp, rmdir } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { $, env, spawn, write } from "bun";
/* oxlint-disable eslint/complexity eslint/max-depth eslint/max-lines-per-function eslint/max-statements eslint/max-params eslint/no-await-in-loop */
// Remove GITHUB_TOKEN from env to avoid github cli using it
const envWithoutGitHubToken = Object.fromEntries(Object.entries(env).filter(([key]) => key !== "GITHUB_TOKEN"));
const localGitConfigPath = (await $ `git config --global include.path`.text()).trim();
/**
 * @returns {Promise<() => Promise<void>>} function to remove unnecessary granted scopes
 */
const ensureGitHubTokenScopes = async () => {
    const authWithBrowser = async (subcommand) => {
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
            /First copy your one-time code: ([A-Z0-9-]+)/)?.[1];
            if (oneTimeCode) {
                // Copy one-time code to clipboard of Windows
                // Don't use piping because clip.exe appends a trailing newline
                await $ `clip.exe < ${Buffer.from(oneTimeCode)}`;
            }
            const url = text.match(
            // Ref: https://github.com/cli/cli/blob/14d339d9ba87e87f34b7a25f00200a2062f87039/internal/authflow/flow.go#L71
            /Open this URL to continue in your web browser: (.+)/)?.[1];
            if (url) {
                // Open the url automatically in the Windows default browser
                await $ `xdg-open ${url}`.nothrow();
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
            // Required to list, add, and delete GPG keys
            scope: "admin:gpg_key",
        },
        {
            generalScope: "user",
            removeAfterUse: true,
            // Required to get user email
            scope: "user:email",
        },
    ];
    const removeScopes = async () => {
        // Reset github token scopes to default for security
        console.info("Resetting GitHub token scopes...");
        // Need to specify hostname in non-interactive mode
        await authWithBrowser(`refresh --hostname github.com --remove-scopes ${requiredScopes
            .filter(({ removeAfterUse }) => removeAfterUse)
            .map(({ scope }) => scope)
            .join(",")}`);
    };
    // Login to GitHub if not authenticated
    const { stdout, exitCode } = await $ `gh auth status`.env(envWithoutGitHubToken).quiet().nothrow();
    if (exitCode !== 0) {
        await authWithBrowser(`login --web --git-protocol https --scopes ${requiredScopes.map(({ scope }) => scope).join(",")}`);
        return removeScopes;
    }
    const scopes = stdout
        .toString()
        .match(/Token scopes:(.*)/)
        ?.at(1)
        ?.trim()
        .split(", ")
        .map((scope) => scope.replaceAll(/'/g, "")) ?? [];
    const missingScopes = requiredScopes
        .filter(({ scope, generalScope }) => !(scopes.includes(scope) || (generalScope && scopes.includes(generalScope))))
        .map(({ scope }) => scope);
    if (missingScopes.length > 0) {
        console.info(`Missing GitHub token scopes: ${missingScopes.join(", ")}. Please authenticate with the required scopes.`);
        // Need to specify hostname in non-interactive mode
        await authWithBrowser(`refresh --hostname github.com --scopes ${missingScopes.join(",")}`);
    }
    return removeScopes;
};
const ghApi = async (endpoint, method, fields) => await $ `gh api ${endpoint} --header "Accept: application/vnd.github+json" --header "X-GitHub-Api-Version: 2022-11-28"${{
    // Disable escapes
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
// GitHub CLI does not support setting user.name and user.email automatically
// Ref: https://github.com/cli/cli/issues/6096
const setGitUserConfig = async () => {
    // User scope is not required to get name and email
    const { name, login } = await ghApi("/user");
    await $ `git config --file ${localGitConfigPath} user.name ${name ?? login}`.quiet();
    const noReplyEmail = await ghApi("/user/emails").then((emails) => emails.map(({ email }) => email).find((email) => email.endsWith("@users.noreply.github.com")));
    if (!noReplyEmail) {
        throw new Error("Failed to get GitHub-provided no-reply email");
    }
    await $ `git config --file ${localGitConfigPath} user.email ${noReplyEmail}`.quiet();
    return { email: noReplyEmail, githubId: login };
};
const createGhrConfig = async (githubId) => {
    const ghrHomeDir = (await $ `ghr path`.text()).trim();
    if (!ghrHomeDir) {
        throw new Error("Failed to get ghr home directory");
    }
    const ghrConfigPath = resolve(ghrHomeDir, "ghr.toml");
    const ghrConfig = `defaults.owner = "${githubId}"`;
    await write(ghrConfigPath, ghrConfig);
};
const getGpgKeyringSecretKeys = async (gpgHome) => {
    // Don't use piping because the latter command never throws errors
    // Ref: https://github.com/oven-sh/bun/issues/13486
    const gpgStdout = await $ `gpg --list-secret-keys --with-colons`
        .env({
        ...env,
        ...(gpgHome
            ? {
                GNUPG_HOME: gpgHome,
            }
            : {}),
    })
        .arrayBuffer();
    const rawSecretKeys = 
    // Jc freezes if empty buffer is passed
    gpgStdout.byteLength > 0 ? await $ `jc --gpg < ${gpgStdout}`.json() : [];
    const keyringSecretKeys = rawSecretKeys.reduce((acc, key, index, array) => {
        // Calculate common entries for sec, uid, ssb
        // Already in epoch timestamp but in string
        const curveName = key.curve_name ?? undefined;
        const createdAt = key.creation_date ? Number.parseInt(key.creation_date, 10) : undefined;
        const expiresAt = key.expiration_date ? Number.parseInt(key.expiration_date, 10) : null;
        const isRevoked = key.validity === "r";
        const isSecretKeyAvailable = ["+", "#"].includes(key.token_sn ?? "")
            ? key.token_sn === "+"
            : undefined;
        const keyUsages = key.key_capabilities
            ? key.key_capabilities.split("").filter(
            // > the primary key has uppercase versions of the letters to denote the usable capabilities of the entire key
            // Save only capabilities of the primary key itself
            (char) => char === char.toLowerCase())
            : // Might be null if no capabilities
                [];
        if (key.type === "sec") {
            // Add previous key to the list
            acc.push({
                createdAt,
                curveName,
                expiresAt,
                fingerprint: undefined,
                isRevoked,
                isSecretKeyAvailable,
                isUltimatelyTrusted: key.owner_trust === "u",
                keyId: key.key_id ?? undefined,
                keyUsages,
                keygrip: undefined,
                subkeys: [],
                userIds: undefined,
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
                const userId = key.user_id?.match(/(?<name>[^ ]+) (?:(?<comment>.+) )?<(?<email>.+)>/);
                current.userIds.push({
                    comment: userId?.groups?.["comment"] ?? null,
                    email: userId?.groups?.["email"],
                    hash: key.certsn_uidhash_trustinfo ?? undefined,
                    isRevoked,
                    name: userId?.groups?.["name"],
                });
                break;
            }
            case "ssb": {
                if (current.subkeys === undefined) {
                    current.subkeys = [];
                }
                current.subkeys.push({
                    createdAt,
                    curveName,
                    expiresAt,
                    fingerprint: undefined,
                    isRevoked,
                    isSecretKeyAvailable,
                    keyId: key.key_id ?? undefined,
                    keyUsages,
                    keygrip: undefined,
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
                        current.subkeys.at(-1).fingerprint = key.user_id ?? undefined;
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
                        current.subkeys.at(-1).keygrip = key.user_id ?? undefined;
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
    const containsUndefined = (value) => {
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
        throw new Error(`Failed to parse gpg secret key. Some properties are missing: \n${JSON.stringify(keyringSecretKeys, 
        // Print undefined values
        (_, value) => (value === undefined ? "__undefined" : value), 2)}`);
    }
    return keyringSecretKeys;
};
const askYesNo = async (prompt) => {
    console.info(`${prompt} [y/N]`);
    for await (const line of console) {
        if (line.trim().toLowerCase() === "y") {
            return true;
        }
        return false;
    }
    throw new Error("Unexpected end of input");
};
const selectFromList = async (prompt, items, formatItem) => {
    if (items.length === 0) {
        throw new Error("No items to select from");
    }
    if (items.length === 1) {
        return items.at(0);
    }
    console.info(`${prompt} Please select one by number:`);
    console.info(items
        .map(formatItem)
        .map((line, index) => `${index + 1}. ${line}`)
        .join("\n"));
    for await (const line of console) {
        if (line.trim().toLowerCase() === "c") {
            return;
        }
        const index = Number.parseInt(line.trim(), 10);
        if (Number.isNaN(index) || index < 1 || index > items.length) {
            console.error("Invalid input. Please enter a number listed above. Enter C to cancel.");
            continue;
        }
        return items.at(index - 1);
    }
    throw new Error("Unexpected end of input");
};
const importGpgSecretKey = async (prompt, importPredicate) => {
    if (!(await askYesNo(prompt))) {
        return;
    }
    // Retry until valid key is imported or canceled
    while (true) {
        console.info("Paste the secret key in ASCII armor format. Enter 'quit' to cancel.");
        const lines = [];
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
        // Gpg --import requires the trailing newline
        const armor = `${lines.join("\n")}\n`;
        let tempDir = undefined;
        let fingerprint = undefined;
        try {
            // Import in temp dir to get fingerprint of the key
            // If the key is merged, we cannot know which key is imported
            tempDir = await mkdtemp(join(tmpdir(), "dotfiles-"));
            // Don't use piping because the latter command never throws errors
            // Ref: https://github.com/oven-sh/bun/issues/13486
            await $ `gpg --import < ${Buffer.from(armor)}`
                .env({
                ...env,
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
            if (!(importedKey.isSecretKeyAvailable ||
                importedKey.subkeys.some(({ isSecretKeyAvailable }) => isSecretKeyAvailable))) {
                console.error("Imported key is not a secret key");
                continue;
            }
            const predicateResult = importPredicate?.(importedKey);
            if (predicateResult?.continueImport === false) {
                console.error(`${predicateResult.errorMessage} Import aborted.`);
                continue;
            }
            fingerprint = (await getGpgKeyringSecretKeys(tempDir)).at(0)?.fingerprint;
        }
        finally {
            if (tempDir) {
                await rmdir(tempDir);
            }
        }
        // Don't use piping because the latter command never throws errors
        // Ref: https://github.com/oven-sh/bun/issues/13486
        await $ `gpg --import < ${Buffer.from(armor)}`;
        const importedKey = (await getGpgKeyringSecretKeys()).find(({ fingerprint: fpr }) => fpr === fingerprint);
        if (!importedKey) {
            throw new Error("Failed to get imported key");
        }
        return {
            importedKey,
            importedSecretKey: armor,
        };
    }
};
const editGpgKey = async (fingerprint, commands, inputs) => {
    // --command-fd 0 to read input from stdin
    const command = `echo '${inputs.map((input) => `${input}\n`).join("")}' | gpg --command-fd 0 --edit-key ${fingerprint} ${commands.join(" ")} save`;
    // Idk why but the result is not saved unless it is executed in bash
    await $ `bash -euo pipefail < ${Buffer.from(command)}`.quiet();
};
const findExistingKeys = async (gitSigningKey, keyringSecretKeys, githubKeys) => {
    // Prioritize keys registered to github
    if (githubKeys.length > 0) {
        // If multiple keys registered, try to use current git config
        const currentGitHubKey = githubKeys.find(({ subkeys }) => subkeys.some(({ key_id }) => `${key_id}!` === gitSigningKey));
        if (currentGitHubKey) {
            const currentKeyringKey = keyringSecretKeys.find(({ subkeys }) => subkeys.some(({ keyId }) => `${keyId}!` === gitSigningKey));
            if (currentKeyringKey) {
                return {
                    githubKey: currentGitHubKey,
                    keyringSecretKey: currentKeyringKey,
                    subkey: currentKeyringKey.subkeys.find(({ keyId }) => `${keyId}!` === gitSigningKey),
                };
            }
            console.warn("GPG key registered to GitHub found in git config but not in keyring");
            // Do not import if the key does not contain the current git signing key
            const importedKey = await importGpgSecretKey("Import GPG key currently set in git config to the keyring?", (key) => ({
                continueImport: key.subkeys.some(({ keyId }) => `${keyId}!` === gitSigningKey),
                errorMessage: `Imported key (${key.keyId}) does not contain the current git signing key (${gitSigningKey})`,
            }));
            if (importedKey) {
                return {
                    githubKey: currentGitHubKey,
                    keyringSecretKey: importedKey.importedKey,
                    subkey: importedKey.importedKey.subkeys.find(({ keyId }) => `${keyId}!` === gitSigningKey),
                };
            }
        }
        // Ignore git config if not found in github keys or did not import the key
        // Try to use other keys registered to github instead
        const githubKeysInKeyring = githubKeys
            .map((githubKey) => ({
            github: githubKey,
            keyring: keyringSecretKeys.find(({ keyId }) => keyId === githubKey.key_id),
        }))
            .filter((keys) => keys.keyring !== undefined);
        if (githubKeysInKeyring.length > 0) {
            const selectedKey = await selectFromList("Multiple GPG keys registered to GitHub found in the keyring.", githubKeysInKeyring, 
            // Created_at in github api response is actually when the key is added to github
            ({ github: { name, key_id, created_at } }) => `${name} (${key_id}) - added at ${created_at}`);
            if (selectedKey) {
                return {
                    githubKey: selectedKey.github,
                    keyringSecretKey: selectedKey.keyring,
                };
            }
        }
        // Import keys registered to github to keyring
        console.info("No GPG keys registered to GitHub found in the keyring (or none selected).");
        // Do not import if the key is not registered to github
        const importedKey = await importGpgSecretKey("Import GPG keys registered to GitHub to the keyring?", (key) => ({
            continueImport: githubKeys.some(({ key_id }) => key.keyId === key_id),
            errorMessage: `Imported key (${key.keyId}) is not registered to GitHub`,
        }));
        if (importedKey) {
            return {
                githubKey: githubKeys.find(({ key_id }) => importedKey.importedKey.keyId === key_id),
                keyringSecretKey: importedKey.importedKey,
            };
        }
    }
    // If no keys found in github or not imported, use keys in keyring
    if (keyringSecretKeys.length > 0) {
        console.info("No GPG keys in keyring are registered to GitHub.");
        if (await askYesNo("Do you want to use a key from the keyring for signing commits?")) {
            const selectedKey = await selectFromList("Multiple GPG keys found in the keyring.", keyringSecretKeys, ({ keyId, createdAt }) => `${keyId} - created at ${new Date(createdAt).toISOString()}`);
            if (selectedKey) {
                return {
                    keyringSecretKey: selectedKey,
                };
            }
        }
    }
    // If no keys found in keyring or not selected, import a key to keyring
    const importedKey = await importGpgSecretKey("Import a GPG key to the keyring?");
    if (importedKey) {
        return {
            keyringSecretKey: importedKey.importedKey,
        };
    }
    // If no key is imported, return undefined
    return;
};
const recommendedCurveName = "ed25519";
const refineGpgKey = async (initialKey, initialSubkey, githubId, email) => {
    let key = initialKey;
    let subkey = initialSubkey;
    let printSecretKey = false;
    const ensureSecretKeyAvailable = async (reason) => {
        if (key.isSecretKeyAvailable) {
            return true;
        }
        console.info(`Primary secret key of the key ${key.keyId} is not available.`);
        const importedKey = await importGpgSecretKey(`Import the key for ${reason}?`, (importedGpgKey) => ({
            continueImport: importedGpgKey.fingerprint === key.fingerprint,
            errorMessage: "Imported key mismatched.",
        }));
        if (importedKey) {
            key = importedKey.importedKey;
            return true;
        }
        return false;
    };
    // Need to be called after each operation that modifies the key
    const updateKey = async (modifiesSecretKey = true) => {
        const keyringSecretKeys = await getGpgKeyringSecretKeys();
        const updatedKey = keyringSecretKeys.find(({ fingerprint }) => fingerprint === key.fingerprint);
        if (!updatedKey) {
            throw new Error("Failed to get updated key");
        }
        key = updatedKey;
        if (modifiesSecretKey) {
            printSecretKey = true;
        }
    };
    const addSubkey = async () => {
        console.info("Adding a new subkey for signing...");
        if (!(await ensureSecretKeyAvailable("adding subkey"))) {
            return false;
        }
        await $ `gpg --quick-add-key "${key.fingerprint}" ${recommendedCurveName} sign`.quiet();
        const oldSubkeyFingerprints = key.subkeys.map(({ fingerprint }) => fingerprint);
        await updateKey();
        subkey = key.subkeys.find(({ fingerprint }) => !oldSubkeyFingerprints.includes(fingerprint));
        if (!subkey) {
            throw new Error("Failed to get added subkey");
        }
        return true;
    };
    const signingSubkeys = ({ allowNoSecretKey = false, allowExpired = false, } = {}) => key.subkeys
        .filter(({ isRevoked }) => !isRevoked)
        // Key usages can be changed by `--edit-key` but depends on the encryption algorithm
        // Treat them as cannot be added to avoid handling supported usages of each algorithm
        .filter(({ keyUsages }) => keyUsages.includes("s"))
        .filter(({ isSecretKeyAvailable }) => allowNoSecretKey || isSecretKeyAvailable)
        .filter(({ expiresAt }) => allowExpired || !expiresAt || expiresAt > Date.now());
    // Ask to roll primary key first of all
    // Suggest rolling primary key if curve is not using the recommended curve
    if (key.curveName !== recommendedCurveName) {
        console.warn(`Primary key is using ${key.curveName}. It is recommended to use ${recommendedCurveName}.`);
        if (await askYesNo("Do you want to generate a new primary key?")) {
            return;
        }
    }
    // Remove expire date if expired
    if (key.expiresAt && key.expiresAt < Date.now()) {
        console.warn("Key is expired. Remove the expire date to use the key.");
        if (!(await askYesNo("Do you want to remove the expire date?"))) {
            return;
        }
        if (!(await ensureSecretKeyAvailable("removing expire date"))) {
            return;
        }
        await $ `gpg --quick-set-expire ${key.fingerprint} 0`.quiet();
        await updateKey();
    }
    // Add uid if github no-reply email not included
    // Don't revoke old uid as GitHub doesn't support revoked uid
    if (!key.userIds.some(({ email: uidEmail }) => uidEmail === email)) {
        console.info(`GPG key does not include the GitHub-provided no-reply email (${email}). Adding a new uid...`);
        if (!(await ensureSecretKeyAvailable("adding user ID"))) {
            return;
        }
        await $ `gpg --quick-add-uid ${key.fingerprint} "${githubId} <${email}>"`.quiet();
        await updateKey();
    }
    // If no subkeys for signing have secret keys, import one of them
    if (signingSubkeys({
        allowExpired: true,
    }).length === 0) {
        console.warn("GPG key has subkeys for signing but none of their secret keys are available.");
        const importedKey = await importGpgSecretKey("Import a secret key?", (importedGpgKey) => ({
            continueImport: importedGpgKey.fingerprint === key.fingerprint &&
                importedGpgKey.subkeys
                    .filter(({ isRevoked }) => !isRevoked)
                    .filter(({ keyUsages }) => keyUsages.includes("s"))
                    .some(({ isSecretKeyAvailable }) => isSecretKeyAvailable),
            errorMessage: "Imported key mismatched or did not include secret subkey.",
        }));
        if (importedKey) {
            key = importedKey.importedKey;
        }
    }
    // If all subkeys for signing are expired, must remove expire date or add new subkey
    if (signingSubkeys().length === 0) {
        console.warn("All subkeys for signing are expired. Remove the expire date to use the key or add a new subkey.");
        if ((await askYesNo("Do you want to remove the expire date?")) &&
            (await ensureSecretKeyAvailable("removing expire date"))) {
            await $ `gpg --quick-set-expire "${key.fingerprint} 0 ${signingSubkeys()
                .map(({ fingerprint }) => fingerprint)
                .join(" ")}"`.quiet();
            await updateKey();
        }
    }
    // Select subkey to use if subkeys for signing already exists
    const recommendedSubkeys = signingSubkeys()
        .filter(({ expiresAt }) => !expiresAt)
        .filter(({ curveName }) => curveName === recommendedCurveName)
        .filter(({ keyUsages }) => keyUsages.length === 1 && keyUsages.at(0) === "s");
    // If current subkey is not one of recommended, ignore it
    if (!recommendedSubkeys.some(({ fingerprint }) => fingerprint === subkey?.fingerprint)) {
        const unrecommendedSubkeys = signingSubkeys().filter(({ fingerprint }) => !recommendedSubkeys
            .map((unrecommendedSubkey) => unrecommendedSubkey.fingerprint)
            .includes(fingerprint));
        // First suggest selecting from subkeys with recommended settings
        subkey =
            (await selectFromList("Multiple subkeys for signing with recommended settings found.", recommendedSubkeys, ({ keyId, createdAt }) => `${keyId} - created at ${new Date(createdAt).toISOString()}`)) ??
                (await selectFromList("Multiple subkeys for signing found.", unrecommendedSubkeys, ({ keyId, curveName, createdAt, keyUsages }) => `${curveName}/${keyId} - created at ${new Date(createdAt).toISOString()} - ${keyUsages.join(", ")}`));
    }
    // Add subkey for signing if none available or not selected
    if (!subkey) {
        console.info("GPG key does not have a subkey for signing. Adding a new subkey...");
        if (!(await addSubkey())) {
            return;
        }
    }
    if (!subkey) {
        throw new Error("Failed to get subkey");
    }
    // Below operations are optional and can be skipped
    // Remove expire date if set
    if (key.expiresAt) {
        console.warn("Primary key is set to expire. It is recommended to remove the expire date.");
        if ((await askYesNo("Do you want to remove the expire date?")) &&
            (await ensureSecretKeyAvailable("removing expire date"))) {
            await $ `gpg --quick-set-expire "${key.fingerprint} 0"`.quiet();
            await updateKey();
        }
    }
    // Suggest rolling subkey if curve is not using the recommended curve
    if (subkey.curveName !== recommendedCurveName) {
        console.warn(`Subkey is using ${subkey.curveName}. It is recommended to use ${recommendedCurveName}.`);
        if (await askYesNo("Do you want to generate a new subkey?")) {
            await addSubkey();
        }
    }
    // Remove expire date if set
    if (subkey.expiresAt) {
        console.warn("Subkey is set to expire. It is recommended to remove the expire date.");
        if ((await askYesNo("Do you want to remove the expire date?")) &&
            (await ensureSecretKeyAvailable("removing expire date"))) {
            await $ `gpg --quick-set-expire ${key.fingerprint} 0 ${subkey.fingerprint}`.quiet();
            await updateKey();
        }
    }
    // Remove other key usages if set
    if (subkey.keyUsages.length !== 1 ||
        // Must include sign but just in case
        subkey.keyUsages.at(0) !== "s") {
        console.warn(`Subkey key usages include more than signing: ${subkey.keyUsages
            .filter((usage) => usage !== "s")
            .join(", ")}. It is not recommended to have other usages.`);
        if ((await askYesNo("Do you want to remove other key usages?")) &&
            (await ensureSecretKeyAvailable("removing key usages"))) {
            await editGpgKey(key.fingerprint, [`key ${subkey.fingerprint}`, "change-usage"], [
                // Toggle off other usages
                ...subkey.keyUsages.filter((usage) => usage !== "s"),
                "q", // Finish
            ]);
            await updateKey();
        }
    }
    // Revoke other subkeys
    if (key.subkeys.length > 1) {
        console.warn("GPG key includes multiple subkeys. It is recommended to revoke other subkeys.");
        if ((await askYesNo("Do you want to revoke other subkeys? Commits associated with the subkeys remains verified.")) &&
            (await ensureSecretKeyAvailable("removing subkeys"))) {
            const revokableSubkeys = key.subkeys
                .filter(({ isRevoked }) => !isRevoked)
                .filter(({ fingerprint }) => fingerprint !== subkey?.fingerprint);
            await editGpgKey(key.fingerprint, revokableSubkeys.flatMap(({ fingerprint }) => [`key ${fingerprint}`, "revkey"]), revokableSubkeys.flatMap(() => [
                "y", // Confirm revoke
                "3", // Reason is no longer used
                "", // No detailed reason
                "y", // Confirm reason
            ]));
        }
    }
    // Remove other key usages if set
    if (key.keyUsages.length !== 1 ||
        // Primary key always has cert capability but just in case
        key.keyUsages.at(0) !== "c") {
        console.warn(`Primary key usages include more than certification: ${key.keyUsages
            .filter((usage) => usage !== "c")
            .join(", ")}. It is not recommended to have other usages.`);
        if ((await askYesNo("Do you want to remove other key usages?")) &&
            (await ensureSecretKeyAvailable("removing key usages"))) {
            await editGpgKey(key.fingerprint, ["change-usage"], [
                // Toggle other usages
                ...key.keyUsages.filter((usage) => usage !== "c"),
                "q", // Finish
            ]);
            await updateKey();
        }
    }
    // Trust key if not trusted
    if (!key.isUltimatelyTrusted) {
        await editGpgKey(key.fingerprint, ["trust"], [
            "5", // Trust level ultimate
            "y", // Confirm
        ]);
        await updateKey(false);
    }
    return {
        key,
        printSecretKey,
        subkey,
    };
};
const generateGpgKey = async (githubId, email, oldKeyringSecretKeys) => {
    console.info("Generating a new GPG key...");
    // Only certify capability for primary key to generate subkey
    // Expire date is set to 0 to disable expiration
    await $ `gpg --quick-gen-key "${githubId} <${email}>" ${recommendedCurveName} cert 0`.quiet();
    const oldKeyIds = oldKeyringSecretKeys.map(({ keyId }) => keyId);
    const newKey = (await getGpgKeyringSecretKeys()).find(({ keyId }) => !oldKeyIds.includes(keyId));
    if (!newKey) {
        throw new Error("Failed to get generated key");
    }
    return newKey;
};
const configureGitSign = async (githubId, email) => {
    if (env["GNUPG_HOME"]) {
        throw new Error("GNUPG_HOME is set. GnuPG home must be the default.");
    }
    const gitSigningKey = (await $ `git config --file ${localGitConfigPath} user.signingkey`.nothrow().text()).trim();
    const keyringSecretKeys = (await getGpgKeyringSecretKeys())
        // Exclude if the key doesn't contain any secret keys to ignore imported public keys
        .filter(({ isSecretKeyAvailable, subkeys }) => isSecretKeyAvailable || subkeys.some((subkey) => subkey.isSecretKeyAvailable))
        // Ignore revoked primary keys as they cannot be un-revoked
        .filter(({ isRevoked }) => !isRevoked);
    const githubKeys = async () => (await ghApi("/user/gpg_keys"))
        // Ignore revoked primary keys as they cannot be un-revoked
        .filter(({ revoked }) => !revoked);
    const existingKeys = await findExistingKeys(gitSigningKey, keyringSecretKeys, await githubKeys());
    let keyringKey = existingKeys?.keyringSecretKey
        ? await refineGpgKey(existingKeys.keyringSecretKey, existingKeys?.subkey, githubId, email)
        : undefined;
    let isKeyNew = false;
    // Generate a new gpg key if refine aborted
    if (!keyringKey) {
        keyringKey = await refineGpgKey(await generateGpgKey(githubId, email, keyringSecretKeys), undefined, githubId, email);
        isKeyNew = true;
    }
    if (!keyringKey) {
        throw new Error("Failed to get keyring key");
    }
    // Add public key to github
    const activePublicKey = (await $ `gpg --export --armor "${keyringKey.key.fingerprint}"`.text()).trim();
    // Api response raw key includes a trailing blank line
    if (activePublicKey.trimEnd() !== existingKeys?.githubKey?.raw_key?.trimEnd()) {
        // Github does not allow to add keys with the same key id, so delete first
        if (existingKeys?.githubKey) {
            await ghApi(`/user/gpg_keys/${existingKeys.githubKey.id}`, "DELETE");
        }
        const username = (await $ `whoami`.text()).trim();
        const hostname = (await $ `hostname`.text()).trim();
        await ghApi("/user/gpg_keys", "POST", {
            armored_public_key: activePublicKey,
            name: `${username}@${hostname}`,
        });
    }
    // Revoke other github keys
    const revokableGithubKeys = (await githubKeys())
        .filter(({ key_id }) => key_id !== keyringKey.key.keyId)
        .filter(({ revoked }) => !revoked);
    if (revokableGithubKeys.length > 0) {
        console.warn("Unrevoked old GPG key registered to GitHub found.");
        for (const githubKey of revokableGithubKeys) {
            if (!(await askYesNo(`Do you want to revoke the key ${githubKey.name} (${githubKey.key_id})?`))) {
                break;
            }
            let keyringRevokableKey = (await getGpgKeyringSecretKeys()).find(({ keyId }) => keyId === githubKey.key_id);
            if (!keyringRevokableKey?.isSecretKeyAvailable) {
                // Revocation certificate only works when the public key is available
                if (keyringRevokableKey || (await $ `gpg --list-keys`.text()).includes(githubKey.key_id)) {
                    const hasRevocationCertificate = await askYesNo("Do you have the revocation certificate?");
                    if (hasRevocationCertificate) {
                        console.info("Paste the revocation certificate in ASCII armor format. Enter 'quit' to cancel.");
                        const lines = [];
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
                        await $ `gpg --import < ${Buffer.from(lines.join("\n"))}`.quiet();
                        keyringRevokableKey = (await getGpgKeyringSecretKeys()).find(({ keyId }) => keyId === githubKey.key_id);
                    }
                }
                if (!keyringRevokableKey?.isRevoked) {
                    keyringRevokableKey = (await importGpgSecretKey(`Import the secret key for ${githubKey.name} (${githubKey.key_id})?`, (importedKey) => ({
                        continueImport: importedKey.keyId === githubKey.key_id && importedKey.isSecretKeyAvailable,
                        errorMessage: `Imported key (${importedKey.keyId}) mismatched or does not contain the secret key.`,
                    })))?.importedKey;
                }
            }
            if (!keyringRevokableKey) {
                break;
            }
            await editGpgKey(keyringRevokableKey.fingerprint, ["revkey"], [
                "y", // Confirm revoke
                "3", // Reason is no longer used
                "", // No detailed reason
                "y", // Confirm reason
            ]);
            await ghApi(`/user/gpg_keys/${githubKey.id}`, "DELETE");
            const publicKey = (await $ `gpg --export --armor "${keyringRevokableKey.fingerprint}"`.text()).trim();
            const username = (await $ `whoami`.text()).trim();
            const hostname = (await $ `hostname`.text()).trim();
            await $ `gh gpg-key add --title "${username}@${hostname}" < ${Buffer.from(publicKey)}`.quiet();
        }
    }
    // Print secret primary key if imported key modified or new key generated
    if (keyringKey.printSecretKey || isKeyNew) {
        console.info("Save the secret primary key to a secure location. This is removed from keyring automatically.");
        console.info(await $ `gpg --export-secret-key --armor "${keyringKey.key.fingerprint}"`.text());
    }
    if (keyringKey.key.isSecretKeyAvailable) {
        // Revocation certificate is required to revoke the key if the secret key is lost
        const revocationCertificate = await $ `gpg --command-fd 0 --gen-revoke ${keyringKey.key.fingerprint} < ${Buffer.from([
            "y", // Confirm revoke
            "3", // Reason is no longer used
            "", // No detailed reason
            "y", // Confirm reason
        ]
            .map((input) => `${input}\n`)
            .join(""))}`.text();
        if (!revocationCertificate) {
            throw new Error("Failed to generate revocation certificate");
        }
        console.info("Save the revocation certificate to a secure location.");
        console.info(revocationCertificate);
    }
    // Delete secret primary key
    // Primary key and subkeys have different keygrip
    await $ `shred --remove --zero ${join(homedir(), ".gnupg", "private-keys-v1.d", `${keyringKey.key.keygrip}.key`)}`
        .quiet()
        // Ignore error if the key is already deleted
        .nothrow();
    console.info("Deleted private primary key for security.");
    // If unset, git uses "user.name <user.email>" which is good
    // However, to clarify which subkey is used, specify the subkey id
    // Don't use fingerprint because it cannot be retrieved from github api
    // ! is required to specify subkey as `--local-user` in gpg, which git uses internally
    await $ `git config --file ${localGitConfigPath} user.signingkey ${keyringKey.subkey.fingerprint}!`.quiet();
};
const main = async () => {
    const removeScopes = await ensureGitHubTokenScopes();
    try {
        const { githubId, email } = await setGitUserConfig();
        await createGhrConfig(githubId);
        await configureGitSign(githubId, email);
    }
    finally {
        await removeScopes();
        // Reset gh config because it is formatted differently by gh cli
        const ghConfigPath = resolve(import.meta.dirname, "./home/.config/gh/config.yml");
        await $ `git checkout -- ${ghConfigPath}`.cwd(resolve(import.meta.dirname, ".."));
    }
};
await main();
