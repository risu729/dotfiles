/* oxlint-disable import/no-named-export node/no-sync */

const run = (command: string[], check = true): string => {
	try {
		const result = Bun.spawnSync(command, { stderr: "ignore" });
		if (check && result.exitCode !== 0) {
			throw new Error(`${command.join(" ")} exited with ${result.exitCode}`);
		}
		return result.stdout.toString().trim();
	} catch (error) {
		if (check) {
			throw error;
		}
		return "";
	}
};

const runJson = <Result>(command: string[]): Result => JSON.parse(run(command)) as Result;

const runAsync = async (command: string[]): Promise<string> => {
	const spawned = Bun.spawn(command, { stderr: "ignore", stdout: "pipe" });
	const stdout = await new Response(spawned.stdout).text();
	const exitCode = await spawned.exited;
	if (exitCode !== 0) {
		throw new Error(`${command.join(" ")} exited with ${exitCode}`);
	}
	return stdout.trim();
};

const runJsonAsync = async <Result>(command: string[]): Promise<Result> =>
	JSON.parse(await runAsync(command)) as Result;

// Runs at most `limit` tasks concurrently, preserving input order in the result.
const mapPool = async <Item, Result>(
	items: Item[],
	limit: number,
	task: (item: Item) => Promise<Result>,
): Promise<Result[]> => {
	const results: Result[] = Array.from({ length: items.length });
	let cursor = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		for (;;) {
			const index = cursor;
			cursor += 1;
			const item = items[index];
			if (item === undefined) {
				return;
			}
			// oxlint-disable-next-line eslint/no-await-in-loop
			results[index] = await task(item);
		}
	});
	await Promise.all(workers);
	return results;
};

const normalizeRemote = (url: string): string => {
	let normalized = url
		.trim()
		.replace(/\/$/u, "")
		.replace(/\.git$/u, "");
	for (const prefix of ["https://github.com/", "git@github.com:", "ssh://git@github.com/"]) {
		if (normalized.startsWith(prefix)) {
			normalized = normalized.slice(prefix.length);
			break;
		}
	}
	return normalized;
};

export { mapPool, normalizeRemote, run, runAsync, runJson, runJsonAsync };
