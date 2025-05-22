import { SELF } from "cloudflare:test";
import { type ChangeObject, diffLines } from "diff";
import { describe, expect, it, test } from "vitest";

test("redirect / to repository readme", async () => {
	const response = await SELF.fetch("https://dot.risunosu.com/", {
		redirect: "manual",
	});
	expect(response.headers.get("location")).toBe(
		"https://github.com/risu729/dotfiles#readme",
	);
});

test("redirect / with 307 status code", async () => {
	const response = await SELF.fetch("https://dot.risunosu.com/", {
		redirect: "manual",
	});
	expect(response.status).toBe(307);
});

describe("return 200 status code", () => {
	it.each(["/win", "/wsl"])("return %s with 200 status code", async (path) => {
		const response = await SELF.fetch(
			`https://dot.risunosu.com${path}?ref=${import.meta.env.LATEST_COMMIT_HASH}`,
		);
		expect(response.status).toBe(200);
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

describe("return the installer script with repo_name set", () => {
	it.each(["/win", "/wsl"])(
		"return %s with repo_name",
		{
			// regex matching takes time
			timeout: 10000,
		},
		async (path) => {
			const response = await SELF.fetch(
				`https://dot.risunosu.com${path}?ref=${import.meta.env.LATEST_COMMIT_HASH}`,
			);
			expect(await response.text()).toMatch(
				/^.?repo_name *= *"risu729\/dotfiles"/gm,
			);
		},
	);
});

describe("return the installer script with a specified ref set", () => {
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

describe("return 200 status code with ref query parameters", () => {
	it.each(["/win", "/wsl"])("return %s with ref", async (path) => {
		const response = await SELF.fetch(
			`https://dot.risunosu.com${path}?ref=${import.meta.env.LATEST_COMMIT_HASH}`,
		);
		expect(response.status).toBe(200);
	});
});

test(
	"installer script for wsl must have a shebang",
	{
		// regex matching takes time
		timeout: 10000,
	},
	async () => {
		const response = await SELF.fetch(
			`https://dot.risunosu.com/wsl?ref=${import.meta.env.LATEST_COMMIT_HASH}`,
		);
		// biome-ignore lint/performance/useTopLevelRegex: ignore performance warning in test
		expect(await response.text()).toMatch(/^#!(?:\/\w+)+/);
	},
);

describe("installer script must contain the source URL", () => {
	it.each(["/win", "/wsl"])("return %s with default branch", async (path) => {
		const response = await SELF.fetch(
			`https://dot.risunosu.com${path}?ref=${import.meta.env.LATEST_COMMIT_HASH}`,
		);
		const script = await response.text();
		const sourceUrl = [...script.matchAll(/# source: (?<url>.+)/g)].at(0)
			?.groups?.["url"];
		expect(sourceUrl).toBe(
			`https://raw.githubusercontent.com/risu729/dotfiles/${import.meta.env.LATEST_COMMIT_HASH}${path}/install.${path === "/win" ? "ps1" : "sh"}`,
		);
	});

	it.each(["/win", "/wsl"])("return %s with ref", async (path) => {
		const response = await SELF.fetch(
			`https://dot.risunosu.com${path}?ref=${import.meta.env.LATEST_COMMIT_HASH}`,
		);
		const script = await response.text();
		const sourceUrl = [...script.matchAll(/# source: (?<url>.+)/g)].at(0)
			?.groups?.["url"];
		expect(sourceUrl).toBe(
			`https://raw.githubusercontent.com/risu729/dotfiles/${import.meta.env.LATEST_COMMIT_HASH}${path}/install.${
				path === "/win" ? "ps1" : "sh"
			}`,
		);
	});
});

describe("installer script is almost the same as the source", () => {
	const getDiffLines = async (
		response: Response,
	): Promise<ChangeObject<string>[]> => {
		const script = await response.text();
		const sourceUrl = [...script.matchAll(/# source: (?<url>.+)/g)].at(0)
			?.groups?.["url"];
		if (!sourceUrl) {
			throw new Error("source URL not found (covered by the previous test)");
		}
		const sourceResponse = await fetch(sourceUrl);
		if (!sourceResponse.ok) {
			throw new Error(
				`failed to fetch source script: ${sourceResponse.statusText}`,
			);
		}
		const sourceScript = await sourceResponse.text();
		return diffLines(sourceScript, script);
	};

	it.each(["/win", "/wsl"])("return %s with default branch", async (path) => {
		const response = await SELF.fetch(
			`https://dot.risunosu.com${path}?ref=${import.meta.env.LATEST_COMMIT_HASH}`,
		);
		const diff = await getDiffLines(response);
		// source URL and git ref must be different
		expect(diff.filter((d) => d.added)).toHaveLength(3);
	});

	it.each(["/win", "/wsl"])("return %s with ref", async (path) => {
		const response = await SELF.fetch(
			`https://dot.risunosu.com${path}?ref=${import.meta.env.LATEST_COMMIT_HASH}`,
		);
		const diff = await getDiffLines(response);
		// source URL, git ref, and repo name must be different
		expect(diff.filter((d) => d.added)).toHaveLength(3);
	});
});

describe("return 404 for other paths", () => {
	it.each(["/mac", "/linux/ubuntu"])("return 404 for %s", async (path) => {
		const response = await SELF.fetch(`https://dot.risunosu.com${path}`);
		expect(response.status).toBe(404);
	});
});
