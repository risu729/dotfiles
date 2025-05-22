import { SELF } from "cloudflare:test";
import { diffLines } from "diff";
import { describe, expect, it, test } from "vitest";

test("redirect / to repository readme", async () => {
	const response = await SELF.fetch("https://dot.risunosu.com/", {
		redirect: "manual",
	});
	expect(response.headers.get("location")).toBe(
		"https://github.com/risu729/dotfiles#readme",
	);
});

describe("redirect to the installer script", () => {
	it.each([
		{
			path: "/win",
			scriptPath: "/win/install.ps1",
		},
		{
			path: "/wsl",
			scriptPath: "/wsl/install.sh",
		},
	])("redirect $path", async ({ path, scriptPath }) => {
		const response = await SELF.fetch(`https://dot.risunosu.com${path}`, {
			redirect: "manual",
		});
		expect(response.headers.get("location")).toBe(
			`https://raw.githubusercontent.com/risu729/dotfiles/main${scriptPath}`,
		);
	});
});

describe("return the installer script with a specified ref set to a variable", () => {
	it.each(["/win", "/wsl"])(
		"return %s with ref",
		{
			// regex matching takes time
			timeout: 10000,
		},
		async (path) => {
			const response = await SELF.fetch(
				`https://dot.risunosu.com${path}?ref=${import.meta.env.LATEST_COMMIT_HASH}`,
			);
			expect(await response.text()).toMatch(
				new RegExp(
					`^.?git_ref *= *"${import.meta.env.LATEST_COMMIT_HASH}"`,
					"gm",
				),
			);
		},
	);
});

describe("redirect with 307 status code", () => {
	it.each(["/", "/win", "/wsl"])("redirect %s", async (path) => {
		const response = await SELF.fetch(`https://dot.risunosu.com${path}`, {
			redirect: "manual",
		});
		expect(response.status).toBe(307);
	});
});

describe("return 200 status code with ref query parameters", () => {
	it.each(["/win", "/wsl"])("return %s with ref", async (path) => {
		const response = await SELF.fetch(
			`https://dot.risunosu.com${path}?ref=${import.meta.env.LATEST_COMMIT_HASH}`,
		);
		expect(response.status).toBe(200);
	});
});

describe("installer script for wsl should have a shebang", () => {
	it("return /wsl with ref", async () => {
		const response = await SELF.fetch(
			`https://dot.risunosu.com/wsl?ref=${import.meta.env.LATEST_COMMIT_HASH}`,
		);
		// biome-ignore lint/performance/useTopLevelRegex: ignore performance warning in test
		expect(await response.text()).toMatch(/^#!(?:\/\w+)+/);
	});
});

describe("installer script contains the source URL", () => {
	it.each(["/win", "/wsl"])("return %s with ref", async (path) => {
		const response = await SELF.fetch(
			`https://dot.risunosu.com${path}?ref=${import.meta.env.LATEST_COMMIT_HASH}`,
		);
		const script = await response.text();
		const sourceUrl = [...script.matchAll(/# source: (.+)/g)][0]?.[1];
		expect(sourceUrl).toBe(
			`https://raw.githubusercontent.com/risu729/dotfiles/${import.meta.env.LATEST_COMMIT_HASH}${path}/install.${
				path === "/win" ? "ps1" : "sh"
			}`,
		);
	});
});

describe("installer script is almost the same as the source", () => {
	it.each(["/win", "/wsl"])("return %s with ref", async (path) => {
		const response = await SELF.fetch(
			`https://dot.risunosu.com${path}?ref=${import.meta.env.LATEST_COMMIT_HASH}`,
		);
		const script = await response.text();
		const sourceUrl = [...script.matchAll(/# source: (.+)/g)][0]?.[1];
		if (!sourceUrl) {
			throw new Error("source URL not found (covered by the previous test)");
		}
		const sourceResponse = await fetch(sourceUrl);
		const sourceScript = await sourceResponse.text();
		const diff = diffLines(sourceScript, script);
		// source URL and git_ref should be modified
		expect(diff.filter((d) => d.added)).toHaveLength(2);
	});
});

describe("return 404 for other paths", () => {
	it.each(["/mac", "/linux/ubuntu"])("return 404 for %s", async (path) => {
		const response = await SELF.fetch(`https://dot.risunosu.com${path}`);
		expect(response.status).toBe(404);
	});
});
