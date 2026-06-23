import { execSync } from "node:child_process";
import process from "node:process";

import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const latestCommitHash: string = execSync("git rev-parse HEAD").toString().trim();
if (!latestCommitHash) {
	throw new Error("Could not determine latest commit hash from git.");
}

// Ref: https://vitest.dev/config/
export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: {
				configPath: "./wrangler.jsonc",
			},
		}),
	],
	test: {
		env: {
			// Pin fetches to the checked-out commit so raw.githubusercontent.com stays consistent.
			DEFAULT_BRANCH: latestCommitHash,

			// Define in vite.config.ts does not work in vitest, so define here
			GITHUB_TOKEN: process.env["GITHUB_TOKEN"],

			LATEST_COMMIT_HASH: latestCommitHash,
			// Fix constants in tests
			REPO_NAME: "risu729/dotfiles",
		},
	},
});
