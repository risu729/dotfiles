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
			dotfiles: { ...config.dotfiles, ...(selection.os === "macos" ? macos.dotfiles : {}) },
			settings: { dotfiles: current.settings.dotfiles, experimental: true },
			...(config.dotfile_groups ? { dotfile_groups: config.dotfile_groups } : {}),
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
	writeFileSync(join(fixture, "mise.toml"), fixtureConfig(config, selection));
	writeFileSync(join(fixture, "mise.personal.toml"), "");
	mkdirSync(join(fixture, "config"));
	mkdirSync(join(fixture, "nested"));
	return fixture;
};

const fixtureEnv = (fixture: string, profile: string): Record<string, string | undefined> => ({
	...process.env,
	CI: "true",
	MISE_CACHE_DIR: join(fixture, "cache"),
	MISE_CONFIG_DIR: join(fixture, "config"),
	MISE_CONFIG_FILE: join(fixture, "mise.toml"),
	MISE_DATA_DIR: join(fixture, "data"),
	MISE_ENV: profile === "personal" ? "personal" : "",
	MISE_NO_AUTO_INSTALL: "1",
	MISE_STATE_DIR: join(fixture, "state"),
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
				.replaceAll(fixture.replaceAll("\\", "/"), repo.replaceAll("\\", "/")),
		)
		.filter((line) => line.includes(target))
		.sort();
};

test.each([
	{
		linux: true,
		name: "linux/bare",
		personal: false,
		pitchfork: false,
		selection: { os: "linux", profile: "bare" },
	},
	{
		linux: true,
		name: "linux/personal",
		personal: true,
		pitchfork: true,
		selection: { os: "linux", profile: "personal" },
	},
	{
		linux: false,
		name: "macos/bare",
		personal: false,
		pitchfork: false,
		selection: { os: "macos", profile: "bare" },
	},
	{
		linux: false,
		name: "macos/personal",
		personal: true,
		pitchfork: false,
		selection: { os: "macos", profile: "personal" },
	},
] as const)(
	"$name retains every planned source, destination and mode",
	({ selection, personal, linux, pitchfork }) => {
		const before = plan(legacy, selection);
		const after = plan(current, selection);
		expect(before.length).toBeGreaterThan(10);
		expect(after).toEqual(before);
		expect(after.some((line) => line.includes("personal.gitconfig"))).toBe(personal);
		expect(after.some((line) => line.includes("mimeapps.list"))).toBe(linux);
		expect(after.some((line) => line.includes("pitchfork/"))).toBe(pitchfork);
	},
	20_000,
);

test("group selection retains standalone entries and excludes other groups", () => {
	const selected = plan(current, { groups: ["agents"], os: "linux", profile: "personal" });
	const copies = selected.filter((line) => line.startsWith("cp -r "));
	expect(copies).toHaveLength(1);
	expect(copies[0]).toContain(".agents");
	expect(selected.some((line) => line.includes(".config/* into"))).toBe(false);
	expect(selected.some((line) => line.includes(".claude/CLAUDE.md"))).toBe(true);
}, 20_000);
