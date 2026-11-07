/* oxlint-disable node/no-sync node/no-process-env vitest/prefer-importing-vitest-globals */
// Synchronous fixtures and isolated child environments keep planner tests deterministic.
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

type DotfilesConfig = {
	dotfiles: Record<string, unknown>;
	dotfile_groups?: Record<string, unknown>;
};
type RootConfig = DotfilesConfig & { settings: { dotfiles: Record<string, unknown> } };
type Selection = { os: string; profile: string; groups?: string[] };
type Redirect = { os: string; target: string };
const repo = resolve(import.meta.dir, "..");
const scratch = mkdtempSync(join(tmpdir(), "dotfiles-groups-"));
const target = join(scratch, "home").replaceAll("\\", "/");
const legacy = Bun.TOML.parse(
	readFileSync(join(import.meta.dir, "fixtures/dotfiles-legacy.toml"), "utf8"),
) as DotfilesConfig;
const current = Bun.TOML.parse(readFileSync(join(repo, "mise.toml"), "utf8")) as RootConfig;
const macos = Bun.TOML.parse(readFileSync(join(repo, "mise.macos.toml"), "utf8")) as DotfilesConfig;
const windows = Bun.TOML.parse(
	readFileSync(join(repo, "mise.windows.toml"), "utf8"),
) as DotfilesConfig;
const nativeOS =
	new Map([
		["darwin", "macos"],
		["win32", "windows"],
	]).get(process.platform) ?? "linux";
afterAll(() => rmSync(scratch, { force: true, recursive: true }));

// Redirect only destinations and OS selectors; keep actual source trees and declaration modes.
const redirect = (value: unknown, context: Redirect, key = ""): unknown => {
	if (typeof value === "string") {
		if (key === "os") {
			return value === context.os ? nativeOS : "inactive-test-os";
		}
		return value.startsWith("~/") ? value.replace("~", context.target) : value;
	}
	if (Array.isArray(value)) {
		return value.map((item) => redirect(item, context));
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([name, item]) => [
				name.startsWith("~/") ? name.replace("~", context.target) : name,
				redirect(item, context, name),
			]),
		);
	}
	return value;
};

const fixtureConfig = (config: DotfilesConfig, selection: Selection): string => {
	const normalized = redirect(
		{
			dotfiles: {
				...config.dotfiles,
				...(selection.os === "macos" ? macos.dotfiles : {}),
				// Preserve the former standalone Windows merge in the legacy comparison.
				...(selection.os === "windows" && config === legacy
					? { "~/.codex/config.toml/windows": { merge: true, source: "win/codex.toml" } }
					: {}),
			},
			settings: { dotfiles: current.settings.dotfiles, experimental: true },
			...(config.dotfile_groups
				? {
						dotfile_groups: {
							...config.dotfile_groups,
							...(selection.os === "windows" ? windows.dotfile_groups : {}),
						},
					}
				: {}),
			...(selection.groups ? { bootstrap: { dotfile_groups: selection.groups } } : {}),
		},
		{ os: selection.os, target },
	);
	const serialized = Bun.TOML.stringify(normalized);
	if (serialized === undefined) {
		throw new Error("Could not serialize fixture");
	}
	return serialized;
};

const makeFixture = (config: DotfilesConfig, selection: Selection): string => {
	const fixture = mkdtempSync(join(scratch, "plan-"));
	symlinkSync(
		join(repo, "unix"),
		join(fixture, "unix"),
		process.platform === "win32" ? "junction" : "dir",
	);
	symlinkSync(
		join(repo, "win"),
		join(fixture, "win"),
		process.platform === "win32" ? "junction" : "dir",
	);
	writeFileSync(join(fixture, "mise.toml"), fixtureConfig(config, selection));
	writeFileSync(join(fixture, "mise.personal.toml"), "");
	mkdirSync(join(fixture, "config"));
	mkdirSync(join(fixture, "nested"));
	return fixture;
};

