import {
	createExecutionContext,
	env,
	waitOnExecutionContext,
} from "cloudflare:test";
import { beforeAll, describe, expect, it, test } from "vitest";
import worker from "../src/index.js";
import { diffLines } from "diff";

// biome-ignore lint/correctness/noUndeclaredVariables: cannot read tsconfig.json#compilerOptions.types
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

beforeAll(() => {
	// set the variables that are used in the worker
	env.REPO_OWNER = "risu729";
	env.REPO_NAME = "dotfiles";
	env.DEFAULT_BRANCH = "main";
});

const fetchWorker = async (url: string) => {
	const request = new IncomingRequest(url);
	const context = createExecutionContext();
	const response = await worker.fetch(request, env, context);
	await waitOnExecutionContext(context);
	return response;
};

test("redirect / to repository readme", async () => {
	const response = await fetchWorker("https://dot.risunosu.com/");
	expect(response.headers.get("Location")).toBe(
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
		const response = await fetchWorker(`https://dot.risunosu.com${path}`);
		expect(response.headers.get("Location")).toBe(
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
			const ref = "ed61d947087a6e943267c6eaa82d0e0039b9b279";
			const response = await fetchWorker(
				`https://dot.risunosu.com${path}?ref=${ref}`,
			);
			expect(await response.text()).toMatch(
				new RegExp(`^.?git_ref *= *"${ref}"`, "gm"),
			);
		},
	);
});

describe("redirect with 307 status code", () => {
	it.each(["/", "/win", "/wsl"])("redirect %s", async (path) => {
		const response = await fetchWorker(`https://dot.risunosu.com${path}`);
		expect(response.status).toBe(307);
	});
});

describe("return 200 status code with ref query parameters", () => {
	it.each(["/win", "/wsl"])("return %s with ref", async (path) => {
		const response = await fetchWorker(
			`https://dot.risunosu.com${path}?ref=ed61d947087a6e943267c6eaa82d0e0039b9b279`,
		);
		expect(response.status).toBe(200);
	});
});

describe("installer script for wsl should have a shebang", () => {
	it("return /wsl with ref", async () => {
		const response = await fetchWorker(
			"https://dot.risunosu.com/wsl?ref=ed61d947087a6e943267c6eaa82d0e0039b9b279",
		);
		// biome-ignore lint/nursery/useTopLevelRegex: ignore performance warning in test
		expect(await response.text()).toMatch(/^#!(?:\/\w+)+/);
	});
});

describe("installer script contains the source URL", () => {
	it.each(["/win", "/wsl"])("return %s with ref", async (path) => {
		const ref = "ed61d947087a6e943267c6eaa82d0e0039b9b279";
		const response = await fetchWorker(
			`https://dot.risunosu.com${path}?ref=${ref}`,
		);
		const script = await response.text();
		const sourceUrl = [...script.matchAll(/# source: (.+)/g)][0]?.[1];
		expect(sourceUrl).toBe(
			`https://raw.githubusercontent.com/risu729/dotfiles/${ref}${path}/install.${
				path === "/win" ? "ps1" : "sh"
			}`,
		);
	});
});

describe("installer script is almost the same as the source", () => {
	it.each(["/win", "/wsl"])("return %s with ref", async (path) => {
		const ref = "ed61d947087a6e943267c6eaa82d0e0039b9b279";
		const response = await fetchWorker(
			`https://dot.risunosu.com${path}?ref=${ref}`,
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
		const response = await fetchWorker(`https://dot.risunosu.com${path}`);
		expect(response.status).toBe(404);
	});
});
