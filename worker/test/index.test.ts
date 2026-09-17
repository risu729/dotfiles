import { SELF } from "cloudflare:test";
import { diffLines } from "diff";
import type { ChangeObject } from "diff";
import { describe, expect, it } from "vitest";

/* oxlint-disable eslint/max-lines-per-function jest/no-conditional-in-test jest/prefer-expect-assertions vitest/prefer-expect-assertions vitest/require-test-timeout */

// WSL and macOS share one installer
const scriptPath = (path: string): string =>
	path === "/win" ? "win/install.ps1" : "unix/install.sh";

describe("worker", () => {
	it("redirect / to repository readme with 307 status code", async () => {
		const response = await SELF.fetch("https://dot.risunosu.com/", {
			redirect: "manual",
		});
		expect(response.headers.get("location")).toBe("https://github.com/risu729/dotfiles#readme");
		expect(response.status).toBe(307);
	});

	describe("return 200 status code", () => {
		it.each(["/mac", "/win", "/wsl"])("return %s with 200 status code", async (path) => {
			const response = await SELF.fetch(`https://dot.risunosu.com${path}`);
			expect(response.status).toBe(200);
		});
	});

	describe("return the installer script with the specified ref set", () => {
		it.each(["/mac", "/win", "/wsl"])(
			"return %s with ref",
			{
				// Regex matching takes time
				timeout: 10_000,
			},
			async (path) => {
				const response = await SELF.fetch(
					`https://dot.risunosu.com${path}?ref=${import.meta.env.DEFAULT_BRANCH}`,
				);
				await expect(response.text()).resolves.toMatch(
					new RegExp(`^.?git(?:_r|R)ef *= *["']${import.meta.env.DEFAULT_BRANCH}["']`, "gmu"),
				);
			},
		);
	});

	describe("return the installer script with the script origin set", () => {
		it(
			"return /win with script origin",
			{
				// Regex matching takes time
				timeout: 10_000,
			},
			async () => {
				const response = await SELF.fetch("https://dot.risunosu.com/win");
				await expect(response.text()).resolves.toMatch(
					/^.?script(?:_o|O)rigin *= *["']https:\/\/dot\.risunosu\.com["']/gmu,
				);
			},
		);

		it(
			"return /win with script origin with port",
			{
				// Regex matching takes time
				timeout: 10_000,
			},
			async () => {
				const response = await SELF.fetch("http://localhost:8080/win");
				await expect(response.text()).resolves.toMatch(
					/^.?script(?:_o|O)rigin *= *["']http:\/\/localhost:8080["']/gmu,
				);
			},
		);
	});

	describe("shell installer script must have a shebang", () => {
		it.each(["/mac", "/wsl"])(
			"return %s with a shebang",
			{
				// Regex matching takes time
				timeout: 10_000,
			},
			async (path) => {
				const response = await SELF.fetch(`https://dot.risunosu.com${path}`);
				await expect(response.text()).resolves.toMatch(/^#!(?:\/\w+)+/u);
			},
		);
	});

	describe("return the installer script with the specified profile set", () => {
		it.each(["/mac", "/wsl"])(
			"return %s with profile",
			{
				// Regex matching takes time
				timeout: 10_000,
			},
			async (path) => {
				const response = await SELF.fetch(`https://dot.risunosu.com${path}?profile=personal`);
				await expect(response.text()).resolves.toMatch(/^profile *= *["']personal["']/gmu);
			},
		);

		it("ignore the profile for /win", async () => {
			const response = await SELF.fetch("https://dot.risunosu.com/win?profile=personal");
			expect(response.status).toBe(200);
		});

		it.each(["/mac", "/win", "/wsl"])("return 400 for an invalid ref on %s", async (path) => {
			const response = await SELF.fetch(
				`https://dot.risunosu.com${path}?ref=main%2Funix%2Finstall.sh%3Fx%3D%24(id)`,
			);
			expect(response.status).toBe(400);
		});

		it.each(["/mac", "/win", "/wsl"])("return 400 for an unknown profile on %s", async (path) => {
			const response = await SELF.fetch(`https://dot.risunosu.com${path}?profile=%22%3Bid%3B%22`);
			expect(response.status).toBe(400);
		});
	});

	describe("installer script must contain the source URL", () => {
		it.each(["/mac", "/win", "/wsl"])("return %s with default branch", async (path) => {
			const response = await SELF.fetch(`https://dot.risunosu.com${path}`);
			const script = await response.text();
			const sourceUrl = [...script.matchAll(/# source: (?<url>.+)/gu)].at(0)?.groups?.["url"];
			expect(sourceUrl).toBe(
				`https://raw.githubusercontent.com/risu729/dotfiles/${import.meta.env.DEFAULT_BRANCH}/${scriptPath(path)}`,
			);
		});

		it.each(["/mac", "/win", "/wsl"])("return %s with ref", async (path) => {
			const response = await SELF.fetch(
				`https://dot.risunosu.com${path}?ref=${import.meta.env.DEFAULT_BRANCH}`,
			);
			const script = await response.text();
			const sourceUrl = [...script.matchAll(/# source: (?<url>.+)/gu)].at(0)?.groups?.["url"];
			expect(sourceUrl).toBe(
				`https://raw.githubusercontent.com/risu729/dotfiles/${import.meta.env.DEFAULT_BRANCH}/${scriptPath(path)}`,
			);
		});
	});

	describe("installer script is almost the same as the source", () => {
		const getDiffLines = async (response: Response): Promise<ChangeObject<string>[]> => {
			const script = await response.text();
			const sourceUrl = [...script.matchAll(/# source: (?<url>.+)/gu)].at(0)?.groups?.["url"];
			if (!sourceUrl) {
				throw new Error("source URL not found (covered by the previous test)");
			}
			const sourceResponse = await fetch(sourceUrl);
			if (!sourceResponse.ok) {
				throw new Error(`failed to fetch source script: ${sourceResponse.statusText}`);
			}
			const sourceScript = await sourceResponse.text();
			return diffLines(sourceScript, script);
		};

		it.each(["/mac", "/win", "/wsl"])("return %s with default branch", async (path) => {
			const response = await SELF.fetch(`https://dot.risunosu.com${path}`);
			const diff = await getDiffLines(response);
			// Source URL and script origin must be different
			expect(diff.filter((change) => change.added)).toHaveLength(path === "/win" ? 2 : 1);
		});

		it.each(["/mac", "/win", "/wsl"])("return %s with ref", async (path) => {
			const response = await SELF.fetch(
				`https://dot.risunosu.com${path}?ref=${import.meta.env.DEFAULT_BRANCH}`,
			);
			const diff = await getDiffLines(response);
			// Source URL, git ref, and script origin must be different
			expect(diff.filter((change) => change.added)).toHaveLength(path === "/win" ? 3 : 2);
		});
	});

	describe("return 404 for other paths", () => {
		it.each(["/linux", "/linux/ubuntu"])("return 404 for %s", async (path) => {
			const response = await SELF.fetch(`https://dot.risunosu.com${path}`);
			expect(response.status).toBe(404);
		});
	});
});