// Discover mise.toml as project config so config_root templates keep the fixture root.
const fixtureEnv = (fixture: string, profile: string): Record<string, string | undefined> => ({
	...process.env,
	CI: "true",
	HOME: target,
	MISE_CACHE_DIR: join(fixture, "cache"),
	MISE_CONFIG_DIR: join(fixture, "config"),
	MISE_CONFIG_FILE: undefined,
	MISE_DATA_DIR: join(fixture, "data"),
	MISE_ENV: profile === "personal" ? "personal" : "",
	MISE_NO_AUTO_INSTALL: "1",
	MISE_STATE_DIR: join(fixture, "state"),
	MISE_SYSTEM_CONFIG_DIR: join(fixture, "config"),
	MISE_TRUSTED_CONFIG_PATHS: fixture,
	NO_COLOR: "1",
});

// Compare mise's actual planner. The nested cwd checks relative group-root resolution.
// Fixture destinations are temporary; no user files, install tasks, or hooks are changed.
const plan = (config: DotfilesConfig, selection: Selection): string[] => {
	const fixture = makeFixture(config, selection);
	const result = Bun.spawnSync(
		[
			process.env["TEST_MISE_BIN"] ?? "mise",
			"--cd",
			join(fixture, "nested"),
			"dotfiles",
			"apply",
			"--dry-run",
		],
		{ env: fixtureEnv(fixture, selection.profile) },
	);
	const output = result.stdout.toString() + result.stderr.toString();
	expect(result.exitCode, output).toBe(0);
	return output
		.split(/\r?\n/u)
		.map((line) =>
			line
				.trim()
				.replaceAll("\\", "/")
				.replaceAll("~/", `${target}/`)
				.replaceAll(fixture.replaceAll("\\", "/"), repo.replaceAll("\\", "/")),
		)
		.filter((line) => line.includes(target))
		.sort();
};

const selections = ["linux", "macos", "windows"].flatMap((os) =>
	["bare", "personal"].map((profile) => ({ os, profile })),
);

const planSelections = selections.map((selection) => ({
	linux: selection.os === "linux",
	name: `${selection.os}/${selection.profile}`,
	personal: selection.profile === "personal",
	pitchfork: selection.os === "linux" && selection.profile === "personal",
	selection,
}));

test.each(planSelections)(
	"$name retains every planned source, destination and mode",
	({ selection, personal, linux, pitchfork }) => {
		const before = plan(legacy, selection);
		const after = plan(current, selection);
		expect(before.length).toBeGreaterThan(10);
		expect(after).toEqual(
			[
				...before,
				`edit ${target}/.config/mise/miserc.local.toml (merge:profile) (if changed)`,
			].sort(),
		);
		expect(after.some((line) => line.includes("personal.gitconfig"))).toBe(personal);
		expect(after.some((line) => line.includes("mimeapps.list"))).toBe(linux);
		expect(after.some((line) => line.includes("pitchfork/"))).toBe(pitchfork);
		expect(after.some((line) => line.includes(".agents/skills/pr-tree"))).toBe(false);
		expect(after.some((line) => line.includes(".claude/skills/pr-tree"))).toBe(false);
	},
	20_000,
);

test("group selection retains standalone entries and excludes other groups", () => {
	const selected = plan(current, { groups: ["codex"], os: "linux", profile: "personal" });
	const copies = selected.filter((line) => line.startsWith("cp -r "));
	expect(copies).toHaveLength(0);
	expect(selected.some((line) => line.includes(".codex/* into"))).toBe(true);
	expect(selected.some((line) => line.includes(".config/* into"))).toBe(false);
	expect(selected.some((line) => line.includes(".claude/CLAUDE.md"))).toBe(true);
}, 20_000);

