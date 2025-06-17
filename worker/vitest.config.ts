import { execSync } from "node:child_process";
import process from "node:process";
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";
import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

const currentBranch =
	process.env["CURRENT_BRANCH"] ??
	execSync("git branch --show-current").toString().trim();
if (!currentBranch) {
	throw new Error("Could not determine current branch from git.");
}
const latestCommitHash = execSync("git rev-parse HEAD").toString().trim();
if (!latestCommitHash) {
	throw new Error("Could not determine latest commit hash from git.");
}

// ref: https://vitest.dev/config/
export default defineConfig((configEnv) =>
	mergeConfig(
		viteConfig(configEnv),
		defineWorkersConfig({
			test: {
				env: {
					// biome-ignore-start lint/style/useNamingConvention: env var
					// use current branch name as default branch for testing
					DEFAULT_BRANCH: currentBranch,

					// define in vite.config.ts does not work in vitest, so define here
					GITHUB_TOKEN: process.env["GITHUB_TOKEN"],

					LATEST_COMMIT_HASH: latestCommitHash,
					// fix constants in tests
					REPO_NAME: "risu729/dotfiles",
					// biome-ignore-end lint/style/useNamingConvention: env var
				},
				poolOptions: {
					workers: {
						singleWorker: true,
						wrangler: {
							configPath: "./wrangler.jsonc",
						},
					},
				},
			},
		}),
	),
);
