// Mise 2026.9.12/14 reports deliberately uninstalled lazy tools as errors.
// Suppress only exact missing-tool errors for the effective lazy declaration;
// Project overrides, broken installs, other errors and all warnings still fail.
// Keep the fail-closed diagnostic flow together.
/* oxlint-disable eslint/max-statements */
type Version = { version: string; missing?: boolean };

const lazyErrors = async (name: string, versions: Version[]): Promise<string[]> => {
	const missing = versions.filter((version) => version.missing);
	if (!missing.length) {
		return [];
	}
	const result = Bun.spawn(["mise", "tool", name, "--json"], { stderr: "pipe", stdout: "pipe" });
	const output = await new Response(result.stdout).text();
	if ((await result.exited) !== 0) {
		return [];
	}
	const tool = JSON.parse(output);
	if (tool.tool_options?.lazy !== true) {
		return [];
	}
	return missing
		.filter((version) => tool.active_versions?.includes(version.version))
		.map(
			(version) =>
				`tool ${tool.backend}@${version.version} is not installed, install with \`mise install\``,
		);
};

const main = async (): Promise<void> => {
	const input = await Bun.stdin.text();
	const status = Number(process.argv[2]);
	const { warnings = [], errors = [], toolset = {} } = JSON.parse(input);
	if (status !== 0 && (status !== 1 || !errors.length)) {
		console.error(input.trimEnd());
		process.exit(1);
	}
	const expected = new Set(
		errors.length
			? (
					await Promise.all(
						Object.entries(toolset).map(([name, versions]) =>
							lazyErrors(name, versions as Version[]),
						),
					)
				).flat()
			: [],
	);
	const issues = [...warnings, ...errors.filter((error: string) => !expected.has(error))];
	for (const issue of issues) {
		console.error(issue);
	}
	process.exit(issues.length > 0 ? 1 : 0);
};
await main();
