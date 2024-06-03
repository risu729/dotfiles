import {
	createExecutionContext,
	env,
	waitOnExecutionContext,
} from "cloudflare:test";
import { beforeAll, describe, expect, it, test } from "vitest";
import worker from "../src/index.js";

// biome-ignore lint/correctness/noUndeclaredVariables: cannot read tsconfig.json#compilerOptions.types
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

beforeAll(() => {
	// set the variables that are used in the worker
	env.REPOSITORY = "risu729/dotfiles";
});

const fetch = async (url: string) => {
	const request = new IncomingRequest(url);
	const context = createExecutionContext();
	const response = await worker.fetch(request, env, context);
	await waitOnExecutionContext(context);
	return response;
};

test("redirect / to repository readme", async () => {
	const response = await fetch("https://dot.risunosu.com/");
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
		const response = await fetch(`https://dot.risunosu.com${path}`);
		expect(response.headers.get("Location")).toBe(
			`https://raw.githubusercontent.com/risu729/dotfiles/main${scriptPath}`,
		);
	});
});

describe("redirect with 307 status code", () => {
	it.each(["/", "/win", "/wsl"])("redirect %s", async (path) => {
		const response = await fetch(`https://dot.risunosu.com${path}`);
		expect(response.status).toBe(307);
	});
});

describe("return 404 for other paths", () => {
	it.each(["/mac", "/linux/ubuntu"])("return 404 for %s", async (path) => {
		const response = await fetch(`https://dot.risunosu.com${path}`);
		expect(response.status).toBe(404);
	});
});