// Overrides belong to their groups, including templates, variants and partial edits.
const checkSelection = (selection: Selection): void => {
	for (const group of ["codex", "config", "ghr", "local"]) {
		const selected = plan(current, { ...selection, groups: [group] });
		const containsTarget = (suffix: string): boolean =>
			selected.some((line) => line.includes(target + suffix));
		expect(containsTarget("/.codex/config.toml")).toBe(group === "codex");
		for (const file of ["miserc.toml", "miserc.local.toml"]) {
			expect(containsTarget(`/.config/mise/${file}`)).toBe(group === "config");
			expect(containsTarget(`/.config/mise/${file}.tera`)).toBe(false);
		}
		expect(containsTarget("/.config/git/personal.gitconfig")).toBe(
			group === "config" && selection.profile === "personal",
		);
		expect(containsTarget("/.local/bin/code")).toBe(group === "local" && selection.os === "linux");
		expect(containsTarget("/.claude/CLAUDE.md")).toBe(true);
	}
};

test.each(selections)("$os/$profile selects complete groups", checkSelection, 30_000);

const apply = (fixture: string, profile: string): void => {
	const result = Bun.spawnSync(
		[
			process.env["TEST_MISE_BIN"] ?? "mise",
			"--cd",
			join(fixture, "nested"),
			"dot",
			"apply",
			"--yes",
		],
		{ env: fixtureEnv(fixture, profile) },
	);
	expect(result.exitCode, result.stdout.toString() + result.stderr.toString()).toBe(0);
};

const expectCodexConfig = (config: string): void => {
	const applied = Bun.TOML.parse(readFileSync(config, "utf8")) as Record<string, unknown>;
	expect(applied["local_state"]).toEqual({ keep: true });
	for (const source of ["unix/codex/config.toml", "unix/codex/mcp.toml"]) {
		const fragment = Bun.TOML.parse(readFileSync(join(repo, source), "utf8"));
		expect(applied).toMatchObject(fragment);
	}
};

test("Codex group merges preserve application state and apply twice", () => {
	const selection = { groups: ["codex"], os: "linux", profile: "bare" };
	const fixture = makeFixture(current, selection);
	const codexConfig = join(target, ".codex/config.toml");
	mkdirSync(join(target, ".codex"), { recursive: true });
	writeFileSync(codexConfig, "[local_state]\nkeep = true\n");
	for (let pass = 0; pass < 2; pass += 1) {
		apply(fixture, selection.profile);
		expectCodexConfig(codexConfig);
	}
}, 20_000);

const expectDiscovery = (env: readonly string[], localPath: string): void => {
	const shared = Bun.TOML.parse(
		readFileSync(join(target, ".config/mise/miserc.toml"), "utf8"),
	) as Record<string, unknown>;
	const localText = readFileSync(localPath, "utf8");
	const local = Bun.TOML.parse(localText) as Record<string, unknown>;
	expect(shared["env"]).toBeUndefined();
	expect(shared["auto_env"]).toBe(true);
	expect(local["env"]).toEqual(env);
	expect(local["ceiling_paths"]).toEqual(["/machine-boundary"]);
	expect(localText).toContain("# Keep this machine.");
};

test.each([
	{ env: [], profile: "bare" },
	{ env: ["personal"], profile: "personal" },
])(
	"config group renders discovery and preserves local settings for the $profile profile",
	({ env, profile }) => {
		const config = { ...current, dotfiles: {} };
		const fixture = makeFixture(config, { groups: ["config"], os: "linux", profile });
		const localPath = join(target, ".config/mise/miserc.local.toml");
		mkdirSync(join(target, ".config/mise"), { recursive: true });
		writeFileSync(
			localPath,
			'# Keep this machine.\nceiling_paths = ["/machine-boundary"]\nenv = ["old"]\n',
		);
		for (let pass = 0; pass < 2; pass += 1) {
			apply(fixture, profile);
			expectDiscovery(env, localPath);
		}
	},
	20_000,
);
